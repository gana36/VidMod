import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ShieldAlert, History, Beer, ShieldX, Sword, MessageCircle, AlertTriangle, Download, Eye, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';
import { type EditVersion } from './AppLayout';
import EditPlanPanel from './EditPlanPanel';

interface RightPanelProps {
    onSeekTo?: (time: string) => void;
    findings?: Finding[];
    currentTime?: number;
    isAnalyzing?: boolean;
    jobId?: string;
    onActionComplete?: (actionType: string, result: any) => void;
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
    const [activePanel, setActivePanel] = useState<'risks' | 'plan' | 'history' | 'dubbing'>('risks');

    if (isAnalyzing) {
        return (
            <aside className="w-full h-full flex flex-col panel overflow-hidden">
                <div className="p-5 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground">Analyzing</h2>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 text-center">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 bg-primary/10 rounded-full animate-pulse blur-xl" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-zinc-300">Scanning Media</p>
                        <p className="text-xs text-muted-foreground max-w-[200px] leading-relaxed">
                            Our compliance engine is verifying content against active regulatory standards.
                        </p>
                    </div>
                </div>
            </aside>
        );
    }

    const totalViolations = findings.length;
    const hasCritical = findings.some(f => f.status === 'critical');
    const hasWarnings = findings.some(f => f.status === 'warning');

