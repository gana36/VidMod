import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Droplets, ShieldAlert, VolumeX, X, MousePointer2, Wand2, Loader2, AlertCircle } from 'lucide-react';
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
    onConfirm: (box: Box, action: 'blur' | 'replace' | 'replace-runway' | 'mute', label?: string, reasoning?: string) => void;
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
    const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null);

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

            // Set menu position relative to the viewport
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect && currentBox) {
                const boxX = rect.left + (currentBox.left + currentBox.width / 2) * rect.width / 100;
                const boxBottom = rect.top + (currentBox.top + currentBox.height) * rect.height / 100;
                const boxTop = rect.top + (currentBox.top) * rect.height / 100;

                setMenuPos({
                    x: boxX,
                    y: (currentBox.top > 50) ? boxTop - 12 : boxBottom + 12
                });
            }

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

    const handleAction = (action: 'blur' | 'replace' | 'replace-runway' | 'mute', label?: string) => {
        // Streamline replacement flow: default to Runway Gen-3
        const finalAction = action === 'replace' ? 'replace-runway' : action;

        if (currentBox) {
            onConfirm(currentBox, finalAction, label || analysisResult?.itemName, analysisResult?.reasoning);
            reset();
        }
    };

    const reset = () => {
        setStartPos(null);
        setCurrentBox(null);
        setIsConfirmedBox(false);
        setAnalysisResult(null);
        setError(null);
        setMenuPos(null);
    };

    return (
        <div
            ref={canvasRef}
            className="absolute inset-0 z-[100] cursor-crosshair bg-black/20 backdrop-blur-[1px]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
        >
            {!isConfirmedBox && (
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-zinc-900/90 backdrop-blur border border-white/10 rounded-lg flex items-center gap-2 pointer-events-none animate-in fade-in slide-in-from-top-2 shadow-2xl">
                    <MousePointer2 className="w-3.5 h-3.5 text-white/60" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">Drag to draw remediation zone</span>
                </div>
            )}

            {currentBox && (
                <div
                    className={cn(
                        "absolute border-2 transition-all duration-300 ease-out",
                        isConfirmedBox
                            ? "border-white bg-white/5 shadow-[0_0_40px_rgba(255,255,255,0.2)]"
                            : "border-white/40 bg-white/5 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
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
                            <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                            <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                        </>
                    )}
                </div>
            )}

            {/* Escape Button - Always Visible */}
            <button
                onClick={onCancel}
                className="absolute top-4 right-4 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-white/10 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all shadow-2xl z-[1000] animate-in fade-in slide-in-from-top-2 flex items-center gap-2 cursor-pointer group"
            >
                <X className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
                Exit Edit Mode
            </button>

            {/* PORTALED CONTENT: Action Menu and Status Labels */}
            {isConfirmedBox && menuPos && createPortal(
                <div
                    className="fixed inset-0 pointer-events-none z-[1001]"
                    style={{ isolation: 'isolate' }}
                >
                    {/* Detection Label - Top of the box or bottom if near edge */}
                    <div
                        className="absolute whitespace-nowrap -translate-x-1/2 flex items-center gap-2 pointer-events-auto"
                        style={{
                            left: `${menuPos.x}px`,
                            top: `${(currentBox?.top ?? 0) > 50 ? menuPos.y + 12 : menuPos.y - 50}px`,
                            transformOrigin: 'center'
                        }}
                    >
                        <div className={cn(
                            "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] flex items-center gap-2.5 shadow-[0_16px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.1)]",
                            isAnalyzing ? "bg-white text-black animate-pulse" : "bg-[#09090b] text-white border border-white/10"
                        )}>
                            {isAnalyzing ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Analyzing Scene...
                                </>
                            ) : analysisResult ? (
                                <>
                                    <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                                    Detected: {analysisResult.itemName}
                                </>
                            ) : error ? (
                                <>
                                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                                    {error}
                                </>
                            ) : (
                                "Region Selected"
                            )}
                        </div>
                    </div>

                    {/* Action Menu */}
                    {!isAnalyzing && (
                        <div
                            className={cn(
                                "absolute left-1/2 -translate-x-1/2 min-w-[340px] bg-[#09090b] border border-white/10 rounded-2xl shadow-[0_32px_64px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] animate-in fade-in zoom-in-95 duration-200 pointer-events-auto overflow-hidden",
                                (currentBox?.top ?? 0) > 50 ? "-translate-y-full" : ""
                            )}
                            style={{
                                left: `${menuPos.x}px`,
                                top: `${menuPos.y}px`
                            }}
                        >
                            {analysisResult && (
                                <div className="p-4 bg-white/[0.03] border-b border-white/10">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Wand2 className="w-3 h-3 text-white/40" />
                                        <p className="text-[9px] font-black text-white/40 uppercase tracking-[0.1em]">AI recommendation</p>
                                    </div>
                                    <p className="text-[11px] leading-relaxed text-zinc-300 font-medium">"{analysisResult.reasoning}"</p>
                                </div>
                            )}

                            <div className="p-1.5 space-y-1">
                                {(analysisResult?.actions || []).map((action) => (
                                    <button
                                        key={action.id}
                                        onClick={() => handleAction(action.type as any, action.label)}
                                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-white/5 transition-all group cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3.5">
                                            <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-white/60 group-hover:text-white transition-colors border border-white/5">
                                                {action.type === 'blur' && <Droplets className="w-4.5 h-4.5" />}
                                                {(action.type === 'replace' || action.type.startsWith('replace-')) && <ShieldAlert className="w-4.5 h-4.5" />}
                                                {action.type === 'mute' && <VolumeX className="w-4.5 h-4.5" />}
                                            </div>
                                            <div className="flex flex-col items-start gap-0.5">
                                                <span className="text-xs font-bold text-white tracking-tight">{action.label}</span>
                                                <span className="text-[10px] text-zinc-500 font-medium">{action.description}</span>
                                            </div>
                                        </div>
                                        <Wand2 className="w-4 h-4 text-white/0 group-hover:text-white/20 transition-all scale-75 group-hover:scale-100" />
                                    </button>
                                ))}

                                {/* Standard fallback actions if no AI results */}
                                {(!analysisResult || analysisResult.actions.length === 0) && !error && (
                                    <>
                                        <button onClick={() => handleAction('blur')} className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl hover:bg-white/5 transition-all group cursor-pointer">
                                            <Droplets className="w-4.5 h-4.5 text-white/40 group-hover:text-white" />
                                            <span className="text-xs font-bold text-white">Manual Blur</span>
                                        </button>
                                        <button onClick={() => handleAction('replace')} className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl hover:bg-white/5 transition-all group cursor-pointer">
                                            <ShieldAlert className="w-4.5 h-4.5 text-white/40 group-hover:text-white" />
                                            <span className="text-xs font-bold text-white">Manual Replace</span>
                                        </button>
                                        <button onClick={() => handleAction('mute')} className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl hover:bg-white/5 transition-all group cursor-pointer">
                                            <VolumeX className="w-4.5 h-4.5 text-white/40 group-hover:text-white" />
                                            <span className="text-xs font-bold text-white">Manual Mute</span>
                                        </button>
                                    </>
                                )}
                            </div>

                            <div className="p-2.5 border-t border-white/5 bg-white/[0.01]">
                                <button
                                    onClick={reset}
                                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#a1a1aa] hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5 opacity-50" /> Reject Analysis
                                </button>
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default DrawingCanvas;
