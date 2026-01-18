import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ShieldAlert, History, Beer, ShieldX, Sword, MessageCircle, AlertTriangle, Download, Eye, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';
import EditPlanPanel from './EditPlanPanel';
import { type EditVersion } from './AppLayout';

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
    const [activePanel, setActivePanel] = useState<'risks' | 'plan' | 'history'>('risks');

    if (isAnalyzing) {
        return (
            <aside className="w-full h-full flex flex-col glass-panel overflow-hidden">
                <div className="p-6 border-b border-border bg-white/5">
                    <h2 className="text-lg font-bold tracking-tight">Analysis Phase</h2>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 text-center">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 bg-primary/10 rounded-full animate-pulse blur-xl" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="font-bold text-sm uppercase tracking-[0.2em] text-primary">Scanning Media</p>
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
        <div className="h-full flex flex-col glass-panel overflow-hidden shadow-2xl">
            {/* Tab Switcher */}
            <div className="px-2 pt-2 border-b border-border bg-white/[0.02]">
                <div className="flex gap-1">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activePanel === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActivePanel(tab.id)}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all rounded-t-lg relative group",
                                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                                )}
                            >
                                <Icon className={cn("w-3.5 h-3.5 transition-transform", isActive ? "scale-110" : "group-hover:scale-110")} />
                                <span>{tab.label}</span>
                                {tab.count !== undefined && tab.count > 0 && (
                                    <span className="px-1.5 py-0.5 bg-primary/20 text-primary rounded-full text-[8px] tabular-nums font-black">
                                        {tab.count}
                                    </span>
                                )}
                                {isActive && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_12px_rgba(59,130,246,0.8)]"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <AnimatePresence mode="wait">
                {activePanel === 'risks' ? (
                    <motion.div
                        key="risks"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex-1 flex flex-col overflow-hidden"
                    >
                        {/* Summary Section */}
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-xs uppercase tracking-[0.15em] text-muted-foreground">System Overview</h3>
                                <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/20">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-emerald-400 text-[9px] font-black uppercase tracking-widest leading-none">Compliant Output Ready</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: 'Violations', value: totalViolations, sub: 'Detected' },
                                    { label: 'Rating', value: predictedAgeRating, sub: 'Predicted' },
                                    { label: 'Status', value: riskLevel, sub: 'Risk Level', color: riskColor },
                                ].map((stat, i) => (
                                    <div key={i} className="glass-card p-3 flex flex-col items-center justify-center text-center">
                                        <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mb-1">{stat.label}</span>
                                        <span className={cn("text-lg font-black tracking-tight", stat.color)}>{stat.value}</span>
                                        <span className="text-[8px] text-muted-foreground/60 font-medium uppercase mt-0.5">{stat.sub}</span>
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
                                        <p className="text-xs font-bold uppercase tracking-widest">Safety Check Passed</p>
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
                                                    "glass-card p-4 cursor-pointer group relative overflow-hidden",
                                                    isActive && "border-primary/50 bg-primary/[0.03] ring-1 ring-primary/20",
                                                    !isActive && "opacity-80 hover:opacity-100"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex gap-4">
                                                        <div className={cn(
                                                            "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 shadow-lg",
                                                            finding.status === 'critical'
                                                                ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                                                : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                                        )}>
                                                            {getCategoryIcon(finding.category)}
                                                        </div>
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] font-black uppercase tracking-widest opacity-60">{finding.type}</span>
                                                                <div className={cn(
                                                                    "w-1 h-1 rounded-full",
                                                                    finding.status === 'critical' ? "bg-red-500" : "bg-amber-500"
                                                                )} />
                                                            </div>
                                                            <h4 className="text-sm font-bold tracking-tight text-foreground/90">{finding.content}</h4>
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <span className="text-[10px] font-mono text-muted-foreground/80 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                                                                    {formatTimeRange(finding.startTime, finding.endTime)}
                                                                </span>
                                                                <span className={cn(
                                                                    "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border",
                                                                    finding.confidence === 'High' ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" :
                                                                        finding.confidence === 'Medium' ? "bg-amber-400/10 text-amber-400 border-amber-400/20" :
                                                                            "bg-red-400/10 text-red-400 border-red-400/20"
                                                                )}>
                                                                    {finding.confidence} Match
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity translate-x-1 group-hover:translate-x-0">
                                                        <ChevronRight className="w-4 h-4 text-primary" />
                                                    </div>
                                                </div>

                                                {finding.context && (
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
                                                )}

                                                {isActive && (
                                                    <motion.div
                                                        layoutId={`active-glow-${finding.id}`}
                                                        className="absolute inset-0 bg-primary/5 pointer-events-none"
                                                    />
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer Action */}
                        <div className="p-4 border-t border-border bg-white/[0.02] mt-auto">
                            <button className="w-full flex items-center justify-center gap-2 btn-primary group">
                                <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                                <span className="text-xs font-bold uppercase tracking-widest">Download Analysis PDF</span>
                            </button>
                        </div>
                    </motion.div>
                ) : activePanel === 'plan' ? (
                    <motion.div
                        key="plan"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex-1 overflow-hidden"
                    >
                        <EditPlanPanel findings={findings} jobId={jobId} onActionComplete={onActionComplete} />
                    </motion.div>
                ) : (
                    <motion.div
                        key="history"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="flex-1 flex flex-col overflow-hidden"
                    >
                        <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-xs uppercase tracking-[0.15em] text-muted-foreground">Version Management</h3>
                                <div className="px-2 py-1 rounded-full bg-primary/10 border border-primary/20">
                                    <span className="text-primary text-[9px] font-black uppercase tracking-widest">{editHistory.length} Snapshots</span>
                                </div>
                            </div>

                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                Review and export previous iterations of your compliance workflow. Toggle versions to include in the final render.
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
                            {editHistory.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 rounded-2xl bg-white/[0.02] border border-dashed border-border/50 opacity-40">
                                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                                        <History className="w-6 h-6" />
                                    </div>
                                    <p className="text-xs font-bold uppercase tracking-widest leading-none">No Iterations Found</p>
                                    <p className="text-[10px] max-w-[160px]">Apply remediation actions to generate version snapshots.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {editHistory.map((version) => (
                                        <div
                                            key={version.id}
                                            className={cn(
                                                "glass-card p-4 transition-all duration-300 relative group",
                                                selectedVersion === version.version
                                                    ? "border-primary/50 bg-primary/[0.03] ring-1 ring-primary/20 shadow-primary/10"
                                                    : "bg-white/[0.02] border-border/50"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="relative">
                                                        <input
                                                            type="checkbox"
                                                            checked={version.enabled}
                                                            onChange={() => onToggleVersion?.(version.id)}
                                                            className="w-4 h-4 rounded border-border bg-transparent text-primary focus:ring-primary/50 cursor-pointer"
                                                        />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11px] font-black text-primary uppercase">v{version.version}</span>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{version.effectType}</span>
                                                        </div>
                                                        <p className="text-sm font-bold text-foreground/90 mt-0.5">"{version.objectName}"</p>
                                                        <p className="text-[9px] font-medium text-muted-foreground mt-1 tabular-nums opacity-60">
                                                            {new Date(version.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Secure Snapshot
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => onPreviewVersion?.(version.version)}
                                                        className="p-2.5 rounded-xl glass-panel hover:bg-white/10 text-primary transition-all active:scale-90"
                                                        title="Stream this version"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                    <a
                                                        href={version.downloadUrl.split('?')[0]}
                                                        download={`vidmod_v${version.version}.mp4`}
                                                        className="p-2.5 rounded-xl glass-panel hover:bg-emerald-400/10 text-emerald-400 transition-all active:scale-90"
                                                        title="Export Secure Media"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </a>
                                                </div>
                                            </div>

                                            {version.enabled && (
                                                <div className="absolute top-0 right-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <div className="w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
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
        </div>
    );
};

export default RightPanel;
