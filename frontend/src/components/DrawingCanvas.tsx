import React, { useState, useRef } from 'react';
import { Droplets, ShieldAlert, VolumeX, X, MousePointer2, Wand2, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { analyzeManual, type ManualAction } from '../services/api';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface Box {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface DrawingCanvasProps {
    jobId: string;
    currentTime: number;
    onConfirm: (box: Box, action: 'blur' | 'replace' | 'mute', label?: string, reasoning?: string) => void;
    onCancel: () => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ jobId, currentTime, onConfirm, onCancel }) => {
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentBox, setCurrentBox] = useState<Box | null>(null);
    const [isConfirmedBox, setIsConfirmedBox] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<{
        itemName: string;
        reasoning: string;
        actions: ManualAction[];
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const canvasRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isConfirmedBox || isAnalyzing) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setStartPos({ x, y });
        setCurrentBox({ top: y, left: x, width: 0, height: 0 });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!startPos || isConfirmedBox || isAnalyzing) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        const left = Math.min(x, startPos.x);
        const top = Math.min(y, startPos.y);
        const width = Math.abs(x - startPos.x);
        const height = Math.abs(y - startPos.y);

        setCurrentBox({ top, left, width, height });
    };

    const handleMouseUp = async () => {
        if (isConfirmedBox || isAnalyzing || !startPos) return;

        if (currentBox && currentBox.width > 0.5 && currentBox.height > 0.5) {
            setIsConfirmedBox(true);
            setStartPos(null);
            await runAnalysis(currentBox);
        } else {
            reset();
        }
    };

    const runAnalysis = async (box: Box) => {
        setIsAnalyzing(true);
        setError(null);
        try {
            const result = await analyzeManual(jobId, currentTime, box);
            setAnalysisResult({
                itemName: result.item_name,
                reasoning: result.reasoning,
                actions: result.suggested_actions
            });
        } catch (err) {
            console.error('Analysis failed:', err);
            setError('Failed to analyze region');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAction = (action: 'blur' | 'replace' | 'mute', label?: string) => {
        if (currentBox) {
            onConfirm(currentBox, action, label || analysisResult?.itemName, analysisResult?.reasoning);
            reset();
        }
    };

    const reset = () => {
        setStartPos(null);
        setCurrentBox(null);
        setIsConfirmedBox(false);
        setAnalysisResult(null);
        setError(null);
    };

    return (
        <div
            ref={canvasRef}
            className="absolute inset-0 z-[100] cursor-crosshair bg-black/10 backdrop-blur-[0.5px]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
        >
            <div className="absolute top-4 left-4 px-3 py-1.5 bg-background/80 backdrop-blur border border-border rounded-lg flex items-center gap-2 pointer-events-none animate-in fade-in slide-in-from-top-2">
                <MousePointer2 className="w-3.5 h-3.5 text-accent" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Drag to draw remediation zone</span>
            </div>

            {currentBox && (
                <div
                    className={cn(
                        "absolute border transition-all duration-300 ease-out",
                        isConfirmedBox
                            ? "border-accent bg-accent/5 shadow-[0_0_30px_rgba(59,130,246,0.4)]"
                            : "border-accent/50 bg-accent/5 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                    )}
                    style={{
                        top: `${currentBox.top}%`,
                        left: `${currentBox.left}%`,
                        width: `${currentBox.width}%`,
                        height: `${currentBox.height}%`
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                >
                    {/* Corner Handles */}
                    {isConfirmedBox && (
                        <>
                            <div className="absolute -top-[1px] -left-[1px] w-2 h-2 border-t-2 border-l-2 border-accent" />
                            <div className="absolute -top-[1px] -right-[1px] w-2 h-2 border-t-2 border-r-2 border-accent" />
                            <div className="absolute -bottom-[1px] -left-[1px] w-2 h-2 border-b-2 border-l-2 border-accent" />
                            <div className="absolute -bottom-[1px] -right-[1px] w-2 h-2 border-b-2 border-r-2 border-accent" />
                        </>
                    )}

                    {/* Analysis Label */}
                    {isConfirmedBox && (
                        <div className="absolute -top-10 left-0 flex items-center gap-2 whitespace-nowrap">
                            <div className={cn(
                                "px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-xl",
                                isAnalyzing ? "bg-accent text-white animate-pulse" : "bg-white text-black"
                            )}>
                                {isAnalyzing ? (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Analyzing with Gemini...
                                    </>
                                ) : analysisResult ? (
                                    <>
                                        <Sparkles className="w-3 h-3 text-accent" />
                                        Detected: {analysisResult.itemName}
                                    </>
                                ) : error ? (
                                    <>
                                        <AlertCircle className="w-3 h-3 text-red-500" />
                                        {error}
                                    </>
                                ) : (
                                    "Region Selected"
                                )}
                            </div>
                        </div>
                    )}

                    {/* Action Menu - Enhanced for AI suggestions */}
                    {isConfirmedBox && !isAnalyzing && (
                        <div
                            className={cn(
                                "absolute left-1/2 -translate-x-1/2 min-w-[320px] bg-background border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 pointer-events-auto overflow-hidden z-[500]",
                                currentBox.top > 50 ? "bottom-[calc(100%+12px)]" : "top-[calc(100%+12px)]"
                            )}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                        >
                            {analysisResult && (
                                <div className="p-3 bg-muted/20 border-b border-border">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">AI Recommendation</p>
                                    <p className="text-[11px] leading-relaxed italic opacity-80">"{analysisResult.reasoning}"</p>
                                </div>
                            )}

                            <div className="p-1 space-y-1">
                                {analysisResult?.actions.map((action) => (
                                    <button
                                        key={action.id}
                                        onClick={() => handleAction(action.type as any, action.label)}
                                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-accent/10 transition-all border border-transparent hover:border-accent/30 group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                                                {action.type === 'blur' && <Droplets className="w-4 h-4" />}
                                                {action.type === 'replace' && <ShieldAlert className="w-4 h-4 text-emerald-500" />}
                                                {action.type === 'mute' && <VolumeX className="w-4 h-4 text-red-500" />}
                                            </div>
                                            <div className="flex flex-col items-start">
                                                <span className="text-xs font-bold text-foreground">{action.label}</span>
                                                <span className="text-[10px] text-muted-foreground">{action.description}</span>
                                            </div>
                                        </div>
                                        <Wand2 className="w-4 h-4 text-accent/0 group-hover:text-accent/50 transition-all" />
                                    </button>
                                ))}

                                {/* Standard fallback actions if no AI results */}
                                {!analysisResult && !error && (
                                    <>
                                        <button onClick={() => handleAction('blur')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/50 transition-all text-sm font-medium">
                                            <Droplets className="w-4 h-4 text-accent" /> Blur
                                        </button>
                                        <button onClick={() => handleAction('replace')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/50 transition-all text-sm font-medium">
                                            <ShieldAlert className="w-4 h-4 text-emerald-500" /> Replace
                                        </button>
                                        <button onClick={() => handleAction('mute')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/50 transition-all text-sm font-medium">
                                            <VolumeX className="w-4 h-4 text-red-500" /> Mute
                                        </button>
                                    </>
                                )}
                            </div>

                            <div className="p-2 border-t border-border flex justify-end">
                                <button
                                    onClick={reset}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
                                >
                                    <X className="w-3.5 h-3.5" /> Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <button
                onClick={onCancel}
                className="absolute top-4 right-4 px-4 py-2 bg-background/80 backdrop-blur border border-border rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-background transition-colors shadow-lg"
            >
                Exit Edit Mode
            </button>
        </div>
    );
};

export default DrawingCanvas;
