import React from 'react';
import { CheckCircle2, ShieldAlert, History, Beer, ShieldX, Sword, MessageCircle, AlertTriangle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';

interface RightPanelProps {
    onSeekTo?: (time: string) => void;
    findings?: Finding[];
    currentTime?: number;
}

const RightPanel: React.FC<RightPanelProps> = ({ onSeekTo, findings = [], currentTime = 0 }) => {
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
        </div>
    );
};

export default RightPanel;
