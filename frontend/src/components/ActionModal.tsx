import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Download, EyeOff, RefreshCw, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    segmentWithSAM3,
    replaceWithPika,
    replaceWithVACE,
    replaceWithRunway,
    blurObject,
    getDownloadUrl,
    getSegmentedDownloadUrl,
    detectObjects,
    censorAudio,
    analyzeAudio,
    suggestReplacements
} from '../services/api';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type ActionType = 'blur' | 'pixelate' | 'mask' | 'replace-pika' | 'replace-vace' | 'replace-runway' | 'censor-beep' | 'censor-dub';

interface ActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobId: string;
    actionType: ActionType;
    objectPrompt: string;
    suggestedReplacement?: string;
    onActionComplete?: (result: { type: ActionType; downloadUrl?: string }) => void;
    // New props for smart detection
    initialBox?: { top: number; left: number; width: number; height: number };
    timestamp?: number;
    // Timestamps for Smart Clipping optimization
    startTime?: number;
    endTime?: number;
}

type Status = 'idle' | 'detecting' | 'processing' | 'completed' | 'error';

const ActionModal: React.FC<ActionModalProps> = ({
    isOpen,
    onClose,
    jobId,
    actionType,
    objectPrompt: initialPrompt, // Rename to allow local state override
    suggestedReplacement = '',
    onActionComplete,
    initialBox,
    timestamp,
    startTime,
    endTime
}) => {
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string>('');
    const [downloadUrl, setDownloadUrl] = useState<string>('');
    const [objectPrompt, setObjectPrompt] = useState(initialPrompt); // Local state for prompt
    const [replacementPrompt, setReplacementPrompt] = useState(suggestedReplacement);
    const [referenceImage, setReferenceImage] = useState<File | null>(null);
    const [maskOnly, setMaskOnly] = useState(true);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [profanityMatches, setProfanityMatches] = useState<Array<{
        word: string;
        replacement: string;
        suggestions?: string[];
        start_time: number;
        end_time: number;
        confidence?: string;
        context?: string;
    }>>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Track if already loading to prevent duplicate calls (React StrictMode protection)
    const isLoadingRef = useRef(false);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setObjectPrompt(initialPrompt);
            setSuggestions([]);
            setStatus('idle');
            setDownloadUrl('');
            setProfanityMatches([]);
            setLoadingSuggestions(false);
            isLoadingRef.current = false; // Reset the ref

            // Auto-load profanity for censor-dub mode (with guard)
            if (actionType === 'censor-dub' && !isLoadingRef.current) {
                isLoadingRef.current = true;
                loadProfanityAndSuggestions();
            }
        }
    }, [isOpen, initialPrompt, actionType]);

    // Load profanity detection and suggestions
    const loadProfanityAndSuggestions = async () => {
        setLoadingSuggestions(true);
        try {
            // Step 1: Analyze audio for profanity
            const audioResult = await analyzeAudio(jobId);

            if (audioResult.profanity_count === 0) {
                setLoadingSuggestions(false);
                return;
            }

            // Step 2: Store ALL match data including timestamps (not just unique words)
            const matchesWithTimestamps = audioResult.matches.map(m => ({
                word: m.word,
                replacement: '', // User can override
                suggestions: [],
                start_time: m.start_time,
                end_time: m.end_time,
                confidence: m.confidence,
                context: m.context,
            }));

            setProfanityMatches(matchesWithTimestamps);
            setLoadingSuggestions(false);
        } catch (err) {
            console.error('Failed to load detected words:', err);
            setLoadingSuggestions(false);
        }
    };


    // Manually generate suggestions for current word list
    const handleManualGenerate = async () => {
        if (profanityMatches.length === 0) return;

        setLoadingSuggestions(true);
        try {
            const words = profanityMatches.map(m => m.word).filter(w => w.trim() !== '');
            if (words.length === 0) {
                setLoadingSuggestions(false);
                return;
            }

            const suggestionsResult = await suggestReplacements(jobId, words);

            const updatedMatches = profanityMatches.map((match) => {
                const wordSuggestion = suggestionsResult.suggestions.find(s => s.original_word === match.word);
                return {
                    ...match,
                    replacement: wordSuggestion?.suggestions[0] || match.replacement,
                    suggestions: wordSuggestion?.suggestions || []
                };
            });

            setProfanityMatches(updatedMatches);
            setLoadingSuggestions(false);
        } catch (err) {
            console.error('Failed to generate suggestions:', err);
            setLoadingSuggestions(false);
        }
    };

    // Auto-detect objects if box is provided
    useEffect(() => {
        if (isOpen && initialBox && timestamp !== undefined && objectPrompt === 'Custom Object') {
            const detect = async () => {
                setStatus('detecting');
                try {
                    const result = await detectObjects(jobId, timestamp, initialBox);
                    setSuggestions(result.suggestions);
                    if (result.suggestions.length > 0) {
                        setObjectPrompt(result.suggestions[0]); // Auto-select first suggestion
                    }
                    setStatus('idle');
                } catch (err) {
                    console.error("Detection failed", err);
                    setStatus('idle'); // Fail silently, allow manual input
                }
            };
            detect();
        }
    }, [isOpen, initialBox, timestamp, jobId]);


    if (!isOpen) return null;

    const handleExecute = async () => {
        setStatus('processing');
        setError('');

        try {
            let finalDownloadUrl = '';

            switch (actionType) {
                case 'blur':
                    // Use new blur endpoint that combines SAM3 + FFmpeg blur
                    await blurObject(jobId, objectPrompt, 30, 'blur', startTime, endTime);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'pixelate':
                    // Use blur endpoint with pixelate effect
                    await blurObject(jobId, objectPrompt, 30, 'pixelate', startTime, endTime);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'mask':
                    // Just create a mask overlay (original behavior)
                    await segmentWithSAM3(jobId, objectPrompt, maskOnly, 'green', 0.5);
                    finalDownloadUrl = getSegmentedDownloadUrl(jobId);
                    break;

                case 'replace-pika':
                    // Use Pika for replacement (requires reference image)
                    if (!referenceImage) {
                        throw new Error('Reference image is required for Pika replacement');
                    }
                    await replaceWithPika(jobId, replacementPrompt, referenceImage);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'replace-vace':
                    // First run SAM3 to create mask, then VACE for replacement
                    await segmentWithSAM3(jobId, objectPrompt, true, 'green', 0.5);
                    await replaceWithVACE(jobId, replacementPrompt);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'replace-runway':
                    // Use Runway Gen-4 for replacement (text-only, no reference image needed)
                    // Supports Smart Clipping - pass timestamps to process only the relevant portion
                    await replaceWithRunway(jobId, replacementPrompt, referenceImage || undefined, undefined, 5, startTime, endTime);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'censor-beep':
                    // Censor audio with beep sounds - pass pre-analyzed matches to skip re-analysis
                    await censorAudio(
                        jobId,
                        'beep',
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        profanityMatches  // Pass full matches to skip re-analysis!
                    );
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'censor-dub':
                    // Censor audio with voice dubbing - pass pre-analyzed matches AND custom replacements
                    const customReplacements = profanityMatches.reduce((acc, match) => {
                        acc[match.word] = match.replacement;
                        return acc;
                    }, {} as Record<string, string>);

                    await censorAudio(
                        jobId,
                        'dub',
                        undefined,
                        undefined,
                        undefined,
                        customReplacements,
                        profanityMatches  // Pass full matches to skip re-analysis!
                    );
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                default:
                    throw new Error(`Unknown action type: ${actionType}`);
            }

            setDownloadUrl(finalDownloadUrl);
            setStatus('completed');
            onActionComplete?.({ type: actionType, downloadUrl: finalDownloadUrl });

        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Action failed');
        }
    };

    const getTitle = () => {
        switch (actionType) {
            case 'blur': return 'Blur Object';
            case 'pixelate': return 'Pixelate Object';
            case 'mask': return 'Highlight Object (Mask Overlay)';
            case 'replace-pika': return 'Pika Inpainting';
            case 'replace-vace': return 'VACE Inpainting';
            case 'replace-runway': return 'Runway Gen-3 Refactor';
            case 'censor-beep': return 'Censor Audio (Beep)';
            case 'censor-dub': return 'Censor Audio (Voice Dub)';
            default: return 'Execute Action';
        }
    };

    const getDescription = () => {
        switch (actionType) {
            case 'blur': return `Detect "${objectPrompt}" and apply Gaussian blur.`;
            case 'pixelate': return `Detect "${objectPrompt}" and apply pixelation.`;
            case 'mask': return `Highlight "${objectPrompt}" with a colored overlay.`;
            case 'replace-pika': return `Execute generative inpainting on "${objectPrompt}" via Pika.`;
            case 'replace-vace': return `Execute VACE-based remediation on "${objectPrompt}".`;
            case 'replace-runway': return `Execute Runway Gen-3 refactor on "${objectPrompt}".`;
            case 'censor-beep': return `Apply frequency-based audio masking to detected profanity.`;
            case 'censor-dub': return `Apply neural voice synthesis to remediate detected profanity.`;
            default: return '';
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-background/95 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-md bg-[#0a0a0c] rounded-2xl border border-white/15 shadow-[0_32px_128px_rgba(0,0,0,0.8),0_0_20px_rgba(255,255,255,0.02)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-5 border-b border-white/10 bg-white/[0.05]">
                    <h2 className="font-semibold text-lg flex items-center gap-2 text-white">
                        {actionType.includes('replace') ? <RefreshCw className="w-4 h-4 text-accent" /> : <EyeOff className="w-4 h-4 text-accent" />}
                        {getTitle()}
                    </h2>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-1.5">
                                Target Object
                                {status === 'detecting' && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                            </label>

                            {/* Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="flex gap-1.5">
                                    {suggestions.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setObjectPrompt(s)}
                                            className={cn(
                                                "text-[10px] px-2 py-0.5 rounded-md border transition-all duration-200",
                                                objectPrompt === s
                                                    ? "bg-accent/20 text-accent border-accent/40 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                                                    : "bg-white/[0.05] hover:bg-white/[0.1] border-white/10 text-muted-foreground"
                                            )}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="relative group">
                            <input
                                value={objectPrompt}
                                onChange={(e) => setObjectPrompt(e.target.value)}
                                className={cn(
                                    "w-full px-4 py-3 bg-[#111113] rounded-xl border text-sm focus:outline-none transition-all duration-200 placeholder:text-muted-foreground/20",
                                    status === 'detecting'
                                        ? "border-accent/60 animate-pulse bg-accent/[0.05]"
                                        : "border-white/10 hover:border-white/20 focus:border-accent/80 focus:ring-1 focus:ring-accent/20"
                                )}
                                placeholder={status === 'detecting' ? "Detecting object..." : "Enter object name..."}
                            />
                            {status === 'detecting' && (
                                <Sparkles className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-accent animate-pulse" />
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 leading-relaxed indent-0.5">{getDescription()}</p>
                    </div>

                    {/* Mask Only Checkbox */}
                    {(actionType === 'blur' || actionType === 'mask') && (
                        <div className="flex items-center gap-3 px-1">
                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                <div className="relative flex items-center justify-center">
                                    <input
                                        type="checkbox"
                                        checked={maskOnly}
                                        onChange={(e) => setMaskOnly(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-5 h-5 border border-white/10 rounded-md bg-white/10 peer-checked:bg-accent peer-checked:border-accent transition-all duration-200" />
                                    <CheckCircle2 className="absolute w-3.5 h-3.5 text-white scale-0 peer-checked:scale-100 transition-transform duration-200" />
                                </div>
                                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Mask only (no overlay color)</span>
                            </label>
                        </div>
                    )}

                    {/* Replacement Fields */}
                    {actionType.includes('replace') && (
                        <>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Replacement Prompt</label>
                                <input
                                    type="text"
                                    value={replacementPrompt}
                                    onChange={(e) => setReplacementPrompt(e.target.value)}
                                    placeholder="e.g., red Coca-Cola can"
                                    className="w-full px-4 py-3 bg-[#111113] rounded-xl border border-white/10 text-sm focus:border-accent/80 focus:outline-none focus:ring-1 focus:ring-accent/20 transition-all font-medium"
                                />
                            </div>

                            {/* Reference image only for Pika - Runway is text-only */}
                            {actionType === 'replace-pika' && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Reference Image (Required)</label>
                                    <div className="relative group">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => setReferenceImage(e.target.files?.[0] || null)}
                                            className="w-full px-4 py-3 bg-[#111113] border border-white/10 rounded-xl text-sm file:mr-4 file:px-4 file:py-1 file:rounded-lg file:border-0 file:bg-accent/20 file:text-accent file:text-xs file:font-bold hover:border-white/20 transition-all cursor-pointer"
                                        />
                                    </div>
                                    {referenceImage && <p className="text-[11px] text-emerald-400/80 flex items-center gap-1.5 px-0.5">
                                        <CheckCircle2 className="w-3 h-3" />
                                        {referenceImage.name}
                                    </p>}
                                </div>
                            )}

                            {/* Smart Clipping info for Runway */}
                            {actionType === 'replace-runway' && startTime !== undefined && endTime !== undefined && (
                                <div className="p-4 bg-accent/[0.03] border border-accent/10 rounded-2xl space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-accent/80">Smart Clipping Active</span>
                                    </div>
                                    <div className="flex gap-6">
                                        <div className="space-y-1">
                                            <span className="text-[9px] uppercase font-bold text-muted-foreground/40 block">Start Point</span>
                                            <span className="font-mono text-sm text-foreground/80">{startTime.toFixed(2)}s</span>
                                        </div>
                                        <div className="w-px h-8 bg-white/5" />
                                        <div className="space-y-1">
                                            <span className="text-[9px] uppercase font-bold text-muted-foreground/40 block">End Point</span>
                                            <span className="font-mono text-sm text-foreground/80">{endTime.toFixed(2)}s</span>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground/50 italic leading-relaxed">System will isolate and process only the specified temporal segment.</p>
                                </div>
                            )}
                        </>
                    )}


                    {/* Enhanced Word Replacement with Gemini Suggestions (for voice dub mode) */}
                    {actionType === 'censor-dub' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                                    AI Word Remediation
                                </label>
                                <button
                                    onClick={handleManualGenerate}
                                    disabled={loadingSuggestions || profanityMatches.length === 0}
                                    className="flex items-center gap-1.5 px-3 py-1 bg-accent/10 hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed text-accent rounded-lg text-xs font-semibold transition-all duration-200"
                                >
                                    {loadingSuggestions ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <RefreshCw className="w-3 h-3" />
                                    )}
                                    Suggest
                                </button>
                            </div>

                            {loadingSuggestions ? (
                                <div className="p-10 bg-white/[0.05] border border-white/5 rounded-2xl text-center space-y-3">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent/50" />
                                    <p className="text-[11px] text-muted-foreground/60 italic">Synthesizing alternatives...</p>
                                </div>
                            ) : profanityMatches.length === 0 ? (
                                <div className="p-6 bg-white/[0.05] border border-white/5 rounded-2xl text-center space-y-2">
                                    <CheckCircle2 className="w-10 h-10 text-emerald-500/20 mx-auto" />
                                    <p className="text-xs text-muted-foreground">No violations detected in audio stream.</p>
                                </div>
                            ) : (
                                <div className="space-y-3 max-h-64 overflow-y-auto pr-1 -mr-1 custom-scrollbar">
                                    {profanityMatches.map((match, index) => (
                                        <div key={index} className="p-4 bg-white/[0.08] border border-white/5 rounded-2xl space-y-3 group hover:border-white/10 transition-all">
                                            {/* Word to Replace */}
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="space-y-1.5 flex-1">
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.05em] text-red-400/60">Detected Segment</span>
                                                    <div className="px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-xl text-sm font-medium text-red-400/90">
                                                        {match.word}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const updated = profanityMatches.filter((_, i) => i !== index);
                                                        setProfanityMatches(updated);
                                                    }}
                                                    className="mt-5 p-2 bg-white/10 hover:bg-red-500/10 rounded-xl text-muted-foreground/40 hover:text-red-400 transition-all"
                                                    title="Remove"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Replacement Field */}
                                            <div className="space-y-2">
                                                <span className="text-[9px] font-bold uppercase tracking-[0.05em] text-accent/60">Proposed Replacement</span>
                                                <input
                                                    type="text"
                                                    list={`suggestions-${index}`}
                                                    value={match.replacement}
                                                    onChange={(e) => {
                                                        const updated = [...profanityMatches];
                                                        updated[index].replacement = e.target.value;
                                                        setProfanityMatches(updated);
                                                    }}
                                                    className="w-full px-4 py-3 bg-[#111113] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-accent/60 text-foreground/90 font-medium transition-all"
                                                />
                                                {match.suggestions && match.suggestions.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {match.suggestions.map((suggestion, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => {
                                                                    const updated = [...profanityMatches];
                                                                    updated[index].replacement = suggestion;
                                                                    setProfanityMatches(updated);
                                                                }}
                                                                className={cn(
                                                                    "px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-200",
                                                                    match.replacement === suggestion
                                                                        ? "bg-accent/20 text-accent border border-accent/20"
                                                                        : "bg-white/10 hover:bg-white/20 text-muted-foreground border border-transparent"
                                                                )}
                                                            >
                                                                {suggestion}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="p-3 bg-white/[0.05] border border-white/10 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-accent/40" />
                                    <span className="text-[9px] uppercase font-bold tracking-[0.1em] text-muted-foreground/40">
                                        Intelligent Synthesis Active
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Status Messages */}
                    {status === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-red-500/[0.03] border border-red-500/10 rounded-2xl text-red-400 text-xs leading-relaxed animate-in slide-in-from-top-2 duration-300">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-bold uppercase tracking-wider text-[10px]">Processing Failed</p>
                                <p className="opacity-80">{error}</p>
                            </div>
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="flex items-center gap-3 p-4 bg-emerald-500/[0.03] border border-emerald-500/10 rounded-2xl text-emerald-400 text-xs animate-in slide-in-from-top-2 duration-300">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <div className="space-y-0.5">
                                <p className="font-bold uppercase tracking-wider text-[10px]">Operation Successful</p>
                                <p className="opacity-80 text-[10px]">Modifications applied and ready for export.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-5 border-t border-white/10 bg-white/[0.05]">
                    {status === 'completed' && downloadUrl && (
                        <a href={downloadUrl} download className="btn-primary flex items-center gap-2 text-sm shadow-emerald-500/10 bg-emerald-600 hover:bg-emerald-500">
                            <Download className="w-4 h-4" />
                            Download Result
                        </a>
                    )}

                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/5 rounded-xl transition-all duration-200"
                    >
                        {status === 'completed' ? 'Close' : 'Cancel'}
                    </button>

                    {status !== 'completed' && (
                        <button
                            onClick={handleExecute}
                            disabled={status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)}
                            className={cn(
                                "btn-primary flex items-center gap-2 text-sm",
                                (status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)) && "opacity-50 cursor-not-allowed scale-100 shadow-none"
                            )}
                        >
                            {status === 'processing' ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</> : 'Apply Remediation'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ActionModal;
