import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Download, EyeOff, RefreshCw, CheckCircle2, AlertTriangle, Plus, Mic2, Volume2, Wand2, Clock } from 'lucide-react';
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
    suggestReplacements,
    generateReferenceImage
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

    // AI Image Generation state
    const [generatedImageUrl, setGeneratedImageUrl] = useState<string>('');
    const [generatedImagePath, setGeneratedImagePath] = useState<string>('');
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [imagePrompt, setImagePrompt] = useState('');
    const [dubMode, setDubMode] = useState<'auto' | 'clone' | 'beep'>('auto');
    const [voiceSampleStart, setVoiceSampleStart] = useState<number>(0);
    const [voiceSampleEnd, setVoiceSampleEnd] = useState<number>(10);

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
            setGeneratedImageUrl('');
            setGeneratedImagePath('');
            setIsGeneratingImage(false);
            setImagePrompt('');
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

    // Manually add a new segment
    const handleAddSegment = () => {
        const newSegment = {
            word: 'New Segment',
            replacement: '',
            suggestions: [],
            start_time: timestamp || 0,
            end_time: (timestamp || 0) + 2,
        };
        setProfanityMatches([...profanityMatches, newSegment]);
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

    // Handle AI image generation
    const handleGenerateImage = async () => {
        if (!imagePrompt.trim()) {
            // Use replacement prompt as fallback
            const promptToUse = replacementPrompt || 'product on white background';
            setImagePrompt(promptToUse);
        }

        const promptToUse = imagePrompt.trim() || replacementPrompt || 'product on white background';

        // Also set replacementPrompt so it's used in the Runway API call
        if (!replacementPrompt.trim()) {
            setReplacementPrompt(promptToUse);
        }

        setIsGeneratingImage(true);
        try {
            const result = await generateReferenceImage(jobId, promptToUse, '1:1');
            setGeneratedImageUrl(`http://localhost:8000${result.image_url}`);
            setGeneratedImagePath(result.image_path);
        } catch (err) {
            console.error('Image generation failed:', err);
            setError(err instanceof Error ? err.message : 'Failed to generate image');
        } finally {
            setIsGeneratingImage(false);
        }
    };



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
                    // Use Runway Gen-4 for replacement with optional reference image
                    // Supports Smart Clipping - pass timestamps to process only the relevant portion
                    // If generated image path exists, pass it; otherwise use uploaded file
                    await replaceWithRunway(
                        jobId,
                        replacementPrompt,
                        referenceImage || undefined,
                        'blurry, distorted, low quality, deformed',  // Use default negative prompt
                        5,
                        startTime,
                        endTime,
                        generatedImagePath || undefined  // Pass generated image path if available
                    );
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
                    // Censor audio with voice dubbing - pass mode and matches
                    const customReplacements = profanityMatches.reduce((acc, match) => {
                        if (match.replacement) acc[match.word] = match.replacement;
                        return acc;
                    }, {} as Record<string, string>);

                    await censorAudio(
                        jobId,
                        dubMode,
                        dubMode === 'clone' ? voiceSampleStart : undefined,
                        dubMode === 'clone' ? voiceSampleEnd : undefined,
                        undefined,
                        customReplacements,
                        profanityMatches
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
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-500" onClick={onClose} />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-[440px] max-h-[75vh] flex flex-col bg-[#09090b] rounded-[32px] border border-white/10 shadow-[0_32px_128px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                <div className="flex items-center justify-between p-6 pb-2">
                    <div className="space-y-1">
                        <h2 className="font-bold text-xl tracking-tight flex items-center gap-2.5 text-white">
                            {actionType.includes('replace') ? <RefreshCw className="w-5 h-5 text-accent/60" /> : <EyeOff className="w-5 h-5 text-accent/60" />}
                            {getTitle()}
                        </h2>
                        <p className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase opacity-50 px-0.5">{getDescription()}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-muted-foreground hover:text-white transition-all duration-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

                    <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 flex items-center gap-2">
                                Scene Target
                                {status === 'detecting' && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                            </label>

                            {/* Suggestions */}
                            {suggestions.length > 0 && (
                                <div className="flex gap-2">
                                    {suggestions.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setObjectPrompt(s)}
                                            className={cn(
                                                "text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border transition-all duration-300",
                                                objectPrompt === s
                                                    ? "bg-white text-black border-white"
                                                    : "bg-white/5 hover:bg-white/10 border-white/5 text-muted-foreground"
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
                                    "w-full px-5 py-4 bg-white/[0.02] rounded-2xl border text-sm font-medium focus:outline-none transition-all duration-300 placeholder:text-muted-foreground/20",
                                    status === 'detecting'
                                        ? "border-accent/40 animate-pulse bg-accent/[0.03]"
                                        : "border-white/5 hover:border-white/10 focus:border-white/20 focus:bg-white/[0.04] focus:ring-4 focus:ring-white/[0.02]"
                                )}
                                placeholder={status === 'detecting' ? "Analyzing frames..." : "Describe the object (e.g., 'the red backpack')"}
                            />
                        </div>
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

                            {actionType === 'replace-runway' && startTime !== undefined && endTime !== undefined && (
                                <div className="p-4 bg-accent/[0.03] border border-accent/10 rounded-2xl space-y-3">
                                    <div className="flex items-center gap-2">

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

                            {/* Reference Image Options for Runway */}
                            {actionType === 'replace-runway' && (
                                <div className="space-y-3">
                                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-2">
                                        <Sparkles className="w-3 h-3 text-accent" />
                                        Reference Image (Optional - for grounded replacement)
                                    </label>

                                    {/* Generate with AI Section */}
                                    <div className="p-4 bg-gradient-to-br from-accent/[0.03] to-purple-500/[0.03] border border-accent/20 rounded-2xl space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-accent/80">Generate with Gemini 3</span>
                                            {generatedImageUrl && (
                                                <span className="text-[9px] font-medium text-emerald-400 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    Ready to use
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={imagePrompt || replacementPrompt}
                                                onChange={(e) => setImagePrompt(e.target.value)}
                                                placeholder="e.g., Coca-Cola bottle, product shot"
                                                className="flex-1 px-3 py-2 bg-[#111113] border border-white/10 rounded-xl text-sm focus:border-accent/60 focus:outline-none transition-all"
                                            />
                                            <button
                                                onClick={handleGenerateImage}
                                                disabled={isGeneratingImage}
                                                className="flex items-center gap-2 px-4 py-2 bg-accent/20 hover:bg-accent/30 disabled:opacity-50 text-accent rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                                            >
                                                {isGeneratingImage ? (
                                                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating...</>
                                                ) : generatedImageUrl ? (
                                                    <><RefreshCw className="w-3.5 h-3.5" />Regenerate</>
                                                ) : (
                                                    <><Sparkles className="w-3.5 h-3.5" />Generate</>
                                                )}
                                            </button>
                                        </div>

                                        {/* Generated Image Preview */}
                                        {generatedImageUrl && (
                                            <div className="relative group">
                                                <img
                                                    src={generatedImageUrl}
                                                    alt="Generated reference"
                                                    className="w-full h-32 object-contain bg-[#0a0a0c] border border-white/10 rounded-xl"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-end justify-center pb-3">
                                                    <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">AI Generated</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Divider */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-px bg-white/10" />
                                        <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">or upload</span>
                                        <div className="flex-1 h-px bg-white/10" />
                                    </div>

                                    {/* Upload Option */}
                                    <div className="relative group">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                setReferenceImage(e.target.files?.[0] || null);
                                                setGeneratedImageUrl(''); // Clear generated image when uploading
                                                setGeneratedImagePath('');
                                            }}
                                            className="w-full px-4 py-3 bg-[#111113] border border-white/10 rounded-xl text-sm file:mr-4 file:px-4 file:py-1 file:rounded-lg file:border-0 file:bg-white/10 file:text-muted-foreground file:text-xs file:font-bold hover:border-white/20 transition-all cursor-pointer"
                                        />
                                    </div>
                                    {referenceImage && (
                                        <p className="text-[11px] text-emerald-400/80 flex items-center gap-1.5 px-0.5">
                                            <CheckCircle2 className="w-3 h-3" />
                                            {referenceImage.name}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}


                    {/* Enhanced Word Replacement with Gemini Suggestions (for voice dub mode) */}
                    {actionType === 'censor-dub' && (
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                                            ElevenLabs Dub Engine
                                        </label>
                                        <p className="text-[9px] text-muted-foreground/40 font-medium">Select synthesis strategy</p>
                                    </div>
                                    <div className="flex bg-black/40 p-1.5 rounded-xl border border-white/5">
                                        {(['auto', 'clone', 'beep'] as const).map((m) => (
                                            <button
                                                key={m}
                                                onClick={() => setDubMode(m)}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all duration-300",
                                                    dubMode === m
                                                        ? "bg-white text-black shadow-xl"
                                                        : "text-muted-foreground/60 hover:text-white"
                                                )}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-white/5 border border-white/5 shadow-inner">
                                            <Mic2 className="w-4.5 h-4.5 text-white/80" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <span className="text-[12px] font-bold text-white tracking-wide block leading-none">
                                                {dubMode === 'auto' ? 'Self-Cloning' : dubMode === 'clone' ? 'Precision Target' : 'Fast Semantic Mask'}
                                            </span>
                                            <p className="text-[10px] text-muted-foreground/50 leading-none">
                                                {dubMode === 'auto' ? 'Multi-speaker cloning' :
                                                    dubMode === 'clone' ? 'Source-specific fidelity' :
                                                        'High-speed censorship'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleAddSegment}
                                            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border border-white/5"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            Manual
                                        </button>
                                        <button
                                            onClick={handleManualGenerate}
                                            disabled={loadingSuggestions || profanityMatches.length === 0}
                                            className="flex items-center gap-2 px-4 py-2 bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-300 shadow-xl shadow-white/5"
                                        >
                                            {loadingSuggestions ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Wand2 className="w-3.5 h-3.5" />
                                            )}
                                            Suggest
                                        </button>
                                    </div>
                                </div>

                                {/* Voice Cloning Sample Selector */}
                                {dubMode === 'clone' && (
                                    <div className="mt-2 p-5 bg-white/[0.03] border border-white/5 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">
                                                    <Volume2 className="w-4 h-4 text-white/40" />
                                                </div>
                                                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">Clone Source Range</span>
                                            </div>
                                            <span className="text-[9px] text-muted-foreground/30 font-mono tracking-tight">5-10s sample</span>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-1 space-y-2">
                                                <label className="text-[8px] font-bold uppercase text-muted-foreground/40 ml-1 tracking-[0.1em]">Start Time</label>
                                                <div className="flex items-center gap-3 bg-black/60 rounded-xl px-4 py-3 border border-white/5 group focus-within:border-white/20 transition-all">
                                                    <Clock className="w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-white/60 transition-colors" />
                                                    <input
                                                        type="number"
                                                        value={voiceSampleStart}
                                                        onChange={(e) => setVoiceSampleStart(parseFloat(e.target.value))}
                                                        className="bg-transparent border-none text-xs font-bold font-mono w-full focus:ring-0 p-0 text-white/90"
                                                    />
                                                    <span className="text-[10px] opacity-20 font-mono">s</span>
                                                </div>
                                            </div>
                                            <div className="flex-1 space-y-2">
                                                <label className="text-[8px] font-bold uppercase text-muted-foreground/40 ml-1 tracking-[0.1em]">End Time</label>
                                                <div className="flex items-center gap-3 bg-black/60 rounded-xl px-4 py-3 border border-white/5 group focus-within:border-white/20 transition-all">
                                                    <Clock className="w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-white/60 transition-colors" />
                                                    <input
                                                        type="number"
                                                        value={voiceSampleEnd}
                                                        onChange={(e) => setVoiceSampleEnd(parseFloat(e.target.value))}
                                                        className="bg-transparent border-none text-xs font-bold font-mono w-full focus:ring-0 p-0 text-white/90"
                                                    />
                                                    <span className="text-[10px] opacity-20 font-mono">s</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {loadingSuggestions && profanityMatches.length === 0 ? (
                                <div className="p-6 bg-white/[0.02] border border-white/5 rounded-xl text-center space-y-2">
                                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-white/20" />
                                    <p className="text-[10px] text-muted-foreground/40 italic">Synthesizing alternatives...</p>
                                </div>
                            ) : profanityMatches.length === 0 ? (
                                <div className="p-6 bg-white/[0.02] border border-white/5 rounded-xl text-center space-y-2">
                                    <p className="text-[10px] text-muted-foreground/40 font-medium uppercase tracking-widest">No segments identified</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {profanityMatches.map((match, index) => (
                                        <div key={index} className="p-5 bg-white/[0.02] border border-white/5 rounded-[24px] space-y-5 group hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300">
                                            {/* Word to Replace */}
                                            <div className="flex items-start justify-between gap-5">
                                                <div className="space-y-4 flex-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20">Temporal Metadata</span>
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1.5 bg-black/40 rounded-lg px-2 py-1 border border-white/5">
                                                                <input
                                                                    type="number"
                                                                    step="0.1"
                                                                    value={match.start_time}
                                                                    onChange={(e) => {
                                                                        const updated = [...profanityMatches];
                                                                        updated[index].start_time = parseFloat(e.target.value);
                                                                        setProfanityMatches(updated);
                                                                    }}
                                                                    className="w-12 bg-transparent border-none text-[10px] p-0 font-bold font-mono text-white/60 focus:ring-0"
                                                                />
                                                                <span className="text-[8px] font-bold opacity-20 font-mono">s</span>
                                                            </div>
                                                            <span className="text-[10px] font-bold opacity-10">/</span>
                                                            <div className="flex items-center gap-1.5 bg-black/40 rounded-lg px-2 py-1 border border-white/5">
                                                                <input
                                                                    type="number"
                                                                    step="0.1"
                                                                    value={match.end_time}
                                                                    onChange={(e) => {
                                                                        const updated = [...profanityMatches];
                                                                        updated[index].end_time = parseFloat(e.target.value);
                                                                        setProfanityMatches(updated);
                                                                    }}
                                                                    className="w-12 bg-transparent border-none text-[10px] p-0 font-bold font-mono text-white/60 focus:ring-0"
                                                                />
                                                                <span className="text-[8px] font-bold opacity-20 font-mono">s</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="relative">
                                                        <input
                                                            value={match.word}
                                                            onChange={(e) => {
                                                                const updated = [...profanityMatches];
                                                                updated[index].word = e.target.value;
                                                                setProfanityMatches(updated);
                                                            }}
                                                            className="w-full px-4 py-3 bg-red-500/[0.02] border border-red-500/10 rounded-xl text-sm font-bold text-red-100 placeholder:text-red-900/20 focus:outline-none focus:border-red-500/30 transition-all"
                                                            placeholder="Segment identifier..."
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const updated = profanityMatches.filter((_, i) => i !== index);
                                                        setProfanityMatches(updated);
                                                    }}
                                                    className="p-2 bg-white/5 hover:bg-red-500/10 rounded-xl text-muted-foreground/20 hover:text-red-400 transition-all duration-300 border border-transparent hover:border-red-500/20"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Replacement Prompt */}
                                            <div className="space-y-3 pt-4 border-t border-white/5">
                                                <div className="flex items-center gap-2 px-1">
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">Dub Target Context</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={match.replacement}
                                                    onChange={(e) => {
                                                        const updated = [...profanityMatches];
                                                        updated[index].replacement = e.target.value;
                                                        setProfanityMatches(updated);
                                                    }}
                                                    placeholder="Synthesize alternative text..."
                                                    className="w-full px-5 py-3.5 bg-black/40 border border-white/5 rounded-2xl text-sm font-bold focus:outline-none focus:border-white/20 text-white transition-all duration-300"
                                                />
                                                {match.suggestions && match.suggestions.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-3 px-1">
                                                        {match.suggestions.map((suggestion, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => {
                                                                    const updated = [...profanityMatches];
                                                                    updated[index].replacement = suggestion;
                                                                    setProfanityMatches(updated);
                                                                }}
                                                                className={cn(
                                                                    "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-300",
                                                                    match.replacement === suggestion
                                                                        ? "bg-white text-black shadow-lg"
                                                                        : "bg-white/5 hover:bg-white/10 text-muted-foreground/40 hover:text-white border border-white/5"
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
                                    <span className="text-[9px] uppercase font-bold tracking-[0.1em] text-muted-foreground/40">
                                        Intelligent Synthesis Active
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Status Messages */}
                    <div className="px-4 py-2 flex flex-col gap-2">
                        {status === 'error' && (
                            <div className="flex items-center gap-2 p-2.5 bg-red-500/[0.03] border border-red-500/10 rounded-xl text-red-400 text-[10px] font-bold animate-in slide-in-from-top-2 duration-300">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {status === 'completed' && (
                            <div className="flex items-center gap-2 p-2.5 bg-emerald-500/[0.03] border border-emerald-500/10 rounded-xl text-emerald-400 text-[10px] font-bold animate-in slide-in-from-top-2 duration-300">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Operation Successful</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-4 p-6 pt-2 bg-white/[0.02] border-t border-white/5">
                    {status === 'completed' && downloadUrl && (
                        <a href={downloadUrl} download className="btn-primary flex items-center gap-2 bg-emerald-500 text-white border-emerald-400/20 hover:bg-emerald-400 active:scale-95">
                            <Download className="w-4 h-4" />
                            Export Result
                        </a>
                    )}

                    <button
                        onClick={onClose}
                        className="px-6 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 hover:text-white transition-all duration-300"
                    >
                        {status === 'completed' ? 'Close' : 'Cancel'}
                    </button>

                    {status !== 'completed' && (
                        <button
                            onClick={handleExecute}
                            disabled={status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)}
                            className="bg-white text-black px-8 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white/90 active:scale-95 transition-all disabled:opacity-20 flex items-center gap-2"
                        >
                            {status === 'processing' ? <><Loader2 className="w-4 h-4 animate-spin" />Processing</> : 'Apply Modifications'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ActionModal;