    const predictedAgeRating = hasCritical ? '18+' : hasWarnings ? '12+' : 'U';
    const riskLevel = hasCritical ? 'Critical' : hasWarnings ? 'Moderate' : 'Secure';
    const riskColor = hasCritical ? 'text-red-400' : hasWarnings ? 'text-amber-400' : 'text-emerald-400';

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'alcohol': return <Beer className="w-4 h-4" />;
            case 'logo': return <ShieldX className="w-4 h-4" />;
            case 'violence': return <Sword className="w-4 h-4" />;
            case 'language': return <MessageCircle className="w-4 h-4" />;
            default: return <AlertTriangle className="w-4 h-4" />;
        }
    };

    const formatTimeRange = (start: number, end: number) => {
        const format = (t: number) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };
        return `${format(start)} - ${format(end)}`;
    };

    const tabs: { id: 'risks' | 'plan' | 'history', label: string, icon: any, count?: number }[] = [
        { id: 'risks', label: 'Analysis', icon: ShieldAlert },
        { id: 'plan', label: 'Remediation', icon: CheckCircle2 },
        { id: 'history', label: 'History', icon: History, count: editHistory.length },
    ];

    return (
        <div className="h-full flex flex-col panel overflow-hidden">
            {/* Tab Switcher */}
            <div className="px-2 pt-2 border-b border-border bg-secondary/10">
                <div className="flex gap-1">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activePanel === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActivePanel(tab.id)}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-medium transition-all rounded-t-md relative cursor-pointer",
                                    isActive ? "text-zinc-100 surface-2" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/3"
                                )}
                            >
                                <Icon className={cn("w-4 h-4", isActive ? "text-zinc-300" : "text-zinc-600")} />
                                <span>{tab.label}</span>
                                {tab.count !== undefined && tab.count > 0 && (
                                    <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded-full text-[8px] tabular-nums font-bold">
                                        {tab.count}
                                    </span>
                                )}
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <AnimatePresence mode="wait">
                {activePanel === 'risks' && (
                    <motion.div
                        key="risks"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex-1 flex flex-col overflow-hidden"
                    >
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground/80">System Overview</h3>
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-secondary/30">
                                    <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                    <span className="text-muted-foreground/80 text-[8px] font-semibold uppercase tracking-wider">Ready</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Violations', value: totalViolations, sub: 'Detected' },
                                    {
                                        label: 'Remediated',
                                        value: editHistory.length,
                                        sub: `${Math.round((editHistory.length / (totalViolations || 1)) * 100)}% Rate`,
                                        color: "text-emerald-400"
                                    },
                                    { label: 'Rating', value: predictedAgeRating, sub: 'Predicted' },
                                    { label: 'Status', value: riskLevel, sub: 'Risk Level', color: riskColor },
                                ].map((stat, i) => (
                                    <div key={i} className="p-2.5 flex flex-col items-center justify-center text-center border border-border bg-secondary/10 rounded">
                                        <span className="text-[8px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-0.5">{stat.label}</span>
                                        <span className={cn("text-sm font-bold tracking-tight", stat.color || "text-foreground")}>{stat.value}</span>
                                        <span className="text-[7px] text-muted-foreground/40 font-medium uppercase mt-0.5 tracking-wider">{stat.sub}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Findings List */}
                        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
                            <div className="flex items-center justify-between sticky top-0 py-2 bg-[var(--background)]/80 backdrop-blur-sm z-20">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Incident Log</span>
                                <span className="text-[10px] text-muted-foreground/60">{findings.length} points of interest</span>
                            </div>

                            {findings.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 rounded-2xl bg-white/[0.02] border border-dashed border-border/50">
                                    <div className="w-12 h-12 rounded-full bg-emerald-400/10 flex items-center justify-center">
                                        <CheckCircle2 className="w-6 h-6 text-emerald-400/40" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold uppercase tracking-widest text-foreground">Safety Check Passed</p>
                                        <p className="text-[10px] text-muted-foreground">No content violations were identified.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {findings.map((finding) => {
                                        const isActive = currentTime >= finding.startTime && currentTime <= finding.endTime;
                                        return (
                                            <motion.div
                                                layout
                                                key={finding.id}
                                                onClick={() => onSeekTo?.(`${Math.floor(finding.startTime / 60)}:${Math.floor(finding.startTime % 60).toString().padStart(2, '0')}`)}
                                                className={cn(
                                                    "p-3 cursor-pointer group relative border transition-all duration-200 rounded",
                                                    isActive
                                                        ? "border-primary/30 bg-primary/[0.02]"
                                                        : "border-border/50 hover:border-border bg-transparent"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex gap-3">
                                                        <div className={cn(
                                                            "w-8 h-8 rounded border flex items-center justify-center shrink-0 transition-colors",
                                                            finding.status === 'critical'
                                                                ? "bg-red-500/5 text-red-500/70 border-red-500/10"
                                                                : "bg-amber-500/5 text-amber-500/70 border-amber-500/10"
                                                        )}>
                                                            {getCategoryIcon(finding.category)}
                                                        </div>
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="flex items-center gap-1.5 leading-none">
                                                                <span className="text-[9px] font-semibold uppercase tracking-widest opacity-60">{finding.type}</span>
                                                                <div className={cn(
                                                                    "w-1 h-1 rounded-full",
                                                                    finding.status === 'critical' ? "bg-red-500" : "bg-amber-500"
                                                                )} />
                                                            </div>
                                                            <h4 className="text-xs font-semibold tracking-tight text-foreground/90">{finding.content}</h4>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <span className="text-[10px] font-mono text-muted-foreground/60 px-1 border-r border-border leading-none">
                                                                    {formatTimeRange(finding.startTime, finding.endTime)}
                                                                </span>
                                                                <span className={cn(
                                                                    "text-[9px] font-semibold flex items-center gap-1",
                                                                    finding.confidence === 'High' ? "text-emerald-500/80" :
                                                                        finding.confidence === 'Medium' ? "text-amber-500/80" :
                                                                            "text-red-500/80"
                                                                )}>
                                                                    <div className={cn("w-1 h-1 rounded-full",
                                                                        finding.confidence === 'High' ? "bg-emerald-500/80" :
                                                                            finding.confidence === 'Medium' ? "bg-amber-500/80" :
                                                                                "bg-red-500/80"
                                                                    )} />
                                                                    {finding.confidence} Match
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity translate-x-1 group-hover:translate-x-0">
                                                        <ChevronRight className="w-3.5 h-3.5 text-primary/50" />
                                                    </div>
                                                </div>

                                                {
                                                    finding.context && (
                                                        <motion.div
                                                            initial={false}
                                                            animate={{ height: isActive ? 'auto' : 0, opacity: isActive ? 1 : 0 }}
                                                            className="overflow-hidden"
                                                        >
                                                            <div className="mt-4 pt-4 border-t border-white/[0.05]">
                                                                <p className="text-[11px] leading-relaxed text-muted-foreground italic bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.05]">
                                                                    "{finding.context}"
                                                                </p>
                                                            </div>
                                                        </motion.div>
                                                    )
                                                }

                                                {
                                                    isActive && (
                                                        <motion.div
                                                            layoutId={`active-glow-${finding.id}`}
                                                            className="absolute inset-0 bg-primary/5 pointer-events-none"
                                                        />
                                                    )
                                                }
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer Action */}
                        <div className="p-3 border-t border-border bg-secondary/10 mt-auto">
                            <button className="w-full flex items-center justify-center gap-2 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded transition-all group cursor-pointer">
                                <Download className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 group-hover:text-foreground">Analysis Manifest</span>
                            </button>
                        </div>
                    </motion.div>
                )}
                {activePanel === 'plan' && (
                    <motion.div
                        key="plan"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex-1 overflow-hidden"
                    >
                        <EditPlanPanel findings={findings} jobId={jobId} onActionComplete={onActionComplete} />
                    </motion.div>
                )}
                {activePanel === 'history' && (
                    <motion.div
                        key="history"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col overflow-hidden"
                    >
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground/80 font-mono">Archive / History</h3>
                                <div className="px-2 py-0.5 rounded border border-border bg-secondary/30">
                                    <span className="text-muted-foreground/80 text-[8px] font-semibold uppercase tracking-wider">{editHistory.length} Snapshots</span>
                                </div>
                            </div>

                            <p className="text-[10px] text-muted-foreground/60 leading-relaxed font-mono">
                                Versioned iterations of the current remediation workflow. Enabled versions will be consolidated in the final render.
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
                            {editHistory.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
                                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                                        <History className="w-8 h-8" />
                                    </div>
                                    <p className="text-xs font-bold uppercase tracking-[0.2em]">No Iterations Found</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {editHistory.map((version) => (
                                        <div
                                            key={version.id}
                                            className={cn(
                                                "p-3 border transition-all duration-200 relative group rounded",
                                                selectedVersion === version.version
                                                    ? "border-primary/50 bg-primary/[0.02]"
                                                    : "bg-transparent border-border/80"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        <input
                                                            type="checkbox"
                                                            checked={version.enabled}
                                                            onChange={() => onToggleVersion?.(version.id)}
                                                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="font-mono">
                                                        <div className="flex items-center gap-2 leading-none">
                                                            <span className="text-[10px] font-semibold text-primary/80 uppercase tracking-widest leading-none">v{version.version}</span>
                                                            <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                                            <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider leading-none">{version.effectType}</span>
                                                        </div>
                                                        <p className="text-xs font-semibold text-foreground/90 mt-1 truncate">"{version.objectName}"</p>
                                                        <p className="text-[9px] font-semibold text-muted-foreground/40 mt-1 uppercase tracking-widest whitespace-nowrap">
                                                            {new Date(version.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5 font-mono">
                                                    <button
                                                        onClick={() => onPreviewVersion?.(version.version)}
                                                        className="p-1.5 rounded border border-border bg-secondary/10 hover:bg-secondary/20 text-muted-foreground/60 transition-all hover:text-primary"
                                                        title="Preview Snapshot"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    <a
                                                        href={version.downloadUrl.split('?')[0]}
                                                        download={`vidmod_v${version.version}.mp4`}
                                                        className="p-1.5 rounded border border-border bg-secondary/10 hover:bg-secondary/20 text-muted-foreground/60 transition-all hover:text-emerald-500"
                                                        title="Export Component"
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                    </a>
                                                </div>
                                            </div>

                                            {version.enabled && (
                                                <div className="absolute top-1 right-1 opacity-40 transition-opacity">
                                                    <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
};

export default RightPanel;
