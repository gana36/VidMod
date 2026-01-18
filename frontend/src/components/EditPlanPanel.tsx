import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, EyeOff, ShieldCheck, Info, Play, RefreshCw, Grid, Plus, Search, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ActionModal, { type ActionType } from './ActionModal';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { type Finding } from './VideoWorkspace';

export interface EditStep {
    id: string;
    finding: Finding;  // Keep full finding for action context
    violation: string;
    action: string;
    reason: string;
    summary: string;
    confidence: number;
    iconType: 'blur' | 'mute' | 'replace' | 'cut' | 'alert';
}

interface EditPlanPanelProps {
    findings?: Finding[];
    jobId?: string;  // Job ID for API calls
    onActionComplete?: (actionType: string, result: any) => void;
}

const EditPlanPanel: React.FC<EditPlanPanelProps> = ({ findings = [], jobId, onActionComplete }) => {
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
            finding: f,
            violation: f.content,
            action: action,
            reason: `Compliance Risk: ${f.type}`,
            summary: f.context || 'No additional reasoning provided by Gemini.',
            confidence: confidenceMap[f.confidence] || 75,
            iconType
        };
    });

    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(steps.length > 0 ? [steps[0].id] : []));
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedStep, setSelectedStep] = useState<EditStep | null>(null);
    const [selectedActionType, setSelectedActionType] = useState<ActionType>('blur');

    // Custom object input
    const [customObjectInput, setCustomObjectInput] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);

    // List of custom objects added by user
    interface CustomObject {
        id: string;
        name: string;
        appliedEffect?: ActionType;
    }
    const [customObjects, setCustomObjects] = useState<CustomObject[]>([]);

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setExpandedIds(newSet);
    };

    const handleApplyAction = (step: EditStep, actionType: ActionType, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedStep(step);
        setSelectedActionType(actionType);
        setModalOpen(true);
    };

    // Check if object is already in queue
    const isObjectInQueue = (objectName: string) => {
        return customObjects.some((obj: CustomObject) => obj.name.toLowerCase() === objectName.toLowerCase());
    };

    // Add object to queue (for blur/pixelate - no modal)
    const handleAddToQueue = (effectType: 'blur' | 'pixelate') => {
        if (!customObjectInput.trim()) return;

        const objectName = customObjectInput.trim();

        // Check for duplicates
        if (isObjectInQueue(objectName)) {
            alert(`"${objectName}" is already in the queue!`);
            return;
        }

        const newCustomObject = {
            id: 'custom-' + Date.now(),
            name: objectName,
            appliedEffect: effectType as ActionType
        };

        // Add to queue (not processed yet)
        setCustomObjects((prev: CustomObject[]) => [...prev, newCustomObject]);

        // Clear input for next object
        setCustomObjectInput('');
    };

    // Handle VACE/Pika replacement (opens modal for replacement prompt)
    const handleReplaceWithModal = (actionType: 'replace-vace' | 'replace-pika') => {
        if (!customObjectInput.trim()) return;

        const objectName = customObjectInput.trim();

        // Check for duplicates
        if (isObjectInQueue(objectName)) {
            alert(`"${objectName}" is already in the queue!`);
            return;
        }

        // Create a custom step for the modal
        const customStep: EditStep = {
            id: 'custom-' + Date.now(),
            finding: {
                id: -1,
                type: 'Custom',
                category: 'other',
                content: objectName,
                status: 'warning',
                confidence: 'High',
                startTime: 0,
                endTime: 0,
                suggestedAction: `Replace ${objectName} with something else`
            },
            violation: objectName,
            action: `Replace with ${actionType === 'replace-vace' ? 'VACE' : 'Pika'}`,
            reason: 'User-defined object',
            summary: `Custom object: ${objectName}`,
            confidence: 100,
            iconType: 'blur'
        };

        setSelectedStep(customStep);
        setSelectedActionType(actionType);
        setModalOpen(true);

        // Clear input
        setCustomObjectInput('');
    };

    // Remove object from queue
    const removeCustomObject = (id: string) => {
        setCustomObjects((prev: CustomObject[]) => prev.filter((obj: CustomObject) => obj.id !== id));
    };

    // State for batch processing
    const [isProcessingBatch, setIsProcessingBatch] = useState(false);
    const [batchProgress, setBatchProgress] = useState('');

    // Apply All - process queue grouped by effect type
    const handleApplyAll = async () => {
        if (customObjects.length === 0 || !jobId) return;

        setIsProcessingBatch(true);

        try {
            // Group objects by effect type
            const groups: Record<string, string[]> = {};
            customObjects.forEach((obj: CustomObject) => {
                const effect = obj.appliedEffect || 'blur';
                if (!groups[effect]) groups[effect] = [];
                groups[effect].push(obj.name);
            });

            console.log('Processing groups:', groups);

            // Process each effect group
            const effectTypes = Object.keys(groups);
            for (let i = 0; i < effectTypes.length; i++) {
                const effectType = effectTypes[i];
                const objects = groups[effectType];
                const combinedPrompt = objects.join(', ');

                setBatchProgress(`Processing ${effectType}: ${combinedPrompt} (${i + 1}/${effectTypes.length})`);

                // Get timestamp from the first finding that matches the objects
                // (For batch processing, we'll use the earliest timestamp)
                const matchingFinding = findings.find(f =>
                    objects.some(obj => f.content.toLowerCase().includes(obj.toLowerCase()))
                );

                // Call API with combined prompt for this effect type + timestamps for Smart Clipping
                const response = await fetch('http://localhost:8000/api/blur-object', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        job_id: jobId,
                        text_prompt: combinedPrompt,
                        effect_type: effectType === 'pixelate' ? 'pixelate' : 'blur',
                        blur_strength: 30,
                        start_time: matchingFinding?.startTime,
                        end_time: matchingFinding?.endTime
                    })
                });

                if (!response.ok) {
                    throw new Error(`Failed to process ${effectType}: ${response.statusText}`);
                }

                const result = await response.json();
                console.log(`${effectType} result:`, result);

                // Notify parent of completion
                if (onActionComplete) {
                    onActionComplete(effectType, {
                        downloadUrl: `http://localhost:8000${result.download_path}`,
                        objectName: combinedPrompt
                    });
                }
            }

            // Clear queue after successful processing
            setCustomObjects([]);
            setBatchProgress('All effects applied successfully!');

        } catch (error) {
            console.error('Batch processing error:', error);
            setBatchProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsProcessingBatch(false);
            setTimeout(() => setBatchProgress(''), 3000);
        }
    };


    // Determine which action buttons to show based on iconType
    const getActionButtons = (step: EditStep) => {
        const buttons = [];

        // Blur/Mask action - always available
        if (step.iconType === 'blur' || step.iconType === 'alert' || step.iconType === 'cut') {
            buttons.push(
                <button
                    key="blur"
                    onClick={(e) => handleApplyAction(step, 'blur', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <EyeOff className="w-3 h-3" />
                    Blur
                </button>
            );
            buttons.push(
                <button
                    key="pixelate"
                    onClick={(e) => handleApplyAction(step, 'pixelate' as any, e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Grid className="w-3 h-3" />
                    Pixelate
                </button>
            );
        }

        // Replace action - for replace or logo findings
        if (step.iconType === 'replace' || step.finding.category === 'logo') {
            buttons.push(
                <button
                    key="replace-vace"
                    onClick={(e) => handleApplyAction(step, 'replace-vace', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <RefreshCw className="w-3 h-3" />
                    VACE Replace
                </button>
            );
            buttons.push(
                <button
                    key="replace-pika"
                    onClick={(e) => handleApplyAction(step, 'replace-pika', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Play className="w-3 h-3" />
                    Pika Replace
                </button>
            );
        }

        return buttons;
    };


    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Custom Object Input Section */}
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs uppercase tracking-[0.15em] text-muted-foreground">Manual Targeting</h3>
                    <div className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest border border-primary/20">
                        Overlay Engine
                    </div>
                </div>

                <div className="glass-card p-4 space-y-4 bg-primary/[0.02]">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Target Object</span>
                        <button
                            onClick={() => setShowCustomInput(!showCustomInput)}
                            className="text-primary hover:text-primary/80 transition-colors"
                        >
                            {showCustomInput ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                    </div>

                    <AnimatePresence>
                        {showCustomInput && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="space-y-4 overflow-hidden"
                            >
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                                    <input
                                        type="text"
                                        value={customObjectInput}
                                        onChange={(e) => setCustomObjectInput(e.target.value)}
                                        placeholder="Describe object (e.g. 'red car')"
                                        className="w-full pl-9 pr-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                    />
                                </div>

                                {customObjectInput.trim() && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { id: 'blur', label: 'Blur', icon: EyeOff, color: 'text-amber-400', bg: 'bg-amber-400/10' },
                                            { id: 'pixelate', label: 'Pixel', icon: Grid, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
                                            { id: 'replace-vace', label: 'VACE', icon: RefreshCw, color: 'text-primary', bg: 'bg-primary/10', needsJob: true },
                                            { id: 'replace-pika', label: 'Pika', icon: Play, color: 'text-purple-400', bg: 'bg-purple-400/10', needsJob: true },
                                        ].map((action) => (
                                            <button
                                                key={action.id}
                                                onClick={() => {
                                                    if (action.id === 'blur' || action.id === 'pixelate') handleAddToQueue(action.id as any);
                                                    else handleReplaceWithModal(action.id as any);
                                                }}
                                                disabled={action.needsJob && !jobId}
                                                className={cn(
                                                    "flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/5 hover:border-white/20 transition-all active:scale-95 group",
                                                    action.bg, action.color,
                                                    action.needsJob && !jobId && "opacity-40 cursor-not-allowed"
                                                )}
                                            >
                                                <action.icon className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                                <span className="text-[10px] font-black uppercase tracking-widest">{action.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Queue display */}
                    {customObjects.length > 0 && (
                        <div className="pt-4 border-t border-white/5 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Active Queue</span>
                                <span className="text-[9px] text-primary tabular-nums font-black">{customObjects.length}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {customObjects.map((obj: CustomObject) => (
                                    <motion.div
                                        layout
                                        initial={{ scale: 0.9, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        key={obj.id}
                                        className={cn(
                                            "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold",
                                            obj.appliedEffect === 'pixelate' ? "bg-cyan-400/5 border-cyan-400/20 text-cyan-400" : "bg-amber-400/5 border-amber-400/20 text-amber-400"
                                        )}
                                    >
                                        <span>{obj.name}</span>
                                        <button onClick={() => removeCustomObject(obj.id)} className="hover:text-white transition-colors">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </motion.div>
                                ))}
                            </div>

                            <button
                                onClick={handleApplyAll}
                                disabled={isProcessingBatch || !jobId}
                                className="w-full py-3 btn-primary disabled:opacity-40 disabled:scale-100 flex items-center justify-center gap-2 overflow-hidden relative"
                            >
                                {isProcessingBatch ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span className="text-[10px] uppercase font-black tracking-widest">Authorizing...</span>
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-3.5 h-3.5" />
                                        <span className="text-[10px] uppercase font-black tracking-widest">Execute Batch Apply</span>
                                    </>
                                )}
                                {isProcessingBatch && (
                                    <motion.div
                                        className="absolute bottom-0 left-0 h-0.5 bg-white/40"
                                        initial={{ width: 0 }}
                                        animate={{ width: '100%' }}
                                        transition={{ duration: 2 }}
                                    />
                                )}
                            </button>
                            {batchProgress && (
                                <p className="text-[9px] font-medium text-center opacity-60 uppercase tracking-widest">
                                    {batchProgress}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4 custom-scrollbar">
                <div className="flex items-center justify-between sticky top-0 py-2 bg-[var(--background)]/80 backdrop-blur-sm z-20">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Remediation Steps</span>
                    <span className="text-[10px] text-muted-foreground/60">{steps.length} actions planned</span>
                </div>

                {steps.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center text-center p-8 space-y-4 rounded-2xl bg-white/[0.02] border border-dashed border-border/50 opacity-40">
                        <ShieldCheck className="w-8 h-8" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Clean Environment</p>
                    </div>
                ) : (
                    <div className="space-y-4 relative">
                        {/* Vertical Timeline Line */}
                        <div className="absolute left-[19px] top-6 bottom-6 w-px bg-gradient-to-b from-primary/40 via-primary/10 to-transparent" />

                        {steps.map((step) => {
                            const isExpanded = expandedIds.has(step.id);
                            return (
                                <div key={step.id} className="relative pl-10 group">
                                    {/* Timeline Node */}
                                    <div className={cn(
                                        "absolute left-2.5 top-1.5 w-3.5 h-3.5 rounded-full z-10 transition-all duration-300 border-2",
                                        isExpanded ? "bg-primary border-primary shadow-[0_0_10px_rgba(59,130,246,0.6)]" : "bg-background border-border group-hover:border-primary"
                                    )} />

                                    <motion.div
                                        layout
                                        className={cn(
                                            "glass-card overflow-hidden transition-all duration-300",
                                            isExpanded ? "ring-1 ring-primary/30 bg-primary/[0.02]" : "hover:border-white/20"
                                        )}
                                    >
                                        <div
                                            className="p-4 cursor-pointer flex items-start justify-between gap-4"
                                            onClick={() => toggleExpand(step.id)}
                                        >
                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-primary opacity-60">Step {step.id}</span>
                                                    <div className="h-px w-4 bg-white/10" />
                                                    <span className="text-[10px] font-bold bg-red-400/10 text-red-400 px-1.5 py-0.5 rounded border border-red-400/20 uppercase tracking-tighter truncate">{step.violation}</span>
                                                </div>
                                                <h4 className="text-sm font-bold tracking-tight">{step.action}</h4>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-3.5 h-3.5 rounded flex items-center justify-center bg-primary/10 text-primary">
                                                        <Info className="w-2.5 h-2.5" />
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">{step.reason}</p>
                                                </div>
                                            </div>
                                            <div className={cn("p-1.5 rounded-lg bg-white/5 transition-transform", isExpanded && "rotate-180")}>
                                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    className="border-t border-white/[0.03]"
                                                >
                                                    <div className="p-4 space-y-4">
                                                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                                            <p className="text-[11px] leading-relaxed text-muted-foreground/80 italic">
                                                                "{step.summary}"
                                                            </p>
                                                        </div>

                                                        <div className="flex items-center justify-between">
                                                            <div className="space-y-1">
                                                                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Trust Rating</span>
                                                                <div className="flex gap-1">
                                                                    {[...Array(5)].map((_, i) => (
                                                                        <div
                                                                            key={i}
                                                                            className={cn(
                                                                                "w-3 h-1 rounded-full transition-colors",
                                                                                i < Math.round(step.confidence / 20) ? "bg-primary" : "bg-white/10"
                                                                            )}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-lg font-black tracking-tighter text-primary">{step.confidence}%</span>
                                                                <p className="text-[8px] font-medium text-muted-foreground/40 uppercase tracking-widest">Confidence</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                                                            {getActionButtons(step).map((btn, i) => (
                                                                <div key={i} className="contents shadow-lg shadow-black/20">
                                                                    {btn}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="p-4 mt-auto border-t border-border bg-white/[0.01]">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Workflow Engine</span>
                    <span className="text-[9px] text-emerald-400 font-bold uppercase tabular-nums">Integrity Validated</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-emerald-400"
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                    />
                </div>
            </div>

            {/* Action Modal */}
            {modalOpen && selectedStep && jobId && (
                <ActionModal
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    jobId={jobId}
                    actionType={selectedActionType}
                    objectPrompt={selectedStep.violation}
                    startTime={selectedStep.finding.startTime}
                    endTime={selectedStep.finding.endTime}
                    onActionComplete={(result) => {
                        onActionComplete?.(result.type, result);
                        setModalOpen(false);
                    }}
                />
            )}
        </div>
    );
};

export default EditPlanPanel;
