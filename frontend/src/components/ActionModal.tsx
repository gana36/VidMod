import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download, EyeOff, RefreshCw, CheckCircle2, AlertTriangle, Plus, Mic2, Volume2, Wand2, Clock, Sparkles, Search, Trash2 } from 'lucide-react';
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
    onActionComplete?: (result: { type: ActionType; downloadUrl?: string; objectName?: string; text_prompt?: string }) => void;
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
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
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
    const [intensity, setIntensity] = useState<number>(30);

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

            // Auto-load profanity for censor modes (with guard)
            if ((actionType === 'censor-dub' || actionType === 'censor-beep') && !isLoadingRef.current) {
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
                    await blurObject(jobId, objectPrompt, intensity, 'blur', startTime, endTime);
                    finalDownloadUrl = getDownloadUrl(jobId);
                    break;

                case 'pixelate':
                    // Use blur endpoint with pixelate effect
                    await blurObject(jobId, objectPrompt, intensity, 'pixelate', startTime, endTime);
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
                    // Extract unique words for word-based search as requested
                    const uniqueWords = Array.from(new Set(profanityMatches.map(m => m.word.trim()).filter(Boolean)));

                    await censorAudio(
                        jobId,
                        'beep',
                        undefined,
                        undefined,
                        uniqueWords, // Pass as custom_words to trigger precision search
                        undefined,
                        undefined    // DON'T pass matches, force backend word-search for "dont fixate on time"
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
            onActionComplete?.({
                type: actionType,
                downloadUrl: finalDownloadUrl,
                objectName: objectPrompt,
                text_prompt: replacementPrompt || objectPrompt
            });

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
            case 'replace-runway': return 'Gen-AI Replacement';
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
            case 'replace-runway': return `Execute generative refactor on "${objectPrompt}".`;
            case 'censor-beep': return `Apply frequency-based audio masking to detected profanity.`;
            case 'censor-dub': return `Apply neural voice synthesis to remediate detected profanity.`;
            default: return '';
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-8">
            {/* Backdrop - Transparent to allow full visibility */}
            <div className="absolute inset-0 bg-transparent animate-in fade-in duration-500" onClick={onClose} />

            {/* Modal - Expanded for popover feel */}
            <div className="relative z-10 w-full max-w-[720px] max-h-[85vh] flex flex-col bg-[#09090b] rounded-[32px] border border-white/10 shadow-[0_32px_128px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                <div className="flex items-center justify-between p-6 sm:p-8 pb-4">
                    <div className="space-y-1 min-w-0 flex-1">
                        <h2 className="font-bold text-xl sm:text-2xl tracking-tight flex items-center gap-3 text-white">
                            {actionType.includes('replace') ? <RefreshCw className="w-5 h-5 sm:w-6 s:h-6 text-accent/60 shrink-0" /> : <EyeOff className="w-5 h-5 sm:w-6 s:h-6 text-accent/60 shrink-0" />}
                            <span className="truncate">{getTitle()}</span>
                        </h2>
                        <p className="text-[11px] sm:text-xs text-muted-foreground font-medium tracking-wide uppercase opacity-50 px-0.5 truncate">{getDescription()}</p>
                    </div>
                    <button onClick={onClose} className="p-2.5 rounded-full hover:bg-white/5 text-muted-foreground hover:text-white transition-all duration-200 shrink-0 ml-4 cursor-pointer">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 pt-2 space-y-6 sm:space-y-8 custom-scrollbar">

                    {/* Target Selection (Common) */}
                    {(actionType === 'blur' || actionType === 'pixelate' || actionType === 'mask' || actionType.includes('replace')) && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <label className="label-sm flex items-center gap-2">
                                    Target Object
                                    {status === 'detecting' && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                                </label>

                                {suggestions.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggestions.map((s) => (
                                            <button
                                                key={s}
                                                onClick={() => setObjectPrompt(s)}
                                                className={cn(
                                                    "badge transition-colors cursor-pointer",
                                                    objectPrompt === s ? "bg-white text-zinc-900 border-white" : "hover:bg-white/5"
                                                )}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <input
                                value={objectPrompt}
                                onChange={(e) => setObjectPrompt(e.target.value)}
                                className={cn(
                                    "input",
                                    status === 'detecting' && "border-zinc-600 animate-pulse"
                                )}
                                placeholder={status === 'detecting' ? "Analyzing..." : "Describe the object (e.g., 'the red backpack')"}
                            />
                        </div>
                    )}

                    {/* Intensity Slider (for Blur/Pixelate) */}
                    {(actionType === 'blur' || actionType === 'pixelate') && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="label-sm">Effect Intensity</label>
                                <span className="mono text-xs text-white bg-white/10 px-2 py-0.5 rounded-md">{intensity}px</span>
                            </div>
                            <input
                                type="range"
                                min="5"
                                max="100"
                                value={intensity}
                                onChange={(e) => setIntensity(parseInt(e.target.value))}
                                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                            />
                            <div className="flex justify-between text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                                <span>Subtle</span>
                                <span>Aggressive</span>
                            </div>
                        </div>
                    )}

                    {/* Mask Only Checkbox */}
                    {(actionType === 'blur' || actionType === 'pixelate' || actionType === 'mask') && (
                        <div className="surface-2 rounded-xl p-3 border border-border">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative flex items-center justify-center shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={maskOnly}
                                        onChange={(e) => setMaskOnly(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-4 h-4 rounded border border-zinc-700 bg-zinc-900 peer-checked:bg-white peer-checked:border-white transition-all" />
                                    <CheckCircle2 className="absolute w-3 h-3 text-zinc-900 opacity-0 peer-checked:opacity-100 transition-opacity" />
                                </div>
                                <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">Apply effect to segment only</span>
                            </label>
                        </div>
                    )}

                    {/* Replacement Specific Fields */}
                    {actionType.includes('replace') && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="label-sm">Replacement Prompt</label>
                                <input
                                    type="text"
                                    value={replacementPrompt}
                                    onChange={(e) => setReplacementPrompt(e.target.value)}
                                    placeholder="e.g., red Coca-Cola can"
                                    className="input"
                                />
                            </div>

                            {/* Gen-AI Process Info */}
                            {actionType === 'replace-runway' && startTime !== undefined && endTime !== undefined && (
                                <div className="surface-2 border border-border rounded-xl overflow-hidden">
                                    <div className="p-3 bg-white/3 border-b border-border flex items-center justify-between">
                                        <span className="label-sm !text-zinc-300">Smart Clipping</span>
                                        <div className="badge badge-success !text-[10px]">Active</div>
                                    </div>
                                    <div className="p-4 flex items-center justify-around gap-4 text-center">
                                        <div className="space-y-1 flex-1">
                                            <span className="label-sm !text-[9px] !text-zinc-500 block">Start</span>
                                            <span className="mono text-sm text-zinc-200">{startTime.toFixed(2)}s</span>
                                        </div>
                                        <div className="divider-v !h-8 opacity-50" />
                                        <div className="space-y-1 flex-1">
                                            <span className="label-sm !text-[9px] !text-zinc-500 block">End</span>
                                            <span className="mono text-sm text-zinc-200">{endTime.toFixed(2)}s</span>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-white/3 text-[10px] text-zinc-500 text-center border-t border-border">
                                        Precision temporal processing enabled
                                    </div>
                                </div>
                            )}

                            {/* Pika Reference Image Option */}
                            {actionType === 'replace-pika' && (
                                <div className="space-y-3">
                                    <label className="label-sm">Reference Image (Required)</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => setReferenceImage(e.target.files?.[0] || null)}
                                        className="input file:mr-3 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-zinc-700 file:text-zinc-300 file:text-xs file:font-medium cursor-pointer"
                                    />
                                    {referenceImage && (
                                        <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                                            <CheckCircle2 className="w-3 h-3" />
                                            {referenceImage.name}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* AI Image Generation Option for Gen-AI Replace */}
                            {actionType === 'replace-runway' && (
                                <div className="card !bg-surface-2 border-border/50 p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="label-sm flex items-center gap-2 !text-zinc-400">
                                            <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
                                            Gemini Image Generator
                                        </label>
                                        {generatedImageUrl && (
                                            <span className="badge badge-success !text-[10px]">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Ready
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={imagePrompt || replacementPrompt}
                                            onChange={(e) => setImagePrompt(e.target.value)}
                                            placeholder="Describe scene..."
                                            className="input text-xs"
                                        />
                                        <button
                                            onClick={handleGenerateImage}
                                            disabled={isGeneratingImage}
                                            className="btn-secondary !text-[10px] !px-3 shrink-0"
                                        >
                                            {isGeneratingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate'}
                                        </button>
                                    </div>

                                    {generatedImageUrl && (
                                        <div className="relative group cursor-zoom-in" onClick={() => setZoomedImage(generatedImageUrl)}>
                                            <img
                                                src={generatedImageUrl}
                                                alt="Generated reference"
                                                className="w-full h-32 object-contain bg-[#0a0a0c] border border-white/10 rounded-xl"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-end justify-center pb-3">
                                                <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Click to preview</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Word Replacement / Audio Censorship Controls */}
                    {(actionType === 'censor-dub' || actionType === 'censor-beep') && (
                        <div className="space-y-4">
                            {actionType === 'censor-dub' && (
                                <div className="card !bg-surface-2 border-border/50 p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label className="label-sm !text-zinc-300">ElevenLabs Dub Engine</label>
                                            <p className="text-[10px] text-zinc-500">Select synthesis strategy</p>
                                        </div>
                                        <div className="flex bg-zinc-900 p-1 rounded-lg border border-border">
                                            {(['auto', 'clone', 'beep'] as const).map((m) => (
                                                <button
                                                    key={m}
                                                    onClick={() => setDubMode(m)}
                                                    className={cn(
                                                        "px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                                                        dubMode === m ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-white"
                                                    )}
                                                >
                                                    {m}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-1">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-border">
                                                <Mic2 className="w-4 h-4 text-zinc-400" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <span className="text-xs font-semibold text-white block">
                                                    {dubMode === 'auto' ? 'Self-Cloning' : dubMode === 'clone' ? 'Precision Target' : 'Fast Semantic Mask'}
                                                </span>
                                                <p className="text-[10px] text-zinc-500">
                                                    {dubMode === 'auto' ? 'Multi-speaker cloning' : dubMode === 'clone' ? 'Source-specific fidelity' : 'High-speed censorship'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleAddSegment} className="btn-secondary !p-2">
                                                <Plus className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={handleManualGenerate}
                                                disabled={loadingSuggestions || profanityMatches.length === 0}
                                                className="btn-primary !text-[10px] !px-3"
                                            >
                                                {loadingSuggestions ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                                <span className="hidden sm:inline ml-1">Suggest</span>
                                            </button>
                                        </div>
                                    </div>

                                    {dubMode === 'clone' && (
                                        <div className="mt-2 p-4 surface-3 border border-border rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="flex items-center gap-3">
                                                <Volume2 className="w-3.5 h-3.5 text-zinc-500" />
                                                <span className="label-sm !text-zinc-400">Clone Source Range</span>
                                            </div>
                                            <div className="flex gap-3">
                                                <div className="flex-1 space-y-1">
                                                    <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Start</label>
                                                    <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-border">
                                                        <Clock className="w-3 h-3 text-zinc-600" />
                                                        <input
                                                            type="number"
                                                            value={voiceSampleStart}
                                                            onChange={(e) => setVoiceSampleStart(parseFloat(e.target.value))}
                                                            className="bg-transparent border-none text-xs font-mono w-full focus:ring-0 p-0 text-white"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">End</label>
                                                    <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-border">
                                                        <Clock className="w-3 h-3 text-zinc-600" />
                                                        <input
                                                            type="number"
                                                            value={voiceSampleEnd}
                                                            onChange={(e) => setVoiceSampleEnd(parseFloat(e.target.value))}
                                                            className="bg-transparent border-none text-xs font-mono w-full focus:ring-0 p-0 text-white"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {actionType === 'censor-beep' && (
                                <div className="card !bg-surface-2 border-border/50 p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label className="label-sm !text-zinc-300">Automated Remediation</label>
                                            <p className="text-[10px] text-zinc-500">Audio will be masked with frequency-based tones</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <span className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-wider">Active</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-1">
                                        <div className="flex items-center gap-3">
                                            <Volume2 className="w-4 h-4 text-zinc-400" />
                                            <div className="space-y-0.5">
                                                <span className="text-xs font-semibold text-white block">Beep Masking</span>
                                                <p className="text-[10px] text-zinc-500">Industry standard obscenity filter</p>
                                            </div>
                                        </div>
                                        <button onClick={handleAddSegment} className="btn-secondary !p-2">
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Remediation UI - Word-Based for Beep, Card-Based for Dubbing */}
                            <div className="space-y-4 pt-4 border-t border-border/50">
                                {actionType === 'censor-beep' && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="label-sm">Words to Beep</label>
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                                                {new Set(profanityMatches.map(m => m.word.trim().toLowerCase())).size} Unique Words
                                            </span>
                                        </div>
                                        <div className="surface-2 rounded-xl p-4 border border-border/50 space-y-4">
                                            <div className="flex flex-wrap gap-2">
                                                {Array.from(new Set(profanityMatches.map(m => m.word.trim().toLowerCase()).filter(Boolean))).map((word, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-200 px-3 py-1.5 rounded-lg text-sm group">
                                                        <span className="font-medium">{word}</span>
                                                        <button
                                                            onClick={() => {
                                                                setProfanityMatches(prev => prev.filter(m => m.word.trim().toLowerCase() !== word));
                                                            }}
                                                            className="text-red-500/40 hover:text-red-400 p-0.5 transition-colors"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                                {profanityMatches.length === 0 && (
                                                    <div className="w-full text-center py-4 text-zinc-500 text-xs italic">
                                                        No words added yet. Gemini will detect profanity automatically, or you can add custom words below.
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <input
                                                        type="text"
                                                        id="beep-word-input"
                                                        placeholder="Add custom word (e.g. 'hell')"
                                                        className="w-full bg-zinc-900 border border-zinc-700/50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-white/20 transition-all font-medium text-white"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const value = e.currentTarget.value.trim();
                                                                if (value) {
                                                                    setProfanityMatches(prev => [...prev, { word: value, start_time: 0, end_time: 0, replacement: '[censored]' }]);
                                                                    e.currentTarget.value = '';
                                                                }
                                                            }
                                                        }}
                                                    />
                                                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const el = document.getElementById('beep-word-input') as HTMLInputElement;
                                                        if (el && el.value.trim()) {
                                                            setProfanityMatches(prev => [...prev, { word: el.value.trim(), start_time: 0, end_time: 0, replacement: '[censored]' }]);
                                                            el.value = '';
                                                        }
                                                    }}
                                                    className="btn-secondary !bg-white/5 hover:!bg-white/10 !px-4 !py-2 text-xs"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                                <Volume2 className="w-4 h-4 text-zinc-400" />
                                                <p className="text-[10px] text-zinc-400 leading-tight">
                                                    <span className="text-white font-semibold">Word-Based Synthesis:</span> Gemini will scan the entire audio for these words and apply precise sub-second alignment automatically.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {actionType === 'censor-dub' && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="label-sm">Remediation Segments</label>
                                            <button onClick={handleAddSegment} className="btn-secondary !p-1.5 opacity-60 hover:opacity-100">
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        {loadingSuggestions && profanityMatches.length === 0 ? (
                                            <div className="p-8 surface-2 border border-border rounded-xl text-center space-y-3">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto text-zinc-500" />
                                                <p className="text-xs text-zinc-500 italic">Synthesizing alternatives...</p>
                                            </div>
                                        ) : profanityMatches.length === 0 ? (
                                            <div className="p-8 surface-2 border border-border rounded-xl text-center">
                                                <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">No segments identified</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {profanityMatches.map((match, index) => (
                                                    <div key={index} className="card p-4 space-y-4 hover:border-zinc-700 transition-colors group">
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div className="space-y-3 flex-1">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="label-sm !text-zinc-600 uppercase tracking-widest !text-[9px]">Segment {index + 1}</span>
                                                                        {match.confidence && (
                                                                            <span className="text-[9px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-zinc-400">
                                                                                {Math.round(parseFloat(match.confidence) * 100)}% Conf.
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 bg-zinc-900 rounded px-2 py-0.5 border border-border">
                                                                        <span className="text-[10px] mono text-zinc-400">{match.start_time.toFixed(1)}s - {match.end_time.toFixed(1)}s</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex-1 space-y-1">
                                                                        <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Start</label>
                                                                        <input
                                                                            type="number"
                                                                            step="0.1"
                                                                            value={match.start_time}
                                                                            onChange={(e) => {
                                                                                const updated = [...profanityMatches];
                                                                                updated[index].start_time = parseFloat(e.target.value);
                                                                                setProfanityMatches(updated);
                                                                            }}
                                                                            className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-[10px] font-mono text-zinc-300 focus:outline-none focus:border-primary/50"
                                                                        />
                                                                    </div>
                                                                    <div className="flex-1 space-y-1">
                                                                        <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">End</label>
                                                                        <input
                                                                            type="number"
                                                                            step="0.1"
                                                                            value={match.end_time}
                                                                            onChange={(e) => {
                                                                                const updated = [...profanityMatches];
                                                                                updated[index].end_time = parseFloat(e.target.value);
                                                                                setProfanityMatches(updated);
                                                                            }}
                                                                            className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-[10px] font-mono text-zinc-300 focus:outline-none focus:border-primary/50"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Target Word</label>
                                                                    <input
                                                                        value={match.word}
                                                                        onChange={(e) => {
                                                                            const updated = [...profanityMatches];
                                                                            updated[index].word = e.target.value;
                                                                            setProfanityMatches(updated);
                                                                        }}
                                                                        className="w-full bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 text-sm font-medium text-red-200 focus:outline-none focus:border-red-500/40"
                                                                        placeholder="Word/Phrase"
                                                                    />
                                                                </div>

                                                                <div className="space-y-2 pt-3 border-t border-border">
                                                                    <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Replacement</label>
                                                                    <input
                                                                        type="text"
                                                                        value={match.replacement}
                                                                        onChange={(e) => {
                                                                            const updated = [...profanityMatches];
                                                                            updated[index].replacement = e.target.value;
                                                                            setProfanityMatches(updated);
                                                                        }}
                                                                        placeholder="Alternative text..."
                                                                        className="w-full bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
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
                                                                                        "bg-zinc-800 hover:bg-zinc-700 text-[10px] px-2 py-0.5 rounded border border-border transition-colors",
                                                                                        match.replacement === suggestion ? "bg-white text-zinc-900 border-white" : ""
                                                                                    )}
                                                                                >
                                                                                    {suggestion}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    setProfanityMatches(prev => prev.filter((_, i) => i !== index));
                                                                }}
                                                                className="text-zinc-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-all"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Synthesis Banner */}
                            <div className="surface-2 rounded-xl p-3 border border-border flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    <span className="label-sm !text-zinc-500 !text-[9px]">Intelligent Synthesis Active</span>
                                </div>
                                <Sparkles className="w-3 h-3 text-zinc-700" />
                            </div>
                        </div>
                    )}

                    {/* Status Messages */}
                    <div className="space-y-2">
                        {status === 'error' && (
                            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-semibold animate-in slide-in-from-top-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {status === 'completed' && (
                            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-semibold animate-in slide-in-from-top-2">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                <span>Operation Successful</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-4 sm:p-6 border-t border-border surface-2">
                    {status === 'completed' && downloadUrl && (
                        <a href={downloadUrl} download className="btn-primary bg-emerald-500 hover:bg-emerald-400 text-white text-xs sm:text-sm">
                            <Download className="w-4 h-4" />
                            <span className="hidden sm:inline">Export Result</span>
                            <span className="sm:hidden">Export</span>
                        </a>
                    )}

                    <button
                        onClick={onClose}
                        className="btn-ghost text-xs cursor-pointer"
                    >
                        {status === 'completed' ? 'Close' : 'Cancel'}
                    </button>

                    {status !== 'completed' && (
                        <button
                            onClick={handleExecute}
                            disabled={status === 'processing' || status === 'detecting' || (actionType === 'replace-pika' && !referenceImage)}
                            className="btn-primary text-xs sm:text-sm"
                        >
                            {status === 'processing' ? (
                                <><Loader2 className="w-4 h-4 animate-spin" />Processing</>
                            ) : (
                                <><span className="hidden sm:inline">Apply Modifications</span><span className="sm:hidden">Apply</span></>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Image Zoom Portal */}
            {zoomedImage && createPortal(
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-in fade-in duration-300"
                    onClick={() => setZoomedImage(null)}
                >
                    <button
                        className="absolute top-8 right-8 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all z-[1001]"
                        onClick={() => setZoomedImage(null)}
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <img
                        src={zoomedImage}
                        alt="Zoomed reference"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl animate-in zoom-in-95 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>,
                document.body
            )}
        </div>,
        document.body
    );
};

export default ActionModal;
