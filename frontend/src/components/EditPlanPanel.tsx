import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, EyeOff, ShieldCheck, Info, Play, RefreshCw, Grid, Plus, Search, X, AlertCircle } from 'lucide-react';
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

    // State for batch review modal
    const [showBatchReviewModal, setShowBatchReviewModal] = useState(false);

    // Batch findings configuration (editable in modal)
    interface BatchFindingConfig {
        finding: Finding;
        selected: boolean;
        effectType: 'blur' | 'pixelate';
        prompt: string;
        startTime: number;  // Editable timestamp
        endTime: number;    // Editable timestamp
    }

    const [batchConfigs, setBatchConfigs] = useState<BatchFindingConfig[]>([]);

    // Initialize batch configs from findings
    const initializeBatchConfigs = () => {
        const configs: BatchFindingConfig[] = findings.map(f => ({
            finding: f,
            selected: true, // All selected by default
            effectType: (f.suggestedAction?.toLowerCase().includes('pixelate') ? 'pixelate' : 'blur') as 'blur' | 'pixelate',
            prompt: f.content,
            startTime: f.startTime,
            endTime: f.endTime
        }));
        setBatchConfigs(configs);
        setShowBatchReviewModal(true);
    };

    // Process selected findings
    // Process selected findings
    const processBatchFindings = async () => {
        const selected = batchConfigs.filter(c => c.selected);
        if (selected.length === 0 || !jobId) return;

        setShowBatchReviewModal(false);
        setIsProcessingBatch(true);
        setBatchProgress(`Starting batch process for ${selected.length} findings...`);

        try {
            let lastDownloadUrl = '';

            for (let i = 0; i < selected.length; i++) {
                const config = selected[i];
                const shortPrompt = config.prompt.substring(0, 60) + (config.prompt.length > 60 ? '...' : '');

                setBatchProgress(`Processing ${i + 1}/${selected.length}: ${shortPrompt}`);

                // Import blurObject from api
                const { blurObject } = await import('../services/api');

                const result = await blurObject(
                    jobId,
                    config.prompt,
                    30,
                    config.effectType,
                    config.startTime,  // Use editable timestamp
                    config.endTime     // Use editable timestamp
                );

                if (result && result.download_path) {
                    lastDownloadUrl = `http://localhost:8000${result.download_path}`;
                }
            }

            setBatchProgress(`✅ Successfully processed ${selected.length} findings!`);

            // Pass the final video URL to the parent to reload the player
            if (onActionComplete) {
                onActionComplete('batch-findings', {
                    count: selected.length,
                    downloadUrl: lastDownloadUrl
                });
            }

        } catch (error: any) {
            setBatchProgress(`❌ Error: ${error.message}`);
        } finally {
            setTimeout(() => {
                setIsProcessingBatch(false);
                setBatchProgress('');
            }, 3000);
        }
    };

    // Apply All - process queue sequentially to ensure Smart Clipping works correctly for each item
    const handleApplyAll = async () => {
        if (customObjects.length === 0 || !jobId) return;

        setIsProcessingBatch(true);

        try {
            console.log('Processing objects sequentially:', customObjects);

            // Process each object sequentially to respect individual timestamps for Smart Clipping
            for (let i = 0; i < customObjects.length; i++) {
                const obj = customObjects[i];
                setBatchProgress(`Processing ${i + 1}/${customObjects.length}: ${obj.name}`);

                // Get timestamp from the matching finding
                // Use the FIRST finding that matches the content
                const matchingFinding = findings.find(f =>
                    f.content.toLowerCase().includes(obj.name.toLowerCase()) ||
                    obj.name.toLowerCase().includes(f.content.toLowerCase())
                );

                // Effective Prompt: Use the object name
                const effectType = obj.appliedEffect || 'blur';

                // Call API for this single object/effect
                const response = await fetch('http://localhost:8000/api/blur-object', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        job_id: jobId,
                        text_prompt: obj.name,
                        effect_type: effectType === 'pixelate' ? 'pixelate' : 'blur',
                        blur_strength: 30,
                        start_time: matchingFinding?.startTime,
                        end_time: matchingFinding?.endTime
                    })
                });

                if (!response.ok) {
                    throw new Error(`Failed to process ${obj.name}`);
                }
            }

            // Clear queue logic 
            setCustomObjects([]);

            // Trigger refresh
            if (onActionComplete) {
                onActionComplete('batch-queue', { count: customObjects.length });
            }

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

                {/* Process All Findings Button */}
                {steps.length > 0 && jobId && (
                    <div className="mt-6 mb-4">
                        <button
                            onClick={initializeBatchConfigs}
                            disabled={isProcessingBatch}
                            className="w-full py-3 bg-gradient-to-r from-accent via-purple-600 to-pink-600 hover:from-accent/90 hover:via-purple-600/90 hover:to-pink-600/90 text-white rounded-xl font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
                        >
                            {isProcessingBatch ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    🚀 Process All Findings ({steps.length} items)
                                </>
                            )}
                        </button>
                        {batchProgress && (
                            <p className={`text-sm mt-2 text-center font-medium ${batchProgress.includes('Error') || batchProgress.includes('❌') ? 'text-red-400' : 'text-emerald-400'}`}>
                                {batchProgress}
                            </p>
                        )}
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


            {/* Batch Review Modal */}
            {showBatchReviewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowBatchReviewModal(false)} />

                    {/* Modal */}
                    <div className="relative z-10 w-full max-w-4xl max-h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                            <h2 className="font-bold text-lg flex items-center gap-2">
                                🚀 Batch Process Findings
                            </h2>
                            <button onClick={() => setShowBatchReviewModal(false)} className="p-1 rounded-lg hover:bg-muted transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                            {batchConfigs.map((config, index) => (
                                <div key={index} className={`p-4 rounded-xl border transition-all ${config.selected ? 'border-accent bg-accent/5' : 'border-border bg-muted/10'}`}>
                                    <div className="flex items-start gap-3">
                                        {/* Checkbox */}
                                        <input
                                            type="checkbox"
                                            checked={config.selected}
                                            onChange={(e) => {
                                                const updated = [...batchConfigs];
                                                updated[index].selected = e.target.checked;
                                                setBatchConfigs(updated);
                                            }}
                                            className="mt-1 w-5 h-5 rounded border-2 border-accent text-accent focus:ring-2 focus:ring-accent cursor-pointer"
                                        />

                                        <div className="flex-1 space-y-3">
                                            {/* Finding Info */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-bold text-accent uppercase">{config.finding.type}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {Math.floor(config.finding.startTime / 60)}:{String(Math.floor(config.finding.startTime % 60)).padStart(2, '0')} - {Math.floor(config.finding.endTime / 60)}:{String(Math.floor(config.finding.endTime % 60)).padStart(2, '0')}
                                                        </span>
                                                    </div>

                                                    {/* Editable Prompt */}
                                                    <textarea
                                                        value={config.prompt}
                                                        onChange={(e) => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].prompt = e.target.value;
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                                                        rows={2}
                                                        placeholder="Object description..."
                                                    />

                                                    {/* Editable Timestamps */}
                                                    <div className="mt-2 space-y-2">
                                                        <div className="flex items-center gap-3">
                                                            <label className="text-xs text-muted-foreground min-w-[60px]">Start:</label>
                                                            <input
                                                                type="number"
                                                                value={config.startTime}
                                                                onChange={(e) => {
                                                                    const updated = [...batchConfigs];
                                                                    updated[index].startTime = parseFloat(e.target.value) || 0;
                                                                    setBatchConfigs(updated);
                                                                }}
                                                                step="0.1"
                                                                min="0"
                                                                className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                                                placeholder="0.0"
                                                            />
                                                            <span className="text-xs text-muted-foreground">seconds</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <label className="text-xs text-muted-foreground min-w-[60px]">End:</label>
                                                            <input
                                                                type="number"
                                                                value={config.endTime}
                                                                onChange={(e) => {
                                                                    const updated = [...batchConfigs];
                                                                    updated[index].endTime = parseFloat(e.target.value) || 0;
                                                                    setBatchConfigs(updated);
                                                                }}
                                                                step="0.1"
                                                                min={config.startTime}
                                                                className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                                                placeholder="0.0"
                                                            />
                                                            <span className="text-xs text-muted-foreground">seconds</span>
                                                        </div>

                                                        {/* Duration Warning */}
                                                        {(config.endTime - config.startTime) > 15 && (
                                                            <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                                                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                                                <span className="text-xs text-amber-400">
                                                                    ⚠️ Clip duration is {(config.endTime - config.startTime).toFixed(1)}s. SAM3 works best with clips ≤ 15 seconds.
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Effect Type Toggle */}
                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        onClick={() => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].effectType = 'blur';
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${config.effectType === 'blur'
                                                            ? 'bg-amber-500/20 text-amber-400 border-2 border-amber-500'
                                                            : 'bg-muted border border-border text-muted-foreground hover:bg-muted-foreground/10'
                                                            }`}
                                                    >
                                                        <EyeOff className="w-3 h-3 inline mr-1" />
                                                        Blur
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].effectType = 'pixelate';
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${config.effectType === 'pixelate'
                                                            ? 'bg-cyan-500/20 text-cyan-400 border-2 border-cyan-500'
                                                            : 'bg-muted border border-border text-muted-foreground hover:bg-muted-foreground/10'
                                                            }`}
                                                    >
                                                        <Grid className="w-3 h-3 inline mr-1" />
                                                        Pixelate
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                {batchConfigs.filter(c => c.selected).length} of {batchConfigs.length} selected
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowBatchReviewModal(false)}
                                    className="px-4 py-2 bg-muted hover:bg-muted-foreground/20 rounded-lg font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={processBatchFindings}
                                    disabled={batchConfigs.filter(c => c.selected).length === 0}
                                    className="px-6 py-2 bg-gradient-to-r from-accent to-purple-600 hover:from-accent/90 hover:to-purple-600/90 text-white rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Process Selected ({batchConfigs.filter(c => c.selected).length})
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
