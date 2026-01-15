import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2, FileVideo, VolumeX } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { VideoMetadata } from './UploadZone';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
export interface Finding {
    id: number;
    type: 'Brand Logo' | 'Restricted Object' | 'Offensive Language';
    content: string;
    status: 'warning' | 'critical';
    startTime: number; // in seconds
    endTime: number; // in seconds
    box?: {
        top: number;   // percentage
        left: number;  // percentage
        width: number; // percentage
        height: number; // percentage
    };
}

interface VideoWorkspaceProps {
    videoUrl?: string;
    metadata?: VideoMetadata;
    seekTo?: number;
    findings?: Finding[];
    onTimeUpdate?: (time: number) => void;
}

const VideoWorkspace: React.FC<VideoWorkspaceProps> = ({ videoUrl, metadata, seekTo, findings = [], onTimeUpdate }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isDraggingScrubber, setIsDraggingScrubber] = useState(false);
    const [isDraggingVolume, setIsDraggingVolume] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<any>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            onTimeUpdate?.(video.currentTime);
        };
        const handleDurationChange = () => setDuration(video.duration);

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);

        // Auto-play when video is loaded
        if (videoUrl) {
            video.load(); // Explicitly load new source
            video.volume = volume;
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.log('Auto-play blocked, waiting for interaction:', err);
                });
            }
        }

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
        };
    }, [videoUrl]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only trigger if not typing in an input
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowLeft':
                    if (videoRef.current) videoRef.current.currentTime -= 5;
                    break;
                case 'ArrowRight':
                    if (videoRef.current) videoRef.current.currentTime += 5;
                    break;
                case 'KeyM':
                    toggleMute();
                    break;
                case 'KeyF':
                    if (videoRef.current) {
                        if (document.fullscreenElement) document.exitFullscreen();
                        else videoRef.current.parentElement?.requestFullscreen();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPlaying, isMuted, volume]);

    useEffect(() => {
        if (seekTo !== undefined && videoRef.current) {
            videoRef.current.currentTime = seekTo;
            if (!isPlaying) videoRef.current.play();
        }
    }, [seekTo]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const handleScrub = (clientX: number, target: HTMLElement) => {
        if (videoRef.current && duration > 0) {
            const rect = target.getBoundingClientRect();
            const x = clientX - rect.left;
            const percentage = Math.min(Math.max(x / rect.width, 0), 1);
            videoRef.current.currentTime = percentage * duration;
        }
    };

    const handleVolumeChange = (clientX: number, target: HTMLElement) => {
        if (videoRef.current) {
            const rect = target.getBoundingClientRect();
            const x = clientX - rect.left;
            const newVolume = Math.min(Math.max(x / rect.width, 0), 1);
            videoRef.current.volume = newVolume;
            setVolume(newVolume);
            setIsMuted(newVolume === 0);
        }
    };

    // Global drag listeners
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingScrubber) {
                const scrubber = document.getElementById('main-scrubber');
                if (scrubber) handleScrub(e.clientX, scrubber);
            }
            if (isDraggingVolume) {
                const volumeBar = document.getElementById('volume-bar');
                if (volumeBar) handleVolumeChange(e.clientX, volumeBar);
            }
        };

        const handleMouseUp = () => {
            setIsDraggingScrubber(false);
            setIsDraggingVolume(false);
        };

        if (isDraggingScrubber || isDraggingVolume) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingScrubber, isDraggingVolume, duration]);

    // Auto-hide controls
    const resetControlsTimer = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const newMute = !isMuted;
            videoRef.current.muted = newMute;
            setIsMuted(newMute);
        }
    };

    const toggleFullscreen = () => {
        if (containerRef.current) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                containerRef.current.requestFullscreen();
            }
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex flex-col h-full gap-4" onMouseMove={resetControlsTimer}>
            {/* Video Container */}
            <div
                ref={containerRef}
                className="flex-1 relative rounded-xl border border-border bg-black overflow-hidden group shadow-2xl"
            >
                <video
                    ref={videoRef}
                    key={videoUrl}
                    src={videoUrl}
                    className="w-full h-full object-contain cursor-pointer"
                    poster={!videoUrl ? "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&q=80&w=1200" : undefined}
                    onClick={togglePlay}
                    onDoubleClick={toggleFullscreen}
                    playsInline
                    muted={isMuted}
                    autoPlay
                    data-testid="main-video-player"
                />

                {/* Detection Overlay Layer */}
                <div className="absolute inset-0 pointer-events-none">
                    {findings.map(finding => {
                        const isActive = currentTime >= finding.startTime && currentTime <= finding.endTime;
                        if (!isActive || !finding.box) return null;

                        return (
                            <div
                                key={finding.id}
                                className={cn(
                                    "absolute border-2 rounded transition-opacity duration-200",
                                    finding.status === 'critical' ? "border-red-500 bg-red-500/10" : "border-amber-500 bg-amber-500/10"
                                )}
                                style={{
                                    top: `${finding.box.top}%`,
                                    left: `${finding.box.left}%`,
                                    width: `${finding.box.width}%`,
                                    height: `${finding.box.height}%`
                                }}
                            >
                                <div className={cn(
                                    "absolute -top-6 left-0 px-2 py-0.5 rounded text-[10px] font-bold text-white whitespace-nowrap uppercase tracking-wider shadow-lg",
                                    finding.status === 'critical' ? "bg-red-500" : "bg-amber-500"
                                )}>
                                    {finding.type}: {finding.content}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Play Overlay */}
                {!isPlaying && videoUrl && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] pointer-events-none">
                        <button
                            className="w-20 h-20 flex items-center justify-center rounded-full bg-accent text-white shadow-2xl scale-100 hover:scale-110 transition-transform pointer-events-auto"
                            onClick={togglePlay}
                        >
                            <Play className="fill-current w-8 h-8 ml-1" />
                        </button>
                    </div>
                )}

                {/* Floating Controls Bar */}
                <div className={cn(
                    "absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 z-50",
                    showControls ? "opacity-100" : "opacity-0 invisible"
                )}>
                    <div className="flex flex-col gap-3">
                        {/* Scrubber */}
                        <div
                            id="main-scrubber"
                            className="relative h-1.5 w-full bg-white/20 rounded-full cursor-pointer group/scrub"
                            onMouseDown={(e) => {
                                setIsDraggingScrubber(true);
                                handleScrub(e.clientX, e.currentTarget);
                            }}
                        >
                            <div
                                className="absolute top-0 left-0 h-full bg-accent rounded-full flex items-center justify-end"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="w-3.5 h-3.5 bg-white rounded-full shadow-lg scale-100 transition-transform -mr-1.5 border-2 border-accent" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => videoRef.current && (videoRef.current.currentTime -= 5)}
                                    className="text-white/80 hover:text-white transition-colors"
                                >
                                    <SkipBack className="w-5 h-5" />
                                </button>
                                <button onClick={togglePlay} className="text-white hover:text-white transition-colors">
                                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                                </button>
                                <button
                                    onClick={() => videoRef.current && (videoRef.current.currentTime += 5)}
                                    className="text-white/80 hover:text-white transition-colors"
                                >
                                    <SkipForward className="w-5 h-5" />
                                </button>
                                <div className="text-xs font-mono text-white select-none bg-black/50 px-2 py-1 rounded">
                                    <span className="font-bold">{formatTime(currentTime)}</span> / {formatTime(duration)}
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 group/vol">
                                    <button onClick={toggleMute} className="text-white/80 hover:text-white transition-colors">
                                        {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                    </button>
                                    <div
                                        id="volume-bar"
                                        className="w-20 h-1 bg-white/20 rounded-full cursor-pointer relative overflow-hidden"
                                        onMouseDown={(e) => {
                                            setIsDraggingVolume(true);
                                            handleVolumeChange(e.clientX, e.currentTarget);
                                        }}
                                    >
                                        <div className="absolute top-0 left-0 h-full bg-white" style={{ width: `${isMuted ? 0 : volume * 100}%` }} />
                                    </div>
                                </div>
                                <button
                                    onClick={toggleFullscreen}
                                    className="text-white/80 hover:text-white transition-colors"
                                >
                                    <Maximize2 className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Metadata & Timeline Area */}
            <div className="h-48 flex gap-4 overflow-hidden">
                {/* Simple Info Panel */}
                {metadata && (
                    <div className="w-64 border border-border bg-card/40 rounded-xl p-4 flex flex-col gap-3">
                        <div className="flex items-center gap-2 pb-2 border-b border-border">
                            <FileVideo className="w-4 h-4 text-accent" />
                            <span className="text-xs font-bold uppercase tracking-wider">Properties</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground">
                                <span>Resolution</span>
                                <span className="text-foreground">{metadata.resolution}</span>
                            </div>
                            <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground">
                                <span>Duration</span>
                                <span className="text-foreground">{formatTime(duration)}</span>
                            </div>
                            <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground">
                                <span>Size</span>
                                <span className="text-foreground">{metadata.size}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Master Timeline */}
                <div className="flex-1 border border-border bg-card/40 rounded-xl p-4 overflow-hidden relative group/timeline">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Master Timeline</span>
                        <div className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-2 py-0.5 rounded">FPS: 60</div>
                    </div>

                    <div
                        id="master-timeline"
                        className="mt-4 flex flex-col gap-2 relative bg-black/20 rounded-lg p-2 h-24 overflow-hidden cursor-crosshair"
                        onMouseDown={(e) => {
                            setIsDraggingScrubber(true);
                            handleScrub(e.clientX, e.currentTarget);
                        }}
                    >
                        {/* Finding Tracks */}
                        {findings.length > 0 ? (
                            <>
                                <div className="h-6 w-full bg-red-500/5 border border-red-500/10 rounded relative overflow-hidden">
                                    {findings.filter(f => f.status === 'critical').map(f => (
                                        <div
                                            key={`track-crit-${f.id}`}
                                            className="absolute h-full bg-red-500/30 border-x border-red-500/50"
                                            style={{
                                                left: `${(f.startTime / (duration || 1)) * 100}%`,
                                                width: `${((f.endTime - f.startTime) / (duration || 1)) * 100}%`
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="h-6 w-full bg-amber-500/5 border border-amber-500/10 rounded relative overflow-hidden">
                                    {findings.filter(f => f.status === 'warning').map(f => (
                                        <div
                                            key={`track-warn-${f.id}`}
                                            className="absolute h-full bg-amber-500/30 border-x border-amber-500/50"
                                            style={{
                                                left: `${(f.startTime / (duration || 1)) * 100}%`,
                                                width: `${((f.endTime - f.startTime) / (duration || 1)) * 100}%`
                                            }}
                                        />
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground uppercase tracking-widest bg-muted/5 rounded">
                                No Violations Detected
                            </div>
                        )}

                        {/* Finding Markers */}
                        {findings.map(finding => {
                            const markerPos = (finding.startTime / duration) * 100;
                            return (
                                <div
                                    key={`marker-${finding.id}`}
                                    className={cn(
                                        "absolute top-0 bottom-0 w-1 opacity-60 group-hover/timeline:opacity-100 transition-opacity",
                                        finding.status === 'critical' ? "bg-red-500" : "bg-amber-500"
                                    )}
                                    style={{ left: `${markerPos}%` }}
                                    title={`${finding.type}: ${finding.content}`}
                                />
                            );
                        })}

                        {/* Playhead in Timeline */}
                        <div
                            className="absolute top-0 bottom-0 w-[2px] bg-accent z-10 pointer-events-none transition-all duration-100 shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                            style={{ left: `${progress}%` }}
                        >
                            <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-accent rotate-45" />
                        </div>
                    </div>

                    {/* Time Rulers Mock */}
                    <div className="mt-2 flex justify-between text-[9px] font-mono text-muted-foreground select-none px-2">
                        <span>00:00</span>
                        <span>{formatTime(duration * 0.25)}</span>
                        <span>{formatTime(duration * 0.5)}</span>
                        <span>{formatTime(duration * 0.75)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoWorkspace;
