import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, VolumeX, EyeOff, ShieldCheck, Play, RefreshCw, Grid, Search, X } from 'lucide-react';
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
        effectType: 'blur' | 'pixelate' | 'replace-runway' | 'censor-beep' | 'censor-dub';
        prompt: string;  // Object to target
        replacementPrompt: string;  // What to replace with (Runway only)
        startTime: number;  // Editable timestamp
        endTime: number;    // Editable timestamp
    }

    const [batchConfigs, setBatchConfigs] = useState<BatchFindingConfig[]>([]);

    // Initialize batch configs from findings
    const initializeBatchConfigs = () => {
        const configs: BatchFindingConfig[] = findings.map(f => {
            // Determine default effect type based on finding type
            let defaultEffect: BatchFindingConfig['effectType'] = 'blur';

            // Audio-based findings: profanity, strong language, offensive language
            const typeLC = f.type?.toLowerCase() || '';
            const isAudioFinding = typeLC.includes('profanity') ||
                typeLC.includes('strong language') ||
                typeLC.includes('offensive') ||
                typeLC.includes('language') ||
                f.category === 'language';

            if (isAudioFinding) {
                // Audio-based finding -> use audio actions
                defaultEffect = 'censor-beep';
            } else if (f.suggestedAction?.toLowerCase().includes('runway')) {
                defaultEffect = 'replace-runway';
            } else if (f.suggestedAction?.toLowerCase().includes('pixelate')) {
                defaultEffect = 'pixelate';
            }

            return {
                finding: f,
                selected: true,
                effectType: defaultEffect,
                prompt: f.content,
                replacementPrompt: '',
                startTime: f.startTime,
                endTime: f.endTime
            };
        });
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
                        setBatchProgress(`Skipped "${config.prompt}" - no replacement prompt provided`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }

                    const { replaceWithRunway } = await import('../services/api');

                    const result = await replaceWithRunway(
                        jobId,
                        config.replacementPrompt,  // What to replace with
                        undefined,      // No reference image (text-only)
                        undefined,      // Default negative prompt
                        Math.ceil(config.endTime - config.startTime),   // Dynamic duration
                        config.startTime,
                        config.endTime
                    );

                    if (result && result.download_path) {
                        lastDownloadUrl = `http://localhost:8000${result.download_path}`;
                    }
                } else if (config.effectType === 'censor-beep' || config.effectType === 'censor-dub') {
                    // Audio censoring for profanity
                    const { censorAudio, getDownloadUrl } = await import('../services/api');

                    const mode = config.effectType === 'censor-beep' ? 'beep' : 'dub';

                    const result = await censorAudio(
                        jobId,
                        mode,
                        undefined, // voiceSampleStart
                        undefined, // voiceSampleEnd
                        undefined, // customWords
                        undefined  // customReplacements - could add UI for this later
                    );

                    if (result && result.download_path) {
                        lastDownloadUrl = `http://localhost:8000${result.download_path}`;
                    } else {
                        lastDownloadUrl = getDownloadUrl(jobId);
                    }
                }
            }

            setBatchProgress(`Successfully processed ${selected.length} findings!`);

            // Pass the final video URL to the parent to reload the player
            if (onActionComplete) {
                onActionComplete('batch-findings', {
                    count: selected.length,
                    downloadUrl: lastDownloadUrl
                });
            }

        } catch (error: any) {
            setBatchProgress(`Error: ${error.message}`);
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
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <VolumeX className="w-3 h-3" />
                    Dub
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
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <RefreshCw className="w-3 h-3" />
                    VACE
                </button>
            );
            buttons.push(
                <button
                    key="replace-pika"
                    onClick={(e) => handleApplyAction(step, 'replace-pika', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <Play className="w-3 h-3" />
                    Pika
                </button>
            );
            buttons.push(
                <button
                    key="replace-runway"
                    onClick={(e) => handleApplyAction(step, 'replace-runway', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <RefreshCw className="w-3 h-3" />
                    Runway
                </button>
            );
        }

        return buttons;
    };

    return (
        <div className="flex flex-col h-full bg-card">
            <div className="p-4 flex items-center justify-between border-b border-border bg-secondary/10">
                <h3 className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground/80 font-mono">Remediation Engine</h3>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-secondary/30">
                    <div className="w-1 h-1 rounded-full bg-emerald-500" />
                    <span className="text-muted-foreground/80 text-[8px] font-semibold uppercase tracking-wider">{jobId ? 'Ready' : 'Pending'}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar relative">
                {/* Custom Object Input Section */}
                <div className="mb-4">
                    <button
                        onClick={() => setShowCustomInput(!showCustomInput)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded border border-border bg-secondary/5 hover:bg-secondary/10 transition-colors"
                    >
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Manual Ingestion / Translate</span>
                        <ChevronDown className={cn("w-3 h-3 text-muted-foreground/60 transition-transform", showCustomInput && "rotate-180")} />
                    </button>

                    {showCustomInput && (
                        <div className="mt-3 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={customObjectInput}
                                    onChange={(e) => setCustomObjectInput(e.target.value)}
                                    placeholder="Describe any object..."
                                    className="w-full pl-10 pr-4 py-2 bg-background/60 border border-border rounded text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                                />
                            </div>

                            {customObjectInput.trim() && (
                                <div className="flex flex-wrap gap-2">
                                    <span className="text-[10px] text-muted-foreground w-full mb-1">Queue Action:</span>
                                    <button
                                        onClick={() => handleAddToQueue('blur')}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors"
                                    >
                                        <EyeOff className="w-3 h-3" />
                                        Blur
                                    </button>
                                    <button
                                        onClick={() => handleAddToQueue('pixelate')}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors"
                                    >
                                        <Grid className="w-3 h-3" />
                                        Pixelate
                                    </button>
                                    <button
                                        onClick={() => handleReplaceWithModal('replace-vace')}
                                        disabled={!jobId}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCw className="w-3 h-3" />
                                        VACE
                                    </button>
                                    <button
                                        onClick={() => handleReplaceWithModal('replace-pika')}
                                        disabled={!jobId}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                                    >
                                        <Play className="w-3 h-3" />
                                        Pika
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
                                Edit Queue ({customObjects.length}):
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {customObjects.map((obj) => (
                                    <div
                                        key={obj.id}
                                        className="flex items-center gap-1.5 px-2 py-1 border border-border/50 bg-secondary/5 rounded text-[10px]"
                                    >
                                        <span className="text-foreground">{obj.name}</span>
                                        <span className="text-muted-foreground/60 uppercase">({obj.appliedEffect})</span>
                                        <button
                                            onClick={() => removeCustomObject(obj.id)}
                                            className="ml-1 p-0.5 hover:bg-secondary rounded transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={handleApplyAll}
                                disabled={isProcessingBatch || !jobId}
                                className="w-full py-2 bg-secondary/10 border border-border hover:bg-secondary/20 text-foreground rounded text-[10px] font-semibold uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isProcessingBatch ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                        Processing
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-3 h-3" />
                                        Apply Queue
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

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
                            <div key={step.id} className="pb-3 last:pb-0">
                                <div
                                    className={cn(
                                        "flex flex-col border transition-all duration-200 cursor-pointer overflow-hidden rounded",
                                        isExpanded
                                            ? "bg-primary/[0.02] border-primary/50 shadow-sm"
                                            : "bg-transparent border-border/80 hover:border-border hover:bg-secondary/[0.02]"
                                    )}
                                    onClick={() => toggleExpand(step.id)}
                                >
                                    <div className="px-3 py-2.5 flex items-start justify-between gap-3 font-mono">
                                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 leading-none">
                                                <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest leading-none pr-1.5 border-r border-border truncate">{step.violation}</span>
                                                <div className={cn("w-1 h-1 rounded-full shrink-0", step.confidence > 80 ? "bg-emerald-500/80" : "bg-amber-500/80")} />
                                                <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider leading-none whitespace-nowrap">{step.confidence}% Match</span>
                                            </div>
                                            <h4 className="text-xs font-semibold text-foreground/90 mt-0.5 truncate">{step.action}</h4>
                                        </div>
                                        <div className="flex items-center self-center shrink-0">
                                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/60" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" />}
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="px-3 pb-3 pt-0 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="p-2.5 bg-secondary/5 border border-border/50 rounded-sm mb-3">
                                                <p className="text-[11px] leading-relaxed text-muted-foreground italic">
                                                    "{step.summary}"
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/40">
                                                {getActionButtons(step)}
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
                            className="w-full py-2 bg-foreground text-background hover:bg-foreground/90 rounded-sm font-semibold text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isProcessingBatch ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                                    Processing
                                </>
                            ) : (
                                <>
                                    Batch Process ({steps.length})
                                </>
                            )}
                        </button>
                        {batchProgress && (
                            <p className={`text-[10px] mt-2 text-center font-medium ${batchProgress.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                                {batchProgress}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-border bg-secondary/5">
                <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2 font-mono">
                    <span>Operational Telemetry</span>
                    <span className="text-primary/60">{jobId ? 'Active' : 'Idle'}</span>
                </div>
                <div className="w-full h-1 bg-secondary/20 rounded-full overflow-hidden">
                    <div className={cn("h-full bg-primary/40", jobId && "animate-pulse w-full")} />
                </div>
            </div>

            {/* Batch Review Modal */}
            {showBatchReviewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setShowBatchReviewModal(false)} />
                    <div className="relative z-10 w-full max-w-4xl max-h-[90vh] bg-card border border-border rounded shadow-2xl overflow-hidden flex flex-col font-mono">
                        <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/20">
                            <h2 className="font-semibold text-[10px] uppercase tracking-widest text-muted-foreground">Batch Pipeline Editor</h2>
                            <button onClick={() => setShowBatchReviewModal(false)} className="p-1 rounded hover:bg-secondary transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                            {batchConfigs.map((config, index) => (
                                <div key={index} className={cn("p-4 border transition-all rounded", config.selected ? "border-primary/30 bg-primary/[0.02]" : "border-border/50 bg-secondary/5")}>
                                    <div className="flex items-start gap-4">
                                        <input
                                            type="checkbox"
                                            checked={config.selected}
                                            onChange={(e) => {
                                                const updated = [...batchConfigs];
                                                updated[index].selected = e.target.checked;
                                                setBatchConfigs(updated);
                                            }}
                                            className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                                        />

                                        <div className="flex-1 space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-[10px] font-bold text-primary italic uppercase tracking-wider">{config.finding.type}</span>
                                                        <span className="text-[10px] text-muted-foreground/60">
                                                            {Math.floor(config.finding.startTime / 60)}:{String(Math.floor(config.finding.startTime % 60)).padStart(2, '0')} - {Math.floor(config.finding.endTime / 60)}:{String(Math.floor(config.finding.endTime % 60)).padStart(2, '0')}
                                                        </span>
                                                    </div>

                                                    <textarea
                                                        value={config.prompt}
                                                        onChange={(e) => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].prompt = e.target.value;
                                                            setBatchConfigs(updated);
                                                        }}
                                                        className="w-full px-3 py-2 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary/50 resize-none font-mono"
                                                        rows={2}
                                                    />

                                                    <div className="mt-3 grid grid-cols-2 gap-4">
                                                        <div className="space-y-1">
                                                            <label className="text-[9px] uppercase font-bold text-muted-foreground/40 tracking-wider">Start (sec)</label>
                                                            <input
                                                                type="number"
                                                                value={config.startTime}
                                                                onChange={(e) => {
                                                                    const updated = [...batchConfigs];
                                                                    updated[index].startTime = parseFloat(e.target.value) || 0;
                                                                    setBatchConfigs(updated);
                                                                }}
                                                                step="0.1"
                                                                className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[9px] uppercase font-bold text-muted-foreground/40 tracking-wider">End (sec)</label>
                                                            <input
                                                                type="number"
                                                                value={config.endTime}
                                                                onChange={(e) => {
                                                                    const updated = [...batchConfigs];
                                                                    updated[index].endTime = parseFloat(e.target.value) || config.startTime;
                                                                    setBatchConfigs(updated);
                                                                }}
                                                                step="0.1"
                                                                className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none"
                                                            />
                                                        </div>
                                                    </div>

                                                    {(config.endTime - config.startTime) > 15 && (
                                                        <div className="mt-3 flex items-center gap-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded">
                                                            <AlertCircle className="w-3 h-3 text-amber-500/60" />
                                                            <span className="text-[9px] text-amber-500/80 font-semibold uppercase tracking-wider">Extended duration Detected</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-col gap-1.5 shrink-0">
                                                    {/* Show different actions based on finding type */}
                                                    {/* Audio-based findings: profanity, strong language, offensive language */}
                                                    {(config.finding.type?.toLowerCase().includes('profanity') ||
                                                        config.finding.type?.toLowerCase().includes('strong language') ||
                                                        config.finding.type?.toLowerCase().includes('offensive') ||
                                                        config.finding.type?.toLowerCase().includes('language') ||
                                                        config.finding.category === 'language') ? (
                                                        // Audio actions for Profanity
                                                        <>
                                                            {['censor-beep', 'censor-dub'].map((type) => (
                                                                <button
                                                                    key={type}
                                                                    onClick={() => {
                                                                        const updated = [...batchConfigs];
                                                                        updated[index].effectType = type as any;
                                                                        setBatchConfigs(updated);
                                                                    }}
                                                                    className={cn(
                                                                        "px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-widest border transition-all",
                                                                        config.effectType === type
                                                                            ? "bg-primary/10 border-primary text-primary"
                                                                            : "bg-transparent border-border text-muted-foreground/40 hover:text-muted-foreground hover:border-border/80"
                                                                    )}
                                                                >
                                                                    {type.replace('censor-', '').toUpperCase()}
                                                                </button>
                                                            ))}
                                                        </>
                                                    ) : (
                                                        // Visual actions for other findings
                                                        <>
                                                            {['blur', 'pixelate', 'replace-runway'].map((type) => (
                                                                <button
                                                                    key={type}
                                                                    onClick={() => {
                                                                        const updated = [...batchConfigs];
                                                                        updated[index].effectType = type as any;
                                                                        setBatchConfigs(updated);
                                                                    }}
                                                                    className={cn(
                                                                        "px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-widest border transition-all",
                                                                        config.effectType === type
                                                                            ? "bg-primary/10 border-primary text-primary"
                                                                            : "bg-transparent border-border text-muted-foreground/40 hover:text-muted-foreground hover:border-border/80"
                                                                    )}
                                                                >
                                                                    {type.replace('replace-', '').toUpperCase()}
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {config.effectType === 'replace-runway' && (
                                                <div className="mt-3 pt-3 border-t border-border/50">
                                                    <label className="text-[9px] uppercase font-bold text-muted-foreground/40 tracking-wider mb-2 block">
                                                        Replacement Prompt
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={config.replacementPrompt}
                                                        onChange={(e) => {
                                                            const updated = [...batchConfigs];
                                                            updated[index].replacementPrompt = e.target.value;
                                                            setBatchConfigs(updated);
                                                        }}
                                                        placeholder="Describe replacement object..."
                                                        className="w-full px-3 py-2 text-xs bg-background border border-border rounded focus:outline-none font-mono"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="p-4 border-t border-border bg-secondary/10 flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest pl-2">
                                {batchConfigs.filter(c => c.selected).length} / {batchConfigs.length} Target Selection
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowBatchReviewModal(false)}
                                    className="px-4 py-2 bg-transparent hover:bg-secondary text-foreground rounded border border-border text-[10px] uppercase font-semibold transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={processBatchFindings}
                                    disabled={batchConfigs.filter(c => c.selected).length === 0}
                                    className="px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded border border-primary/50 text-[10px] uppercase font-semibold transition-all disabled:opacity-50"
                                >
                                    Push Pipeline
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
