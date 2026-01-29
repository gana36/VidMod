import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, Clock, AlertTriangle, MessageSquare, Shield, Beer } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { type Finding } from './VideoWorkspace';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface TimelineEditorProps {
    duration: number;
    currentTime: number;
    findings: Finding[];
    onSeek: (time: number) => void;
}

const TimelineEditor: React.FC<TimelineEditorProps> = ({ duration, currentTime, findings, onSeek }) => {
    const [zoom, setZoom] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

    const timelineWidth = 100 * zoom; // percentage

    const getCategoryColor = (category: string) => {
        switch (category) {
            case 'alcohol': return 'bg-amber-400 border-amber-500';
            case 'logo': return 'bg-blue-400 border-blue-500';
            case 'language': return 'bg-red-400 border-red-500';
            default: return 'bg-slate-400 border-slate-500';
        }
    };

    const handleTimelineClick = (e: React.MouseEvent) => {
        if (!timelineRef.current || !duration) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const seekTime = (x / rect.width) * duration;
        onSeek(Math.max(0, Math.min(seekTime, duration)));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDraggingPlayhead(true);
        handleTimelineClick(e);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingPlayhead && timelineRef.current) {
                const rect = timelineRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const seekTime = (x / rect.width) * duration;
                onSeek(Math.max(0, Math.min(seekTime, duration)));
            }
        };

        const handleMouseUp = () => {
            setIsDraggingPlayhead(false);
        };

        if (isDraggingPlayhead) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingPlayhead, duration, onSeek]);

    // Generate grid lines
    const gridLines = useMemo(() => {
        if (!duration) return [];
        const lines = [];
        const interval = Math.max(1, Math.floor(duration / (10 * zoom)));
        for (let i = 0; i <= duration; i += interval) {
            lines.push(i);
        }
        return lines;
    }, [duration, zoom]);

    return (
        <div className="flex flex-col h-full bg-card/40 border border-border rounded-xl overflow-hidden group/timeline">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/20 border border-border/50">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[10px] font-mono font-semibold tracking-wider">
                            {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <ZoomOut className="w-3.5 h-3.5 text-muted-foreground" />
                        <input
                            type="range"
                            min="1"
                            max="10"
                            step="0.1"
                            value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            className="w-24 h-1 bg-accent/20 rounded-lg appearance-none cursor-pointer accent-accent"
                        />
                        <ZoomIn className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{zoom.toFixed(1)}x Zoom</span>
                </div>
            </div>

            {/* Timeline Scrollable Area */}
            <div
                ref={containerRef}
                className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px]"
            >
                <div
                    ref={timelineRef}
                    className="relative h-full min-w-full cursor-pointer"
                    style={{ width: `${timelineWidth}%`, minHeight: '120px' }}
                    onMouseDown={handleMouseDown}
                >
                    {/* Grid Lines */}
                    <div className="absolute inset-0 pointer-events-none">
                        {gridLines.map(time => (
                            <div
                                key={`grid-${time}`}
                                className="absolute top-0 bottom-0 border-l border-border/20"
                                style={{ left: `${(time / duration) * 100}%` }}
                            >
                                <span className="absolute top-1 left-1 text-[8px] text-muted-foreground/40 font-mono">
                                    {Math.floor(time / 60)}:{Math.floor(time % 60).toString().padStart(2, '0')}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Violation Tracks */}
                    <div className="relative pt-8 px-0 flex flex-col gap-2">
                        {/* Legend-like labels on the left could be added here, but keeping it "thin lines" as requested */}

                        {/* Unified Track with split icons */}
                        <div className="h-12 w-full relative">
                            {findings.map(finding => (
                                <div
                                    key={`marker-${finding.id}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSeek(finding.startTime);
                                    }}
                                    className={cn(
                                        "absolute top-0 h-full border-x-2 transition-all cursor-pointer group/marker",
                                        getCategoryColor(finding.category),
                                        currentTime >= finding.startTime && currentTime <= finding.endTime
                                            ? "opacity-100 shadow-[0_0_15px_rgba(255,255,255,0.2)] scale-y-105"
                                            : "opacity-40 hover:opacity-100"
                                    )}
                                    style={{
                                        left: `${(finding.startTime / duration) * 100}%`,
                                        width: `${((finding.endTime - finding.startTime) / duration) * 100}%`,
                                        minWidth: '4px'
                                    }}
                                >
                                    {/* Tooltip Content (Simple implementation) */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground rounded text-[10px] font-semibold whitespace-nowrap opacity-0 group-hover/marker:opacity-100 pointer-events-none transition-opacity shadow-xl border border-border">
                                        {finding.type}: {finding.content} ({finding.confidence})
                                    </div>

                                    {/* Category Icon */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
                                        {finding.category === 'alcohol' && <Beer className="w-3 h-3 text-black/40" />}
                                        {finding.category === 'logo' && <Shield className="w-3 h-3 text-black/40" />}
                                        {finding.category === 'language' && <MessageSquare className="w-3 h-3 text-black/40" />}
                                        {finding.category === 'violence' && <AlertTriangle className="w-3 h-3 text-black/40" />}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Playhead */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                        style={{ left: `${(currentTime / duration) * 100}%` }}
                    >
                        <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white shadow-lg" />
                        <div className="absolute top-0 bottom-0 left-[-10px] right-[-10px] pointer-events-auto cursor-ew-resize" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimelineEditor;
