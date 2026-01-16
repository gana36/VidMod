import React, { useState, useRef } from 'react';
import { Droplets, ShieldAlert, VolumeX, X, MousePointer2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
    onConfirm: (box: Box, action: 'blur' | 'replace' | 'mute') => void;
    onCancel: () => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ onConfirm, onCancel }) => {
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentBox, setCurrentBox] = useState<Box | null>(null);
    const [isConfirmedBox, setIsConfirmedBox] = useState(false);
    const canvasRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isConfirmedBox) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setStartPos({ x, y });
        setCurrentBox({ top: y, left: x, width: 0, height: 0 });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!startPos || isConfirmedBox) return;
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

    const handleMouseUp = () => {
        if (currentBox && currentBox.width > 1 && currentBox.height > 1) {
            setIsConfirmedBox(true);
        } else {
            setStartPos(null);
            setCurrentBox(null);
        }
    };

    const handleAction = (action: 'blur' | 'replace' | 'mute') => {
        if (currentBox) {
            onConfirm(currentBox, action);
            reset();
        }
    };

    const reset = () => {
        setStartPos(null);
        setCurrentBox(null);
        setIsConfirmedBox(false);
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
                        "absolute border transition-all duration-200",
                        isConfirmedBox
                            ? "border-accent bg-accent/10 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                            : "border-accent/50 bg-accent/5 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                    )}
                    style={{
                        top: `${currentBox.top}%`,
                        left: `${currentBox.left}%`,
                        width: `${currentBox.width}%`,
                        height: `${currentBox.height}%`
                    }}
                >
                    {/* Corner Handles - Professional Thin Style */}
                    {isConfirmedBox && (
                        <>
                            <div className="absolute -top-[1px] -left-[1px] w-2 h-2 border-t-2 border-l-2 border-accent pointer-events-none" />
                            <div className="absolute -top-[1px] -right-[1px] w-2 h-2 border-t-2 border-r-2 border-accent pointer-events-none" />
                            <div className="absolute -bottom-[1px] -left-[1px] w-2 h-2 border-b-2 border-l-2 border-accent pointer-events-none" />
                            <div className="absolute -bottom-[1px] -right-[1px] w-2 h-2 border-b-2 border-r-2 border-accent pointer-events-none" />
                        </>
                    )}

                    {/* Action Menu */}
                    {isConfirmedBox && (
                        <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-background border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in-95 pointer-events-auto">
                            <button
                                onClick={() => handleAction('blur')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
                            >
                                <Droplets className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground">Blur</span>
                            </button>
                            <div className="w-[1px] h-4 bg-border mx-1" />
                            <button
                                onClick={() => handleAction('replace')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
                            >
                                <ShieldAlert className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground">Replace</span>
                            </button>
                            <div className="w-[1px] h-4 bg-border mx-1" />
                            <button
                                onClick={() => handleAction('mute')}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
                            >
                                <VolumeX className="w-4 h-4 text-red-500 group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground">Mute</span>
                            </button>
                            <div className="w-[1px] h-4 bg-border mx-1" />
                            <button
                                onClick={reset}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
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
