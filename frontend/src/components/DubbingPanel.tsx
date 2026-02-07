import React, { useState } from 'react';
import {
    Mic2,
    Sparkles,
    CheckCircle2,
    Loader2,
    Search,
    Volume2,
    RefreshCw,
    AlertTriangle,
    Wand2,
    ChevronRight,
    Plus,
    Trash2,
    Clock
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    analyzeAudio,
    censorAudio,
    suggestReplacements,
    type ProfanityMatch,
    getDownloadUrl,
    API_BASE
} from '../services/api';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface DubbingPanelProps {
    jobId: string;
    onActionComplete?: (actionType: string, result: any) => void;
}

type PanelStatus = 'idle' | 'scanning' | 'ready' | 'processing' | 'completed' | 'error';
type DubMode = 'auto' | 'clone' | 'beep';

const DubbingPanel: React.FC<DubbingPanelProps> = ({ jobId, onActionComplete }) => {
    const [status, setStatus] = useState<PanelStatus>('idle');
    const [mode, setMode] = useState<DubMode>('auto');
    const [matches, setMatches] = useState<ProfanityMatch[]>([]);
    const [error, setError] = useState<string>('');
    const [progress, setProgress] = useState<string>('');
    const [loadingSuggestions, setLoadingSuggestions] = useState<string | null>(null);

    // Add a manual segment
    const handleAddSegment = () => {
        const newSegment: ProfanityMatch = {
            word: '',
            start_time: 0,
            end_time: 1,
            replacement: '',
            confidence: 'High',
            speaker_id: 'speaker_1',
            context: 'manual entry'
        };
        setMatches([...matches, newSegment]);
    };

    // Remove a segment
    const handleRemoveSegment = (index: number) => {
        const updated = matches.filter((_, i) => i !== index);
        setMatches(updated);
    };

    // Scan audio for speech segments
    const handleScan = async () => {
        if (!jobId) return;
        setStatus('scanning');
        setError('');

        try {
            const result = await analyzeAudio(jobId);
            setMatches(result.matches.map(m => ({
                ...m,
                replacement: m.replacement || '' // Default to empty for user to fill
            })));
            setStatus('ready');
        } catch (err) {
            console.error('Scan failed:', err);
            setError('Failed to analyze audio stream.');
            setStatus('error');
        }
    };

    // Get suggestions for a specific word
    const handleGetSuggestions = async (index: number) => {
        const match = matches[index];
        setLoadingSuggestions(match.word);

        try {
            const result = await suggestReplacements(jobId, [match.word]);
            if (result.suggestions && result.suggestions.length > 0) {
                const updated = [...matches];
                updated[index] = {
                    ...updated[index],
                    replacement: result.suggestions[0].suggestions[0] || ''
                };
                setMatches(updated);
            }
        } catch (err) {
            console.error('Suggestions failed:', err);
        } finally {
            setLoadingSuggestions(null);
        }
    };

    // Execute the dubbing
    const handleExecute = async () => {
        if (!jobId) return;
        setStatus('processing');
        setProgress('Initializing neural synthesis...');
        setError('');

        try {
            // Build custom replacements map
            const replacements = matches.reduce((acc, m) => {
                if (m.replacement) acc[m.word] = m.replacement;
                return acc;
            }, {} as Record<string, string>);

            // Execute based on mode
            // For 'auto' mode, we don't need voice samples
            const result = await censorAudio(
                jobId,
                mode,
                undefined, // sampleStart
                undefined, // sampleEnd
                undefined, // customWords
                replacements,
                matches
            );

            setStatus('completed');
            setProgress('Dubbing complete!');

            if (onActionComplete) {
                onActionComplete('dubbing', {
                    mode,
                    downloadUrl: `${API_BASE.replace('/api', '')}${result.download_path}` || getDownloadUrl(jobId)
                });
            }
        } catch (err) {
            console.error('Dubbing failed:', err);
            setError(err instanceof Error ? err.message : 'Dubbing process failed.');
            setStatus('error');
        }
    };

    const toggleMode = (newMode: DubMode) => {
        setMode(newMode);
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header & Mode Selector */}
            <div className="p-4 space-y-4 border-b border-white/5 bg-white/[0.01]">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                        <Mic2 className="w-3.5 h-3.5 text-accent" />
                        AI Dubbing Engine
                    </h3>
                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                        {(['auto', 'clone', 'beep'] as DubMode[]).map((m) => (
                            <button
                                key={m}
                                onClick={() => toggleMode(m)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-tight transition-all",
                                    mode === m
                                        ? "bg-accent text-white shadow-lg shadow-accent/20"
                                        : "text-muted-foreground hover:text-white"
                                )}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-3 bg-accent/5 border border-accent/10 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-accent/80">
                            {mode === 'auto' ? 'Magic Auto-Dub' : mode === 'clone' ? 'Voice Cloning' : 'Fast Censor'}
                        </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                        {mode === 'auto' ? 'Detects all speakers automatically and clones their voices for seamless word replacement.' :
                            mode === 'clone' ? 'Requires a 10s voice sample from the video to create a precise speaker clone.' :
                                'Fast frequency-based masking using traditional broadcast-style beeps.'}
                    </p>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {status === 'idle' && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-6">
                        <div className="relative">
                            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center animate-pulse">
                                <Search className="w-8 h-8 text-accent/40" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-background rounded-full border border-white/10 flex items-center justify-center">
                                <Volume2 className="w-3 h-3 text-accent" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-foreground">Scan Audio for Dialogue</p>
                            <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                                Our AI will analyze the entire audio track to identify words and phrases for remediation.
                            </p>
                        </div>
                        <button
                            onClick={handleScan}
                            className="btn-primary w-full max-w-[200px] flex items-center justify-center gap-2 h-10 shadow-accent/20"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Start Analysis
                        </button>
                    </div>
                )}

                {status === 'scanning' && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-6">
                        <div className="relative">
                            <div className="w-20 h-20 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Mic2 className="w-8 h-8 text-accent/40 animate-pulse" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Decoding Audio Stream</p>
                            <p className="text-xs text-muted-foreground animate-pulse">Running Gemini Multimodal Analysis...</p>
                        </div>
                    </div>
                )}

                {(status === 'ready' || status === 'processing' || status === 'completed') && (
                    <div className="space-y-4 pb-20">
                        <div className="flex items-center justify-between sticky top-0 py-2 bg-[var(--background)]/80 backdrop-blur-sm z-10">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Dialogue Segments</span>
                                <span className="text-[10px] text-accent font-semibold">{matches.length} Instances</span>
                            </div>
                            <button
                                onClick={handleAddSegment}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all text-[9px] font-bold uppercase"
                            >
                                <Plus className="w-3 h-3" />
                                Add Segment
                            </button>
                        </div>

                        {matches.length === 0 ? (
                            <div className="p-8 text-center bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500/20 mx-auto mb-3" />
                                <p className="text-xs text-muted-foreground">No compliance risks detected in speech.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {matches.map((match, idx) => (
                                    <div key={idx} className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl space-y-3 group hover:border-white/10 transition-all">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="px-2 py-0.5 bg-red-500/10 text-red-500 rounded text-[9px] font-bold uppercase">Violation</div>
                                                <span className="text-[10px] text-muted-foreground font-mono">{(match.start_time).toFixed(2)}s</span>
                                            </div>
                                            <button
                                                onClick={() => handleGetSuggestions(idx)}
                                                disabled={loadingSuggestions === match.word || status === 'processing'}
                                                className="p-1.5 rounded-lg hover:bg-accent/10 text-accent transition-colors disabled:opacity-30"
                                                title="AI Magic Suggestion"
                                            >
                                                {loadingSuggestions === match.word ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Wand2 className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <label className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Original Word</label>
                                                    <input
                                                        type="text"
                                                        value={match.word}
                                                        onChange={(e) => {
                                                            const updated = [...matches];
                                                            updated[idx].word = e.target.value;
                                                            setMatches(updated);
                                                        }}
                                                        placeholder="AI transcription..."
                                                        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-foreground/90 font-medium focus:outline-none focus:border-white/30"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[8px] font-bold text-accent uppercase tracking-wider ml-1">Replacement</label>
                                                    <div className="relative group/input">
                                                        <input
                                                            type="text"
                                                            value={match.replacement}
                                                            onChange={(e) => {
                                                                const updated = [...matches];
                                                                updated[idx].replacement = e.target.value;
                                                                setMatches(updated);
                                                            }}
                                                            placeholder="New word..."
                                                            disabled={status === 'processing'}
                                                            className="w-full px-3 py-2 bg-accent/[0.03] border border-accent/20 rounded-xl text-xs text-accent font-bold focus:outline-none focus:border-accent group-hover/input:border-accent/40 transition-all placeholder:text-accent/20"
                                                        />
                                                        <Sparkles className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-accent/30 pointer-events-none" />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 bg-black/20 p-2 rounded-xl border border-white/5">
                                                <div className="flex-1 flex items-center gap-3">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[7px] font-bold text-muted-foreground uppercase tracking-wider">Start Time</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <Clock className="w-3 h-3 text-muted-foreground/40" />
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                value={match.start_time}
                                                                onChange={(e) => {
                                                                    const updated = [...matches];
                                                                    updated[idx].start_time = parseFloat(e.target.value);
                                                                    setMatches(updated);
                                                                }}
                                                                className="w-16 bg-transparent text-[10px] font-mono font-bold text-foreground focus:outline-none"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[7px] font-bold text-muted-foreground uppercase tracking-wider">End Time</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <Clock className="w-3 h-3 text-muted-foreground/40" />
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                value={match.end_time}
                                                                onChange={(e) => {
                                                                    const updated = [...matches];
                                                                    updated[idx].end_time = parseFloat(e.target.value);
                                                                    setMatches(updated);
                                                                }}
                                                                className="w-16 bg-transparent text-[10px] font-mono font-bold text-foreground focus:outline-none"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveSegment(idx)}
                                                    className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-3">
                        <div className="flex items-center gap-2 text-red-500">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Engine Fault</span>
                        </div>
                        <p className="text-[11px] text-red-400/80 leading-relaxed">{error}</p>
                        <button
                            onClick={handleScan}
                            className="text-[10px] font-bold text-red-500 hover:text-red-400 uppercase tracking-widest flex items-center gap-1"
                        >
                            Retry Analysis <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* Action Footer */}
            {(status === 'ready' || status === 'processing' || status === 'completed') && (
                <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md">
                    {status === 'processing' ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-accent animate-pulse">
                                <span>{progress}</span>
                                <span>Neural Path Active</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-accent animate-progress-indefinite" />
                            </div>
                        </div>
                    ) : status === 'completed' ? (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-500">
                                <CheckCircle2 className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-widest">Dubbing Complete</span>
                            </div>
                            <button
                                onClick={() => setStatus('ready')}
                                className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
                            >
                                <RefreshCw className="w-4 h-4 text-muted-foreground" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleExecute}
                            disabled={matches.length === 0}
                            className="btn-primary w-full h-11 flex items-center justify-center gap-2 shadow-2xl disabled:opacity-20"
                        >
                            <Sparkles className="w-4 h-4" />
                            Apply {mode === 'auto' ? 'Magic Dub' : 'Censorship'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default DubbingPanel;
