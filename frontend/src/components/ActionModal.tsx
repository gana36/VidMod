import React, { useState, useEffect } from 'react';
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
    const [profanityMatches, setProfanityMatches] = useState<Array<{ word: string, replacement: string, suggestions?: string[] }>>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setObjectPrompt(initialPrompt);
            setSuggestions([]);
            setStatus('idle');
            setDownloadUrl('');
            setProfanityMatches([]);
            setLoadingSuggestions(false);

            // Auto-load profanity for censor-dub mode
            if (actionType === 'censor-dub') {
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

            // Step 2: Just populate detected words WITHOUT auto-generating suggestions
            const uniqueWords = [...new Set(audioResult.matches.map(m => m.word))];
            const matchesWithoutSuggestions = uniqueWords.map((word) => ({
                word,
                replacement: '', // Empty - user must type manually or click Generate
                suggestions: []
            }));

            setProfanityMatches(matchesWithoutSuggestions);
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
                    // Censor audio with beep sounds
                    await censorAudio(jobId, 'beep');
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'censor-dub':
                    // Censor audio with voice dubbing using custom replacements
                    const customReplacements = profanityMatches.reduce((acc, match) => {
                        acc[match.word] = match.replacement;
                        return acc;
                    }, {} as Record<string, string>);
                    await censorAudio(jobId, 'dub', undefined, undefined, undefined, customReplacements);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                    <h2 className="font-semibold text-lg flex items-center gap-2">
                        {actionType.includes('replace') ? <RefreshCw className="w-5 h-5 text-accent" /> : <EyeOff className="w-5 h-5 text-accent" />}
                        {getTitle()}
                    </h2>
                    <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">

                    {/* Object Prompt Section */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                Target Object
                                {status === 'detecting' && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                            </label>

                            {/* Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="flex gap-1">
                                    {suggestions.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setObjectPrompt(s)}
                                            className={cn(
                                                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                                                objectPrompt === s ? "bg-accent text-white border-accent" : "bg-muted hover:bg-muted/80 border-transparent"
                                            )}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="relative">
                            <input
                                value={objectPrompt}
                                onChange={(e) => setObjectPrompt(e.target.value)}
                                className={cn(
                                    "w-full px-3 py-2 bg-muted/30 rounded-lg border text-sm focus:outline-none transition-all",
                                    status === 'detecting' ? "border-accent/50 animate-pulse" : "border-border focus:border-accent"
                                )}
                                placeholder={status === 'detecting' ? "Detecting object..." : "Enter object name..."}
                            />
                            {status === 'detecting' && (
                                <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent animate-pulse" />
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">{getDescription()}</p>
                    </div>

                    {/* Mask Only Checkbox */}
                    {(actionType === 'blur' || actionType === 'mask') && (
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={maskOnly}
                                    onChange={(e) => setMaskOnly(e.target.checked)}
                                    className="w-4 h-4 rounded border-border bg-muted accent-accent"
                                />
                                <span className="text-sm">Mask only (no overlay color)</span>
                            </label>
                        </div>
                    )}

                    {/* Replacement Fields */}
                    {actionType.includes('replace') && (
                        <>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Replacement Prompt</label>
                                <input
                                    type="text"
                                    value={replacementPrompt}
                                    onChange={(e) => setReplacementPrompt(e.target.value)}
                                    placeholder="e.g., red Coca-Cola can"
                                    className="w-full px-3 py-2 bg-muted/30 rounded-lg border border-border text-sm focus:border-accent focus:outline-none"
                                />
                            </div>

                            {/* Reference image only for Pika - Runway is text-only */}
                            {actionType === 'replace-pika' && (
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reference Image (Required)</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => setReferenceImage(e.target.files?.[0] || null)}
                                        className="w-full px-3 py-2 bg-muted/30 rounded-lg border border-border text-sm file:mr-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-accent file:text-white file:text-xs file:font-medium"
                                    />
                                    {referenceImage && <p className="text-xs text-emerald-500">✓ {referenceImage.name}</p>}
                                </div>
                            )}

                            {/* Smart Clipping info for Runway */}
                            {actionType === 'replace-runway' && startTime !== undefined && endTime !== undefined && (
                                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-xs font-semibold text-purple-400">Smart Clipping Active</span>
                                    </div>
                                    <div className="flex gap-4 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">Start:</span>
                                            <span className="font-mono text-purple-300">{startTime.toFixed(2)}s</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">End:</span>
                                            <span className="font-mono text-purple-300">{endTime.toFixed(2)}s</span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-2">Only this clip will be sent to Runway for processing.</p>
                                </div>
                            )}
                        </>
                    )}


                    {/* Enhanced Word Replacement with Gemini Suggestions (for voice dub mode) */}
                    {actionType === 'censor-dub' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <Sparkles className="w-3 h-3 text-violet-400" />
                                    AI-Powered Word Replacement
                                </label>
                                <button
                                    onClick={handleManualGenerate}
                                    disabled={loadingSuggestions || profanityMatches.length === 0}
                                    className="flex items-center gap-1 px-2 py-1 bg-violet-500/20 hover:bg-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-violet-400 rounded text-xs font-medium transition-colors"
                                >
                                    {loadingSuggestions ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <Sparkles className="w-3 h-3" />
                                    )}
                                    Generate
                                </button>
                            </div>

                            {loadingSuggestions ? (
                                <div className="p-8 bg-muted/20 rounded-lg text-center">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-400" />
                                    <p className="text-xs text-muted-foreground">Analyzing audio and generating suggestions...</p>
                                </div>
                            ) : profanityMatches.length === 0 ? (
                                <div className="p-4 bg-muted/20 rounded-lg text-xs text-muted-foreground text-center">
                                    <p className="mb-2">No profanity detected</p>
                                    <p className="text-[10px]">The video appears to be clean!</p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                                    {profanityMatches.map((match, index) => (
                                        <div key={index} className="p-3 bg-muted/20 rounded-lg border border-border space-y-2">
                                            {/* Word to Replace */}
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-1 flex-1">
                                                    <label className="text-[10px] text-muted-foreground uppercase">Word to Replace</label>
                                                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm font-medium text-red-400">
                                                        {match.word}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const updated = profanityMatches.filter((_, i) => i !== index);
                                                        setProfanityMatches(updated);
                                                    }}
                                                    className="p-1.5 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400 transition-colors ml-2"
                                                    title="Remove"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Replacement Field - Manual Input with Gemini Suggestions */}
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-violet-400 uppercase flex items-center gap-1">
                                                    <Sparkles className="w-3 h-3" />
                                                    Replacement {match.suggestions && match.suggestions.length > 0 && `(${match.suggestions.length} suggestions)`}
                                                </label>
                                                <input
                                                    type="text"
                                                    list={`suggestions-${index}`}
                                                    value={match.replacement}
                                                    onChange={(e) => {
                                                        const updated = [...profanityMatches];
                                                        updated[index].replacement = e.target.value;
                                                        setProfanityMatches(updated);
                                                    }}
                                                    placeholder="Type manually or click Generate for AI suggestions"
                                                    className="w-full px-3 py-2 bg-violet-500/10 border border-violet-500/30 rounded text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 text-violet-300 font-medium"
                                                />
                                                {match.suggestions && match.suggestions.length > 0 && (
                                                    <datalist id={`suggestions-${index}`}>
                                                        {match.suggestions.map((suggestion, i) => (
                                                            <option key={i} value={suggestion} />
                                                        ))}
                                                    </datalist>
                                                )}
                                                {match.suggestions && match.suggestions.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {match.suggestions.map((suggestion, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => {
                                                                    const updated = [...profanityMatches];
                                                                    updated[index].replacement = suggestion;
                                                                    setProfanityMatches(updated);
                                                                }}
                                                                className="px-2 py-0.5 bg-violet-500/20 hover:bg-violet-500/30 rounded text-[10px] text-violet-300 transition-colors"
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
                            <div className="p-2.5 bg-secondary/30 border border-border rounded flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-3.5 h-3.5 text-primary/40" />
                                    <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/60">
                                        Suggestion Engine Active
                                    </span>
                                </div>
                                <span className="text-[10px] font-semibold text-muted-foreground/40 italic">
                                    Override or generate alternatives
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Status Messages */}
                    {status === 'error' && (
                        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm animate-in slide-in-from-top-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded text-emerald-500/80 text-xs font-semibold uppercase tracking-wider animate-in slide-in-from-top-2">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Operation Complete
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/10">
                    {status === 'completed' && downloadUrl && (
                        <a href={downloadUrl} download className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
                            <Download className="w-4 h-4" />
                            Download
                        </a>
                    )}

                    <button onClick={onClose} className="px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors">
                        {status === 'completed' ? 'Done' : 'Cancel'}
                    </button>

                    {status !== 'completed' && (
                        <button
                            onClick={handleExecute}
                            disabled={status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors",
                                status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)
                                    ? "bg-accent/50 cursor-not-allowed"
                                    : "bg-accent hover:bg-accent/80"
                            )}
                        >
                            {status === 'processing' ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</> : 'Execute'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ActionModal;
