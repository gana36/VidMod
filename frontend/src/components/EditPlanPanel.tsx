import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, Scissors, VolumeX, EyeOff, ShieldCheck, Info, Play, RefreshCw, Grid, Plus, Search, X, Zap } from 'lucide-react';
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
        return customObjects.some(obj => obj.name.toLowerCase() === objectName.toLowerCase());
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
        setCustomObjects(prev => [...prev, newCustomObject]);

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
        setCustomObjects(prev => prev.filter(obj => obj.id !== id));
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
        effectType: 'blur' | 'pixelate' | 'replace-runway';
        prompt: string;  // Object to target
        replacementPrompt: string;  // What to replace with (Runway only)
        startTime: number;  // Editable timestamp
        endTime: number;    // Editable timestamp
    }

    const [batchConfigs, setBatchConfigs] = useState<BatchFindingConfig[]>([]);

    // Initialize batch configs from findings
    const initializeBatchConfigs = () => {
        const configs: BatchFindingConfig[] = findings.map(f => ({
            finding: f,
            selected: true, // All selected by default
            effectType: (f.suggestedAction?.toLowerCase().includes('runway') ? 'replace-runway' : f.suggestedAction?.toLowerCase().includes('pixelate') ? 'pixelate' : 'blur') as 'blur' | 'pixelate' | 'replace-runway',
            prompt: f.content,
            replacementPrompt: '',  // User fills this for Runway
            startTime: f.startTime,
            endTime: f.endTime
        }));
        setBatchConfigs(configs);
        setShowBatchReviewModal(true);
    };

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

                if (config.effectType === 'blur' || config.effectType === 'pixelate') {
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
                } else if (config.effectType === 'replace-runway') {
                    // Runway: text-only replacement with Smart Clipping
                    if (!config.replacementPrompt.trim()) {
                        setBatchProgress(`⚠️ Skipped "${config.prompt}" - no replacement prompt provided`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }

                    const { replaceWithRunway } = await import('../services/api');

                    const result = await replaceWithRunway(
                        jobId,
                        config.replacementPrompt,  // What to replace with
                        undefined,      // No reference image (text-only)
                        undefined,      // Default negative prompt
                        5,              // Duration
                        config.startTime,
                        config.endTime
                    );

                    if (result && result.download_path) {
                        lastDownloadUrl = `http://localhost:8000${result.download_path}`;
                    }
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


    // Apply All - process queue with timeline-based grouping for efficiency
    const handleApplyAll = async () => {
        if (customObjects.length === 0 || !jobId) return;

        setIsProcessingBatch(true);

        try {
            console.log('Processing objects with timeline grouping:', customObjects);

            // Step 1: Match each object with its finding to get timeline
            const objectsWithTimeline = customObjects.map(obj => {
                const matchingFinding = findings.find(f =>
                    f.content.toLowerCase().includes(obj.name.toLowerCase()) ||
                    obj.name.toLowerCase().includes(f.content.toLowerCase())
                );

                return {
                    ...obj,
                    startTime: matchingFinding?.startTime,
                    endTime: matchingFinding?.endTime,
                    effectType: obj.appliedEffect || 'blur'
                };
            });

            // Step 2: Group by timeline + effect type
            // Key format: "startTime-endTime-effectType"
            const grouped = new Map<string, typeof objectsWithTimeline>();

            objectsWithTimeline.forEach(obj => {
                const key = `${obj.startTime ?? 'none'}-${obj.endTime ?? 'none'}-${obj.effectType}`;
                const existing = grouped.get(key) || [];
                grouped.set(key, [...existing, obj]);
            });

            console.log(`Grouped ${customObjects.length} objects into ${grouped.size} batches`);

            // Step 3: Process each group
            let processedCount = 0;
            for (const [, group] of grouped.entries()) {
                const effectType = group[0].effectType;
                const objectNames = group.map(obj => obj.name);

                setBatchProgress(`Processing ${processedCount + 1}-${processedCount + group.length}/${customObjects.length}: ${objectNames.join(', ')}`);

                // Route to appropriate API based on effect type
                if (effectType === 'blur' || effectType === 'pixelate') {
                    // Combine all object names into a single prompt for SAM3
                    const combinedPrompt = objectNames.join(', ');

                    const response = await fetch('http://localhost:8000/api/blur-object', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            job_id: jobId,
                            text_prompt: combinedPrompt,
                            effect_type: effectType === 'pixelate' ? 'pixelate' : 'blur',
                            blur_strength: 30,
                            start_time: group[0].startTime,
                            end_time: group[0].endTime
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to ${effectType} ${combinedPrompt}`);
                    }

                    console.log(`✓ Grouped ${group.length} objects: ${combinedPrompt}`);
                } else if (effectType === 'replace-pika' || effectType === 'replace-vace' || effectType === 'replace-runway') {
                    // Replacement: Need reference image (skip if not available)
                    console.warn(`Skipping ${effectType} for ${objectNames.join(', ')} - reference image required`);
                    setBatchProgress(`Skipped ${objectNames.join(', ')} (${effectType} requires reference image)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                processedCount += group.length;
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

    const getIcon = (type: string) => {
        switch (type) {
            case 'blur': return <EyeOff className="w-4 h-4" />;
            case 'mute': return <VolumeX className="w-4 h-4" />;
            case 'replace': return <ShieldCheck className="w-4 h-4" />;
            case 'cut': return <Scissors className="w-4 h-4" />;
            default: return <AlertCircle className="w-4 h-4" />;
        }
    };

    // Determine which action buttons to show based on iconType
    const getActionButtons = (step: EditStep) => {
        const buttons = [];

        // Audio Censoring - for language/profanity findings
        if (step.iconType === 'mute' || step.finding.category === 'language') {
            buttons.push(
                <button
                    key="censor-beep"
                    onClick={(e) => handleApplyAction(step, 'censor-beep' as any, e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <VolumeX className="w-3 h-3" />
                    Beep
                </button>
            );
            buttons.push(
                <button
                    key="censor-dub"
                    onClick={(e) => handleApplyAction(step, 'censor-dub' as any, e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <VolumeX className="w-3 h-3" />
                    Voice Dub
                </button>
            );
        }

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
            buttons.push(
                <button
                    key="replace-runway"
                    onClick={(e) => handleApplyAction(step, 'replace-runway', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Zap className="w-3 h-3" />
                    Runway Replace
                </button>
            );
        }

        return buttons;
    };


    // Extract replacement prompt from suggested action
    const getReplacementPrompt = (step: EditStep): string => {
        const action = step.action.toLowerCase();
        // Try to extract what to replace with from the action text
        if (action.includes('replace with')) {
            const match = action.match(/replace with\s+(.+)/i);
            return match ? match[1] : '';
        }
        if (action.includes('inpaint')) {
            return 'generic object';
        }
        return '';
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
                    {jobId ? 'Ready' : 'Optimized'}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar relative">
                {/* Custom Object Input Section */}
                <div className="mb-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-3">
                    <button
                        onClick={() => setShowCustomInput(!showCustomInput)}
                        className="w-full flex items-center gap-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Custom Object to Edit
                        <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${showCustomInput ? 'rotate-180' : ''}`} />
                    </button>

                    {showCustomInput && (
                        <div className="mt-3 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={customObjectInput}
                                    onChange={(e) => setCustomObjectInput(e.target.value)}
                                    placeholder="Describe any object (e.g., 'red car', 'person in blue shirt', 'company logo')"
                                    className="w-full pl-10 pr-4 py-2.5 bg-background/60 border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                                />
                            </div>

                            {customObjectInput.trim() && (
                                <div className="flex flex-wrap gap-2">
                                    <span className="text-[10px] text-muted-foreground w-full mb-1">Add to queue with effect:</span>
                                    <button
                                        onClick={() => handleAddToQueue('blur')}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-xs font-medium transition-colors"
                                    >
                                        <EyeOff className="w-3.5 h-3.5" />
                                        + Blur
                                    </button>
                                    <button
                                        onClick={() => handleAddToQueue('pixelate')}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-xs font-medium transition-colors"
                                    >
                                        <Grid className="w-3.5 h-3.5" />
                                        + Pixelate
                                    </button>
                                    <button
                                        onClick={() => handleReplaceWithModal('replace-vace')}
                                        disabled={!jobId}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        VACE Replace
                                    </button>
                                    <button
                                        onClick={() => handleReplaceWithModal('replace-pika')}
                                        disabled={!jobId}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                        <Play className="w-3.5 h-3.5" />
                                        Pika Replace
                                    </button>
                                </div>
                            )}

                            {!jobId && (
                                <p className="text-[10px] text-muted-foreground italic">Upload a video first to enable actions</p>
                            )}
                        </div>
                    )}

                    {/* Queue display */}
                    {customObjects.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-[10px] font-bold text-muted-foreground mb-2 uppercase tracking-wider">
                                Edit Queue ({customObjects.length} objects):
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {customObjects.map((obj) => (
                                    <div
                                        key={obj.id}
                                        className={`flex items-center gap-1.5 px-2 py-1 border rounded-lg text-xs ${obj.appliedEffect === 'pixelate'
                                            ? 'bg-cyan-500/10 border-cyan-500/30'
                                            : 'bg-amber-500/10 border-amber-500/30'
                                            }`}
                                    >
                                        <span className="text-foreground">{obj.name}</span>
                                        <span className={obj.appliedEffect === 'pixelate' ? 'text-cyan-400' : 'text-amber-400'}>
                                            ({obj.appliedEffect})
                                        </span>
                                        <button
                                            onClick={() => removeCustomObject(obj.id)}
                                            className="ml-1 p-0.5 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400 transition-colors"
                                            title="Remove"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Apply All button */}
                            <button
                                onClick={handleApplyAll}
                                disabled={isProcessingBatch || !jobId}
                                className="w-full py-2.5 bg-gradient-to-r from-accent to-emerald-500 hover:from-accent/90 hover:to-emerald-500/90 text-white rounded-lg text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isProcessingBatch ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        Apply All ({customObjects.length} objects)
                                    </>
                                )}
                            </button>

                            {/* Progress display */}
                            {batchProgress && (
                                <p className={`text-[10px] mt-2 text-center ${batchProgress.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {batchProgress}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Vertical Line */}
                <div className="absolute left-[27px] top-[140px] bottom-6 w-[2px] bg-gradient-to-b from-accent/50 via-accent/20 to-transparent pointer-events-none" />

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

                                                {/* Action Buttons */}
                                                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
                                                    {getActionButtons(step)}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Process All Findings Button */}
                {steps.length > 0 && jobId && (
                    <div className="mt-6 mb-4">
                        <button
                            onClick={initializeBatchConfigs}
                            disabled={isProcessingBatch}
                            className="w-full py-3 bg-white hover:bg-gray-100 text-gray-900 rounded-full font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-gray-200"
                        >
                            {isProcessingBatch ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                                    PROCESSING...
                                </>
                            ) : (
                                <>
                                    🚀 PROCESS ALL FINDINGS ({steps.length} ITEMS)
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

            <div className="p-4 border-t border-border bg-muted/5">
                <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                    <span>Processing Status</span>
                    <span className="text-accent">{jobId ? 'Actions Available' : 'Ready for Export'}</span>
                </div>
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                    <div className="w-full h-full bg-accent animate-pulse" />
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
                                                        className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${config.effectType === 'blur'
                                                            ? 'bg-white text-gray-900 border-2 border-white'
                                                            : 'bg-transparent text-gray-400 border border-gray-600 hover:border-gray-400 hover:text-gray-300'
                                                            }`}
                                                    >
                                                        BLUR
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].effectType = 'pixelate';
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${config.effectType === 'pixelate'
                                                            ? 'bg-white text-gray-900 border-2 border-white'
                                                            : 'bg-transparent text-gray-400 border border-gray-600 hover:border-gray-400 hover:text-gray-300'
                                                            }`}
                                                    >
                                                        PIXELATE
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].effectType = 'replace-runway';
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${config.effectType === 'replace-runway'
                                                            ? 'bg-white text-gray-900 border-2 border-white'
                                                            : 'bg-transparent text-gray-400 border border-gray-600 hover:border-gray-400 hover:text-gray-300'
                                                            }`}
                                                    >
                                                        REPLACE
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Runway Replacement Prompt - Full Width Row */}
                                    {config.effectType === 'replace-runway' && (
                                        <div className="mt-4 pt-4 border-t border-border">
                                            <label className="text-sm font-semibold text-foreground block mb-2">
                                                ✨ Replace "{config.prompt}" with:
                                            </label>
                                            <input
                                                type="text"
                                                value={config.replacementPrompt}
                                                onChange={(e) => {
                                                    const updated = [...batchConfigs];
                                                    updated[index].replacementPrompt = e.target.value;
                                                    setBatchConfigs(updated);
                                                }}
                                                placeholder="Describe what should replace this object (e.g., red lollipop, empty table, blue coffee mug)"
                                                className="w-full px-4 py-3 text-sm bg-background border-2 border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent placeholder:text-muted-foreground/50"
                                            />
                                            <p className="text-xs text-muted-foreground mt-2">Runway AI will generate a replacement based on your description</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                {batchConfigs.filter(c => c.selected).length} of {batchConfigs.length} selected
                            </span>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowBatchReviewModal(false)}
                                    className="px-6 py-2.5 bg-transparent hover:bg-gray-100 text-foreground rounded-full font-bold uppercase tracking-wider transition-colors border border-gray-300"
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={processBatchFindings}
                                    disabled={batchConfigs.filter(c => c.selected).length === 0}
                                    className="px-6 py-2.5 bg-white hover:bg-gray-100 text-gray-900 rounded-full font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200"
                                >
                                    PROCESS SELECTED ({batchConfigs.filter(c => c.selected).length})
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
