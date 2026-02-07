import React, { useState } from 'react';
import { ChevronDown, AlertCircle, VolumeX, EyeOff, ShieldCheck, Play, RefreshCw, Grid, Search, X, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ActionModal, { type ActionType } from './ActionModal';
import BatchProcessModal, { type BatchFindingConfig } from './BatchProcessModal';
import { generateReferenceImage } from '../services/api';

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
            summary: f.context || 'No additional reasoning provided.',
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

    const [batchConfigs, setBatchConfigs] = useState<BatchFindingConfig[]>([]);

    // State for batch image generation
    const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
    const [generatedImages, setGeneratedImages] = useState<Record<number, { url: string; path: string }>>({});

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
            } else if (f.suggestedAction?.toLowerCase().includes('runway') || f.suggestedAction?.toLowerCase() === 'replace') {
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
                endTime: f.endTime,
                intensity: 30, // Default intensity
                beepWords: isAudioFinding ? [f.content.trim().toLowerCase()] : [],
                profanityMatches: (defaultEffect as string) === 'censor-dub' ? [{
                    word: f.content,
                    start_time: f.startTime,
                    end_time: f.endTime,
                    replacement: ''
                }] : []
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
                        config.intensity || 30,
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
                        undefined,      // No uploaded file
                        undefined,      // Default negative prompt
                        Math.ceil(config.endTime - config.startTime),   // Dynamic duration
                        config.startTime,
                        config.endTime,
                        config.referenceImagePath  // AI-generated reference image path
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
                        config.beepWords,
                        undefined, // customReplacements
                        config.effectType === 'censor-dub' ? config.profanityMatches : undefined
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
            buttons.push(
                <button
                    key="replace-runway"
                    onClick={(e) => handleApplyAction(step, 'replace-runway', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <RefreshCw className="w-3 h-3" />
                    Replace
                </button>
            );
        }

        // Replace action - for replace or logo findings
        if (step.iconType === 'replace' || step.finding.category === 'logo') {
            buttons.push(
                <button
                    key="replace-runway"
                    onClick={(e) => handleApplyAction(step, 'replace-runway', e)}
                    disabled={!jobId}
                    className="flex items-center gap-1 px-2 py-1 bg-secondary/20 hover:bg-secondary/30 border border-border rounded text-[9px] font-bold uppercase transition-colors disabled:opacity-50"
                >
                    <RefreshCw className="w-3 h-3" />
                    Replace
                </button>
            );
        }

        return buttons;
    };

    return (
        <div className="flex flex-col h-full bg-card/10 backdrop-blur-md">
            <div className="p-4 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
                <h3 className="font-semibold text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60 font-mono">Remediation Engine</h3>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/5 bg-white/[0.02]">
                    <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)]", jobId ? "bg-emerald-500 animate-pulse" : "bg-white/10")} />
                    <span className="text-muted-foreground/40 text-[9px] font-bold uppercase tracking-wider">{jobId ? 'Ready' : 'Pending'}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-0 custom-scrollbar relative">
                <div className="mb-4 space-y-3">
                    <div className="space-y-3">
                        <button
                            onClick={() => setShowCustomInput(!showCustomInput)}
                            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/10 transition-all duration-200 cursor-pointer"
                        >
                            <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em]">Manual Ingestion / Remediation</span>
                            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform duration-300", showCustomInput && "rotate-180")} />
                        </button>

                        {showCustomInput && (
                            <div className="mt-3 space-y-4">
                                {/* Visual Object Input */}
                                <div className="space-y-3">
                                    <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest pl-1">Visual Object Targeting</span>
                                    <div className="relative group">
                                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-accent transition-colors" />
                                        <input
                                            type="text"
                                            value={customObjectInput}
                                            onChange={(e) => setCustomObjectInput(e.target.value)}
                                            placeholder="Describe any scene element..."
                                            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.02] border border-white/5 rounded-xl text-sm placeholder:text-muted-foreground/20 focus:outline-none focus:border-accent/40 focus:bg-white/[0.04] transition-all"
                                        />
                                    </div>

                                    {customObjectInput.trim() && (
                                        <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                                            <div className="flex flex-wrap gap-2">
                                                {[
                                                    { id: 'blur', icon: EyeOff, label: 'Blur' },
                                                    { id: 'pixelate', icon: Grid, label: 'Pixelate' },
                                                    { id: 'replace-vace', icon: RefreshCw, label: 'Unified' },
                                                    { id: 'replace-pika', icon: Play, label: 'Inpaint' }
                                                ].map((act) => (
                                                    <button
                                                        key={act.id}
                                                        onClick={() => act.id.includes('replace') ? handleReplaceWithModal(act.id as any) : handleAddToQueue(act.id as any)}
                                                        disabled={!jobId}
                                                        className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-20"
                                                    >
                                                        <act.icon className="w-3 h-3 text-accent" />
                                                        {act.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Audio / Dubbing Section */}
                                <div className="space-y-3 pt-3 border-t border-white/5">
                                    <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest pl-1">Audio / Global Dubbing</span>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => {
                                                setSelectedActionType('censor-dub');
                                                setSelectedStep({
                                                    id: 'global-dub',
                                                    finding: { id: -1, type: 'Global Audio', category: 'language', content: 'Full Stream', status: 'warning', confidence: 'High', startTime: 0, endTime: 0 },
                                                    violation: 'Full Audio Stream',
                                                    action: 'Global Voice Dubbing',
                                                    reason: 'Manual audio remediation trigger',
                                                    summary: 'Triggering global audio scan and dubbing interface.',
                                                    confidence: 100,
                                                    iconType: 'mute'
                                                });
                                                setModalOpen(true);
                                            }}
                                            disabled={!jobId}
                                            className="flex items-center justify-center gap-2 px-3 py-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all disabled:opacity-20"
                                        >
                                            <VolumeX className="w-4 h-4 text-accent" />
                                            Voice Dub
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedActionType('censor-beep');
                                                setSelectedStep({
                                                    id: 'global-beep',
                                                    finding: { id: -1, type: 'Global Audio', category: 'language', content: 'Full Stream', status: 'warning', confidence: 'High', startTime: 0, endTime: 0 },
                                                    violation: 'Full Audio Stream',
                                                    action: 'Global Audio Masking',
                                                    reason: 'Manual audio remediation trigger',
                                                    summary: 'Triggering global audio scan and beep masking interface.',
                                                    confidence: 100,
                                                    iconType: 'mute'
                                                });
                                                setModalOpen(true);
                                            }}
                                            disabled={!jobId}
                                            className="flex items-center justify-center gap-2 px-3 py-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all disabled:opacity-20"
                                        >
                                            <VolumeX className="w-4 h-4 text-accent" />
                                            Audio Beep
                                        </button>
                                    </div>
                                </div>

                                {!jobId && (
                                    <p className="text-[10px] text-muted-foreground/40 italic px-1 flex items-center gap-1.5 pt-2">
                                        <AlertCircle className="w-3 h-3" />
                                        Node initialization pending...
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Queue display */}
                    {customObjects.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
                            <div className="flex items-center justify-between px-1">
                                <p className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em]">
                                    Active Pipeline Queue ({customObjects.length})
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {customObjects.map((obj) => (
                                    <div
                                        key={obj.id}
                                        className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] group transition-all hover:bg-white/[0.04] hover:border-white/10"
                                    >
                                        <span className="text-foreground/70 font-medium">{obj.name}</span>
                                        <span className="text-[8px] text-accent/50 font-bold uppercase">{obj.appliedEffect?.replace('replace-', '')}</span>
                                        <button
                                            onClick={() => removeCustomObject(obj.id)}
                                            className="ml-0.5 p-1 text-muted-foreground/30 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all cursor-pointer"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={handleApplyAll}
                                disabled={isProcessingBatch || !jobId}
                                className="w-full py-3 btn-primary shadow-none flex items-center justify-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-30 disabled:grayscale"
                            >
                                {isProcessingBatch ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Processing Pipeline
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-3.5 h-3.5" />
                                        Apply All Changes
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {steps.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-10 space-y-4 opacity-20">
                        <div className="w-20 h-20 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center">
                            <ShieldCheck className="w-10 h-10" />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">Operational Status Clean</p>
                    </div>
                ) : (
                    steps.map((step) => {
                        const isExpanded = expandedIds.has(step.id);
                        return (
                            <div key={step.id} className="pb-3 last:pb-0">
                                <div
                                    className={cn(
                                        "flex flex-col border transition-all duration-300 cursor-pointer overflow-hidden rounded-xl",
                                        isExpanded
                                            ? "bg-white/[0.03] border-accent/40 shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
                                            : "bg-transparent border-white/5 hover:border-white/10 hover:bg-white/[0.01]"
                                    )}
                                    onClick={() => toggleExpand(step.id)}
                                >
                                    <div className="px-4 py-3.5 flex items-start justify-between gap-3 font-mono">
                                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                                            <div className="flex items-center gap-2 leading-none">
                                                <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-[0.15em] pr-2 border-r border-white/5 truncate">{step.violation}</span>
                                                <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", step.confidence > 80 ? "bg-emerald-500/60" : "bg-amber-500/60")} />
                                                <span className="text-[9px] font-bold text-muted-foreground/20 uppercase tracking-widest whitespace-nowrap">{step.confidence}% Probability</span>
                                            </div>
                                            <h4 className="text-xs font-semibold text-foreground/80 mt-0.5 truncate tracking-tight">{step.action}</h4>
                                        </div>
                                        <div className="flex items-center self-center shrink-0">
                                            <ChevronDown className={cn("w-4 h-4 text-muted-foreground/30 transition-transform duration-300", isExpanded && "rotate-180")} />
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="px-4 pb-4 pt-0 animate-in fade-in slide-in-from-top-1 duration-300">
                                            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl mb-4">
                                                <p className="text-[11px] leading-relaxed text-muted-foreground/70 italic">
                                                    "{step.summary}"
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap gap-2 pt-3 border-t border-white/5">
                                                {getActionButtons(step)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}

                {steps.length > 0 && jobId && (
                    <div className="mt-6 mb-4 px-1">
                        <button
                            onClick={initializeBatchConfigs}
                            disabled={isProcessingBatch}
                            className="w-full py-3 bg-white text-background hover:bg-white/90 rounded-xl font-bold text-[10px] uppercase tracking-[0.2em] transition-all disabled:opacity-20 flex items-center justify-center gap-2.5 shadow-[0_8px_20px_rgba(255,255,255,0.05)]"
                        >
                            {isProcessingBatch ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Synchronizing
                                </>
                            ) : (
                                <>
                                    Batch Process Engine ({steps.length})
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
            {/* Batch Review Modal */}
            <BatchProcessModal
                isOpen={showBatchReviewModal}
                onClose={() => setShowBatchReviewModal(false)}
                batchConfigs={batchConfigs}
                onUpdateConfigs={setBatchConfigs}
                onProcess={processBatchFindings}
                generatingImageIndex={generatingImageIndex}
                generatedImages={generatedImages}
                onGenerateImage={async (index) => {
                    const config = batchConfigs[index];
                    if (!jobId || !config.replacementPrompt.trim()) return;
                    setGeneratingImageIndex(index);
                    try {
                        const result = await generateReferenceImage(jobId, config.replacementPrompt, '1:1');
                        setGeneratedImages(prev => ({
                            ...prev,
                            [index]: { url: `http://localhost:8000${result.image_url}`, path: result.image_path }
                        }));
                        // Update the config with the path
                        const updated = [...batchConfigs];
                        updated[index].referenceImagePath = result.image_path;
                        setBatchConfigs(updated);
                    } catch (err) {
                        console.error('Image generation failed:', err);
                    } finally {
                        setGeneratingImageIndex(null);
                    }
                }}
            />

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
                        onActionComplete?.(result.type, { ...result, findingId: selectedStep.finding.id });
                        setModalOpen(false);
                    }}
                />
            )}
        </div>
    );
};

export default EditPlanPanel;
