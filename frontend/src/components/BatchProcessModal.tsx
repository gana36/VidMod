import React from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Play, Loader2, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { type Finding } from './VideoWorkspace';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export interface BatchFindingConfig {
    finding: Finding;
    selected: boolean;
    effectType: 'blur' | 'pixelate' | 'replace-runway' | 'censor-beep' | 'censor-dub';
    prompt: string;
    replacementPrompt: string;
    referenceImagePath?: string;
    startTime: number;
    endTime: number;
    intensity?: number;
    beepWords?: string[];
    profanityMatches?: {
        word: string;
        start_time: number;
        end_time: number;
        replacement: string;
        confidence?: string;
        suggestions?: string[];
    }[];
}

interface BatchProcessModalProps {
    isOpen: boolean;
    onClose: () => void;
    batchConfigs: BatchFindingConfig[];
    onUpdateConfigs: (configs: BatchFindingConfig[]) => void;
    onProcess: () => void;
    generatingImageIndex: number | null;
    generatedImages: Record<number, { url: string; path: string }>;
    onGenerateImage: (index: number) => void;
}

const BatchProcessModal: React.FC<BatchProcessModalProps> = ({
    isOpen,
    onClose,
    batchConfigs,
    onUpdateConfigs,
    onProcess,
    generatingImageIndex,
    generatedImages,
    onGenerateImage
}) => {
    const [zoomedImage, setZoomedImage] = React.useState<string | null>(null);

    if (!isOpen) return null;

    const selectedCount = batchConfigs.filter(c => c.selected).length;

    const handleToggleSelect = (index: number) => {
        const updated = [...batchConfigs];
        updated[index].selected = !updated[index].selected;
        console.log(`Toggled segment ${index}: ${updated[index].finding.content.substring(0, 30)} -> Selected: ${updated[index].selected}`);
        onUpdateConfigs(updated);
    };

    const handleUpdateConfig = (index: number, updates: Partial<BatchFindingConfig>) => {
        const updated = [...batchConfigs];
        updated[index] = { ...updated[index], ...updates };
        onUpdateConfigs(updated);
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop - Transparent to allow full visibility */}
            <div
                className="absolute inset-0 bg-transparent animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Modal Container */}
            <div className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-[#09090b] border border-white/10 shadow-[0_32px_128px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] rounded-[32px] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border bg-surface-2/50">
                    <div className="space-y-1">
                        <h2 className="text-xl font-semibold text-white tracking-tight">Batch Pipeline Configuration</h2>
                        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">
                            Configure multiple remediation segments for bulk processing
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/5 text-zinc-500 hover:text-white transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-surface-1">
                    {batchConfigs.map((config, index) => (
                        <div
                            key={index}
                            className={cn(
                                "p-6 border transition-all duration-200 rounded-[20px] space-y-5 group relative",
                                config.selected
                                    ? "border-primary/40 bg-surface-2 shadow-lg opacity-100"
                                    : "border-border/50 bg-surface-1/50 hover:border-border opacity-40 grayscale"
                            )}
                        >
                            {!config.selected && (
                                <div className="absolute top-3 right-3 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                                    Skipped
                                </div>
                            )}
                            {/* Header: Detection Type + Timestamp */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <label className="relative flex items-center justify-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={config.selected}
                                            onChange={() => handleToggleSelect(index)}
                                            className="peer sr-only"
                                        />
                                        <div className="w-5 h-5 border border-border rounded-lg bg-zinc-900 peer-checked:bg-primary peer-checked:border-primary transition-all duration-200" />
                                        <CheckCircle2 className="absolute w-3.5 h-3.5 text-black scale-0 peer-checked:scale-100 transition-transform duration-200" />
                                    </label>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-primary uppercase tracking-[0.15em]">
                                            {config.finding.type}
                                        </span>
                                        <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">
                                            Segment {index + 1}
                                        </span>
                                    </div>
                                </div>
                                <div className="px-3 py-1 bg-zinc-900 border border-border rounded-lg flex items-center gap-2 text-[10px] font-bold text-zinc-400 font-mono">
                                    <Play className="w-3 h-3 text-primary/40" />
                                    {Math.floor(config.startTime / 60)}:{String(Math.floor(config.startTime % 60)).padStart(2, '0')} - {Math.floor(config.endTime / 60)}:{String(Math.floor(config.endTime % 60)).padStart(2, '0')}
                                </div>
                            </div>

                            {/* Raw Detection Content */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 px-1">
                                    <div className="w-1 h-3 bg-red-500/40 rounded-full" />
                                    <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-500">Detection Content</span>
                                </div>
                                <textarea
                                    value={config.prompt}
                                    onChange={(e) => handleUpdateConfig(index, { prompt: e.target.value })}
                                    className="w-full px-4 py-3 text-xs bg-zinc-900/50 border border-border rounded-xl focus:outline-none focus:border-primary/30 resize-none text-zinc-300 transition-all leading-relaxed"
                                    rows={2}
                                />
                            </div>

                            {/* Temporal Control */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest pl-1">Start Bound (s)</label>
                                    <input
                                        type="number"
                                        value={config.startTime}
                                        onChange={(e) => handleUpdateConfig(index, { startTime: parseFloat(e.target.value) || 0 })}
                                        step="0.1"
                                        className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-border rounded-xl focus:outline-none focus:border-primary/40 font-mono text-zinc-300"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest pl-1">End Bound (s)</label>
                                    <input
                                        type="number"
                                        value={config.endTime}
                                        onChange={(e) => handleUpdateConfig(index, { endTime: parseFloat(e.target.value) || config.startTime })}
                                        step="0.1"
                                        className="w-full px-3 py-2 text-xs bg-zinc-900/50 border border-border rounded-xl focus:outline-none focus:border-primary/40 font-mono text-zinc-300"
                                    />
                                </div>
                            </div>

                            {/* Effect Selector */}
                            <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                                <div className="flex gap-1.5">
                                    {(config.finding.type?.toLowerCase().includes('profanity') ||
                                        config.finding.type?.toLowerCase().includes('language') ||
                                        config.finding.type?.toLowerCase().includes('dialogue') ||
                                        config.finding.type?.toLowerCase().includes('gambling') ||
                                        config.finding.content?.toLowerCase().includes('dialogue') ||
                                        config.finding.content?.toLowerCase().includes('says ') ||
                                        config.finding.content?.toLowerCase().includes('phrase') ||
                                        config.finding.category === 'language' ||
                                        config.finding.suggestedAction?.toLowerCase().includes('mute') ||
                                        config.finding.suggestedAction?.toLowerCase().includes('audio') ||
                                        config.finding.suggestedAction?.toLowerCase().includes('beep') ||
                                        config.finding.suggestedAction?.toLowerCase().includes('dub')) ? (
                                        ['censor-beep', 'censor-dub'].map((type) => (
                                            <button
                                                key={type}
                                                onClick={() => handleUpdateConfig(index, { effectType: type as any })}
                                                className={cn(
                                                    "px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border transition-all duration-200",
                                                    config.effectType === type
                                                        ? "bg-primary text-black border-primary"
                                                        : "bg-zinc-900 border-border/50 text-zinc-500 hover:text-white hover:border-border"
                                                )}
                                            >
                                                {type.replace('censor-', '')}
                                            </button>
                                        ))
                                    ) : (
                                        ['blur', 'pixelate', 'replace-runway'].map((type) => (
                                            <button
                                                key={type}
                                                onClick={() => handleUpdateConfig(index, { effectType: type as any })}
                                                className={cn(
                                                    "px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border transition-all duration-200",
                                                    config.effectType === type
                                                        ? "bg-primary text-black border-primary"
                                                        : "bg-zinc-900 border-border/50 text-zinc-500 hover:text-white hover:border-border"
                                                )}
                                            >
                                                {type === 'replace-runway' ? 'Replace' : type.replace('replace-', '')}
                                            </button>
                                        ))
                                    )}
                                </div>

                                {config.effectType === 'replace-runway' && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg">
                                        <Sparkles className="w-3 h-3 text-primary" />
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-primary">Generative Engine Active</span>
                                    </div>
                                )}
                            </div>

                            {/* Specialized Controls based on Effect Type */}
                            <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                {/* Beep Controls */}
                                {config.effectType === 'censor-beep' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest pl-1">Words to Beep</label>
                                            <span className="text-[9px] text-zinc-500 font-medium">({config.beepWords?.length || 0} unique)</span>
                                        </div>
                                        <div className="p-4 bg-zinc-900/50 border border-border rounded-xl space-y-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {config.beepWords?.map((word, i) => (
                                                    <div key={i} className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-200 px-2 py-1 rounded-md text-[10px] font-medium group">
                                                        <span>{word}</span>
                                                        <button
                                                            onClick={() => handleUpdateConfig(index, { beepWords: config.beepWords?.filter(w => w !== word) })}
                                                            className="text-red-500/40 hover:text-red-400"
                                                        >
                                                            <X className="w-2.5 h-2.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                                {(config.beepWords?.length === 0 || !config.beepWords) && (
                                                    <span className="text-[10px] text-zinc-600 italic">No custom words added</span>
                                                )}
                                            </div>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    placeholder="Add word..."
                                                    className="flex-1 bg-zinc-900 border border-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-primary/40 transition-all font-medium"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const val = e.currentTarget.value.trim().toLowerCase();
                                                            if (val) {
                                                                const current = config.beepWords || [];
                                                                if (!current.includes(val)) {
                                                                    handleUpdateConfig(index, { beepWords: [...current, val] });
                                                                }
                                                                e.currentTarget.value = '';
                                                            }
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Dubbing Controls */}
                                {config.effectType === 'censor-dub' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest pl-1">Remediation Segment</label>
                                        </div>
                                        <div className="p-4 bg-zinc-900/50 border border-border rounded-xl space-y-3">
                                            <div className="space-y-1.5">
                                                <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Target Word</label>
                                                <input
                                                    value={config.prompt}
                                                    onChange={(e) => handleUpdateConfig(index, { prompt: e.target.value })}
                                                    className="w-full bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 text-xs font-medium text-red-200 focus:outline-none focus:border-red-500/40"
                                                    placeholder="Word/Phrase"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[9px] font-bold uppercase text-zinc-600 block pl-1">Replacement</label>
                                                <input
                                                    value={config.replacementPrompt}
                                                    onChange={(e) => handleUpdateConfig(index, { replacementPrompt: e.target.value })}
                                                    className="w-full bg-zinc-900 border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/40"
                                                    placeholder="Enter alternative text..."
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Intensity Slider for Blur/Pixelate */}
                                {(config.effectType === 'blur' || config.effectType === 'pixelate') && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[9px] uppercase font-bold text-zinc-600 tracking-widest pl-1">Effect Intensity</label>
                                            <span className="text-[10px] font-mono font-bold text-primary">{config.intensity || 50}px</span>
                                        </div>
                                        <div className="p-4 bg-zinc-900/50 border border-border rounded-xl">
                                            <input
                                                type="range"
                                                min="5"
                                                max="100"
                                                value={config.intensity || 50}
                                                onChange={(e) => handleUpdateConfig(index, { intensity: parseInt(e.target.value) })}
                                                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
                                            />
                                            <div className="flex justify-between mt-2 px-0.5">
                                                <span className="text-[8px] text-zinc-600 font-bold uppercase">Subtle</span>
                                                <span className="text-[8px] text-zinc-600 font-bold uppercase">Opaque</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Generative Synthesis UI */}
                                {config.effectType === 'replace-runway' && (
                                    <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-3 pt-2">
                                        <div className="p-4 bg-zinc-900/50 border border-border rounded-2xl space-y-2">
                                            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-primary/60 block px-1">Synthesis Prompt</span>
                                            <input
                                                type="text"
                                                value={config.replacementPrompt}
                                                onChange={(e) => handleUpdateConfig(index, { replacementPrompt: e.target.value })}
                                                placeholder="What should replace this object?"
                                                className="w-full px-3 py-2 text-xs bg-transparent border-b border-border focus:outline-none focus:border-primary/40 text-primary transition-all placeholder:text-zinc-700"
                                            />
                                        </div>

                                        <div className="p-3 bg-zinc-900/30 border border-border rounded-xl space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                                                    AI Fidelity Guard
                                                </span>
                                                {generatedImages[index] && (
                                                    <span className="text-[8px] font-medium text-emerald-400 flex items-center gap-1">
                                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                                        Validated
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => onGenerateImage(index)}
                                                    disabled={generatingImageIndex === index || !config.replacementPrompt.trim()}
                                                    className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 disabled:opacity-40 text-primary rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all"
                                                >
                                                    {generatingImageIndex === index ? (
                                                        <><Loader2 className="w-3 h-3 animate-spin" />Generating...</>
                                                    ) : generatedImages[index] ? (
                                                        <><RefreshCw className="w-3 h-3" />Regenerate</>
                                                    ) : (
                                                        <><Sparkles className="w-3 h-3" />Gen Reference</>
                                                    )}
                                                </button>

                                                {generatedImages[index] && (
                                                    <img
                                                        src={generatedImages[index].url}
                                                        alt="Reference"
                                                        className="w-12 h-12 object-cover rounded-lg border border-border shadow-sm cursor-zoom-in"
                                                        onClick={() => setZoomedImage(generatedImages[index].url)}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Warning for long segments */}
                            {(config.endTime - config.startTime) > 15 && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/10 rounded-xl">
                                    <AlertCircle className="w-3.5 h-3.5 text-red-500/40" />
                                    <span className="text-[9px] text-red-500/60 font-bold uppercase tracking-widest">Temporal Bound Overflow (15s+)</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border bg-surface-2/50 flex items-center justify-between">
                    <div className="flex items-center gap-3 pl-2">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">
                                {selectedCount} Segments Selected
                            </span>
                            <span className="text-[9px] text-zinc-600 font-medium">
                                Total queued for pipeline execution
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all border border-border/50"
                        >
                            Abort Process
                        </button>
                        <button
                            onClick={onProcess}
                            disabled={selectedCount === 0}
                            className="px-8 py-2.5 bg-primary text-black rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg shadow-primary/20 disabled:opacity-20 disabled:grayscale transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            Push Pipeline
                        </button>
                    </div>
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

export default BatchProcessModal;
