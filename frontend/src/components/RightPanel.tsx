import React from 'react';
import { CheckCircle2, ShieldAlert, History, Beer, ShieldX, Sword, MessageCircle, AlertTriangle, Download, Eye } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';
import EditPlanPanel from './EditPlanPanel';
import { useState } from 'react';
import { type EditVersion } from './AppLayout';

interface RightPanelProps {
    onSeekTo?: (time: string) => void;
    findings?: Finding[];
    currentTime?: number;
    isAnalyzing?: boolean;
    jobId?: string;  // Job ID for API calls
    onActionComplete?: (actionType: string, result: any) => void;
    // Edit history props
    editHistory?: EditVersion[];
    onPreviewVersion?: (version: number) => void;
    onToggleVersion?: (id: string) => void;
    selectedVersion?: number | null;
}

const RightPanel: React.FC<RightPanelProps> = ({
    onSeekTo,
    findings = [],
    currentTime = 0,
    isAnalyzing = false,
    jobId,
    onActionComplete,
    editHistory = [],
    onPreviewVersion,
    onToggleVersion,
    selectedVersion
}) => {
    if (isAnalyzing) {
        return (
            <aside className="w-full h-full flex flex-col bg-card border border-border rounded-xl overflow-hidden animate-in fade-in zoom-in-95">
                <div className="p-6 border-b border-border bg-muted/20">
                    <h2 className="text-lg font-bold">Analysis Results</h2>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                    <div className="space-y-1">
                        <p className="font-bold text-sm uppercase tracking-widest text-accent">Analyzing Content</p>
                        <p className="text-xs text-muted-foreground">Gemini is performing native video analysis...</p>
                    </div>
                </div>
            </aside>
        );
    }
    // Derived metrics
    const totalViolations = findings.length;
    const hasCritical = findings.some(f => f.status === 'critical');
    const hasWarnings = findings.some(f => f.status === 'warning');

    // Simple logic for age rating
    const predictedAgeRating = hasCritical ? '18+' : hasWarnings ? '12+' : 'U';
    const riskLevel = hasCritical ? 'Critical' : hasWarnings ? 'Moderate' : 'Low';
    const riskColor = hasCritical ? 'text-red-500' : hasWarnings ? 'text-amber-500' : 'text-emerald-500';

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'alcohol': return <Beer className="w-4 h-4" />;
            case 'logo': return <ShieldX className="w-4 h-4" />;
            case 'violence': return <Sword className="w-4 h-4" />;
            case 'language': return <MessageCircle className="w-4 h-4" />;
            default: return <AlertTriangle className="w-4 h-4" />;
        }
    };

    const [activePanel, setActivePanel] = useState<'risks' | 'plan' | 'history'>('risks');

    const formatTimeRange = (start: number, end: number) => {
        const format = (t: number) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };
        return `${format(start)} - ${format(end)}`;
    };

    return (
        <div className="h-full flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-2xl">
            {/* Tab Switcher */}
            <div className="flex border-b border-border bg-muted/30">
                <button
                    onClick={() => setActivePanel('risks')}
                    className={cn(
                        "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative",
                        activePanel === 'risks' ? "text-accent" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                >
                    Risks
                    {activePanel === 'risks' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    )}
                </button>
                <button
                    onClick={() => setActivePanel('plan')}
                    className={cn(
                        "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative",
                        activePanel === 'plan' ? "text-accent" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                >
                    Edit Plan
                    {activePanel === 'plan' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    )}
                </button>
                <button
                    onClick={() => setActivePanel('history')}
                    className={cn(
                        "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative",
                        activePanel === 'history' ? "text-accent" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                >
                    History {editHistory.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-accent/20 text-accent rounded-full text-[8px]">{editHistory.length}</span>}
                    {activePanel === 'history' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    )}
                </button>
            </div>

            {activePanel === 'risks' ? (
                <>
                    {/* Header Section */}
                    <div className="p-4 border-b border-border bg-muted/20 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                                <ShieldAlert className="w-4 h-4 text-accent" />
                                Detected Compliance Risks
                            </h3>
                            <div className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider">
                                Live Analysis
                            </div>
                        </div>

                        {/* Summary Metrics */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-background/50 border border-border rounded-lg p-2 flex flex-col items-center">
                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Total</span>
                                <span className="text-lg font-black">{totalViolations}</span>
                            </div>
                            <div className="bg-background/50 border border-border rounded-lg p-2 flex flex-col items-center">
                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Rating</span>
                                <span className="text-lg font-black">{predictedAgeRating}</span>
                            </div>
                            <div className="bg-background/50 border border-border rounded-lg p-2 flex flex-col items-center">
                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter">Risk</span>
                                <span className={`text-sm font-black mt-1 ${riskColor}`}>{riskLevel}</span>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable List */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {findings.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-50">
                                <CheckCircle2 className="w-12 h-12 text-emerald-500/20" />
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">No risks detected</p>
                            </div>
                        ) : (
                            findings.map((finding) => {
                                const isActive = currentTime >= finding.startTime && currentTime <= finding.endTime;

                                return (
                                    <div
                                        key={finding.id}
                                        onClick={() => onSeekTo?.(`${Math.floor(finding.startTime / 60)}:${Math.floor(finding.startTime % 60).toString().padStart(2, '0')}`)}
                                        className={cn(
                                            "group relative flex flex-col p-3 rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden",
                                            isActive
                                                ? "bg-accent/5 border-accent shadow-[0_0_20px_rgba(59,130,246,0.1)]"
                                                : "bg-background/40 border-border/50 hover:bg-muted/10 hover:border-border"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-3 relative z-10">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110",
                                                    finding.status === 'critical' ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"
                                                )}>
                                                    {getCategoryIcon(finding.category)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{finding.type}</span>
                                                    <h4 className="text-sm font-semibold truncate max-w-[150px]">{finding.content}</h4>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-end gap-1">
                                                <div className={cn(
                                                    "px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest",
                                                    finding.confidence === 'High' ? "bg-emerald-500/10 text-emerald-500" :
                                                        finding.confidence === 'Medium' ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"
                                                )}>
                                                    {finding.confidence}
                                                </div>
                                                <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                                                    {formatTimeRange(finding.startTime, finding.endTime)}
                                                </span>
                                            </div>
                                        </div>

                                        {finding.context && (
                                            <div className={cn(
                                                "mt-3 text-[10px] leading-relaxed text-muted-foreground border-t border-border/30 pt-2 transition-all duration-300",
                                                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 h-0 group-hover:h-auto overflow-hidden mt-0 group-hover:mt-3"
                                            )}>
                                                <p className="line-clamp-3 italic opacity-80">"{finding.context}"</p>
                                            </div>
                                        )}

                                        {isActive && (
                                            <div className="absolute bottom-0 left-0 h-0.5 bg-accent transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                                                style={{ width: '100%' }} />
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer Action */}
                    <div className="p-4 border-t border-border bg-muted/5">
                        <button className="w-full h-10 flex items-center justify-center gap-2 bg-foreground text-background rounded-xl text-xs font-bold uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all shadow-lg">
                            <History className="w-4 h-4" />
                            Export Remediation Log
                        </button>
                    </div>
                </>
            ) : activePanel === 'plan' ? (
                <EditPlanPanel findings={findings} jobId={jobId} onActionComplete={onActionComplete} />
            ) : (
                /* History Panel */
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/20">
                        <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                            <History className="w-4 h-4 text-accent" />
                            Edit History
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">Each version can be previewed and downloaded individually</p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {editHistory.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                                    <History className="w-8 h-8" />
                                </div>
                                <p className="text-xs font-bold uppercase tracking-[0.2em]">No Edits Yet</p>
                                <p className="text-[10px] text-muted-foreground">Apply effects from the Edit Plan to see version history</p>
                            </div>
                        ) : (
                            editHistory.map((version) => (
                                <div
                                    key={version.id}
                                    className={cn(
                                        "rounded-lg border p-3 transition-all",
                                        selectedVersion === version.version
                                            ? "border-accent bg-accent/10"
                                            : "border-border bg-background/40 hover:bg-muted/10"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={version.enabled}
                                                onChange={() => onToggleVersion?.(version.id)}
                                                className="w-4 h-4 rounded border-border"
                                            />
                                            <div>
                                                <p className="text-sm font-medium">
                                                    v{version.version}: {version.effectType} "{version.objectName}"
                                                </p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {new Date(version.timestamp).toLocaleTimeString()}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => onPreviewVersion?.(version.version)}
                                                className="p-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent transition-colors"
                                                title="Preview this version"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <a
                                                href={version.downloadUrl.split('?')[0]}
                                                download={`video_v${version.version}.mp4`}
                                                className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-colors"
                                                title="Download this version"
                                            >
                                                <Download className="w-4 h-4" />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RightPanel;
