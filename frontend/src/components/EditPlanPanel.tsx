import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, Scissors, VolumeX, EyeOff, ShieldCheck, Info } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';

export interface EditStep {
    id: string;
    violation: string;
    action: string;
    reason: string;
    summary: string;
    confidence: number;
    iconType: 'blur' | 'mute' | 'replace' | 'cut' | 'alert';
}

interface EditPlanPanelProps {
    findings?: Finding[];
}

const EditPlanPanel: React.FC<EditPlanPanelProps> = ({ findings = [] }) => {
    // Map findings to steps
    const steps: EditStep[] = findings.map(f => {
        const confidenceMap: Record<string, number> = { 'High': 95, 'Medium': 80, 'Low': 60 };
        const action = f.suggestedAction || 'Manual Review Required';

        // Simple icon mapping based on suggestedAction
        let iconType: EditStep['iconType'] = 'alert';
        if (action.toLowerCase().includes('blur')) iconType = 'blur';
        else if (action.toLowerCase().includes('mute') || action.toLowerCase().includes('audio')) iconType = 'mute';
        else if (action.toLowerCase().includes('replace') || action.toLowerCase().includes('inpaint')) iconType = 'replace';
        else if (action.toLowerCase().includes('cut') || action.toLowerCase().includes('remove')) iconType = 'cut';

        return {
            id: f.id.toString(),
            violation: f.content,
            action: action,
            reason: `Compliance Risk: ${f.type}`,
            summary: f.context || 'No additional reasoning provided by Gemini.',
            confidence: confidenceMap[f.confidence] || 75,
            iconType
        };
    });

    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(steps.length > 0 ? [steps[0].id] : []));

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIds(newSet);
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'blur': return <EyeOff className="w-4 h-4" />;
            case 'mute': return <VolumeX className="w-4 h-4" />;
            case 'replace': return <ShieldCheck className="w-4 h-4" />;
            case 'cut': return <Scissors className="w-4 h-4" />;
            default: return <AlertCircle className="w-4 h-4" />;
        }
    };

    return (
        <div className="flex flex-col h-full bg-card">
            <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
                <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-accent" />
                    Gemini Remediation Plan
                </h3>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Optimized
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar relative">
                {/* Vertical Line */}
                <div className="absolute left-[27px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-accent/50 via-accent/20 to-transparent pointer-events-none" />

                {steps.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                            <ShieldCheck className="w-8 h-8" />
                        </div>
                        <p className="text-xs font-bold uppercase tracking-[0.2em]">No Remediation Needed</p>
                    </div>
                ) : (
                    steps.map((step) => {
                        const isExpanded = expandedIds.has(step.id);
                        return (
                            <div key={step.id} className="relative pl-10 pb-8 last:pb-0 group">
                                {/* Connector Circle */}
                                <div className={cn(
                                    "absolute left-4 top-1 w-6 h-6 rounded-full flex items-center justify-center z-10 transition-all duration-300 border-2",
                                    isExpanded ? "bg-accent border-accent text-white scale-110 shadow-[0_0_15px_rgba(59,130,246,0.5)]" : "bg-card border-border text-muted-foreground group-hover:border-accent group-hover:text-accent"
                                )}>
                                    {getIcon(step.iconType)}
                                </div>

                                <div
                                    className={cn(
                                        "flex flex-col rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden",
                                        isExpanded
                                            ? "bg-accent/5 border-accent shadow-[0_0_20px_rgba(59,130,246,0.05)]"
                                            : "bg-background/40 border-border/50 hover:bg-muted/10 hover:border-border"
                                    )}
                                    onClick={() => toggleExpand(step.id)}
                                >
                                    <div className="p-3 flex items-start justify-between gap-3">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                                <span>Violation:</span>
                                                <span className="text-white bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">{step.violation}</span>
                                            </div>
                                            <h4 className="text-sm font-bold text-foreground mt-1">{step.action}</h4>
                                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                                <Info className="w-3 h-3 text-accent" />
                                                {step.reason}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="px-3 pb-3 pt-1 border-t border-accent/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="space-y-3">
                                                <div className="bg-background/60 rounded-lg p-2.5 space-y-2 border border-border/50">
                                                    <p className="text-xs leading-relaxed text-muted-foreground italic">
                                                        "{step.summary}"
                                                    </p>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">Confidence Score</div>
                                                        <div className="flex gap-0.5">
                                                            {[...Array(5)].map((_, i) => (
                                                                <div
                                                                    key={i}
                                                                    className={cn(
                                                                        "w-3 h-1 rounded-full",
                                                                        i < Math.round(step.confidence / 20) ? "bg-accent" : "bg-muted"
                                                                    )}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <span className="text-lg font-black italic text-accent tabular-nums">{step.confidence}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="p-4 border-t border-border bg-muted/5">
                <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                    <span>Processing Status</span>
                    <span className="text-accent">Ready for Export</span>
                </div>
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                    <div className="w-full h-full bg-accent animate-pulse" />
                </div>
            </div>
        </div>
    );
};

export default EditPlanPanel;
