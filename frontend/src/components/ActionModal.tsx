import React, { useState, useEffect } from 'react';
import { X, Loader2, Download, EyeOff, RefreshCw, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    segmentWithSAM3,
    replaceWithPika,
    replaceWithVACE,
    blurObject,
    getDownloadUrl,
    getSegmentedDownloadUrl,
    detectObjects
} from '../services/api';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type ActionType = 'blur' | 'pixelate' | 'mask' | 'replace-pika' | 'replace-vace';

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

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setObjectPrompt(initialPrompt);
            setSuggestions([]);
            setStatus('idle');
            setDownloadUrl('');
        }
    }, [isOpen, initialPrompt]);

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
            case 'replace-pika': return 'Replace with Pika Labs';
            case 'replace-vace': return 'Replace with VACE';
            default: return 'Execute Action';
        }
    };

    const getDescription = () => {
        switch (actionType) {
            case 'blur': return `Detect "${objectPrompt}" and apply Gaussian blur.`;
            case 'pixelate': return `Detect "${objectPrompt}" and apply pixelation.`;
            case 'mask': return `Highlight "${objectPrompt}" with a colored overlay.`;
            case 'replace-pika': return `Replace "${objectPrompt}" using Pika Labs.`;
            case 'replace-vace': return `Replace "${objectPrompt}" using VACE inpainting.`;
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
                    <h2 className="font-bold text-lg flex items-center gap-2">
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
                            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
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
                        </>
                    )}

                    {/* Status Messages */}
                    {status === 'error' && (
                        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm animate-in slide-in-from-top-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm animate-in slide-in-from-top-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            Action completed successfully!
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
