import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2, VolumeX, PencilLine, Eye, EyeOff } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import TimelineEditor from './TimelineEditor';
import DrawingCanvas from './DrawingCanvas';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export interface Finding {
    id: number;
    type: string;
    category: 'alcohol' | 'logo' | 'violence' | 'language' | 'other';
    content: string;
    status: 'warning' | 'critical';
    confidence: 'Low' | 'Medium' | 'High';
    startTime: number; // in seconds
    endTime: number; // in seconds
    context?: string; // reasoning from Gemini
    suggestedAction?: string; // recommended fix from Gemini
    box?: {
        top: number;   // percentage
        left: number;  // percentage
        width: number; // percentage
        height: number; // percentage
    };
}

interface VideoWorkspaceProps {
    videoUrl?: string;
    jobId?: string; // Added jobId for ActionModal
    seekTo?: number;
    findings?: Finding[];

    onTimeUpdate?: (time: number) => void;
    onAddFinding?: (finding: Omit<Finding, 'id'>) => void;
}

const VideoWorkspace: React.FC<VideoWorkspaceProps> = ({ videoUrl, jobId, seekTo, findings = [], onTimeUpdate, onAddFinding }) => {
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
    const [isEditMode, setIsEditMode] = useState(false);
    const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
    const [showOverlays, setShowOverlays] = useState(true);
    const controlsTimeoutRef = useRef<any>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);



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

        if (videoUrl) {
            video.load();
            video.volume = volume;
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    if (err.name !== 'AbortError') {
                        console.log('Auto-play blocked:', err);
                    }
                });
            }
        }

        // Initialize ResizeObserver for the video element
        const updateDimensions = () => {
            if (video) {
                setVideoDimensions({
                    width: video.clientWidth,
                    height: video.clientHeight
                });
            }
        };

        resizeObserverRef.current = new ResizeObserver(updateDimensions);
        resizeObserverRef.current.observe(video);
        updateDimensions();

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            resizeObserverRef.current?.disconnect();
        };
    }, [videoUrl]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
                    toggleFullscreen();
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
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
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
            if (document.fullscreenElement) document.exitFullscreen();
            else containerRef.current.requestFullscreen();
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const handleManualEditConfirm = (box: any, action: 'blur' | 'replace' | 'replace-pika' | 'mute', label?: string, reasoning?: string) => {
        if (!onAddFinding) return;

        const type = action === 'blur' ? 'Manual Blur'
            : action === 'replace' ? 'Manual Replace (VACE)'
                : action === 'replace-pika' ? 'Manual Replace (Pika)'
                    : 'Manual Mute';
        const category = action === 'blur' || action === 'replace' || action === 'replace-pika' ? 'logo' : 'language';
        const content = label || `User defined ${action} area`;

        onAddFinding({
            type,
            category,
            content,
            status: 'warning',
            confidence: 'High',
            startTime: currentTime,
            endTime: Math.min(currentTime + 5, duration),
            suggestedAction: label || action.charAt(0).toUpperCase() + action.slice(1),
            context: reasoning,
            box
        });

        setIsEditMode(false);
    };


    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex flex-col h-full gap-4" onMouseMove={resetControlsTimer}>
            <div
                ref={containerRef}
                className="flex-1 relative rounded-xl border border-border bg-black overflow-hidden group shadow-2xl"
            >
                <div
                    className="w-full h-full flex items-center justify-center bg-black"
                    style={{ position: 'relative' }}
                >
                    <video
                        ref={videoRef}
                        key={videoUrl}
                        src={videoUrl}
                        className="max-w-full max-h-full object-contain cursor-pointer"
                        poster={!videoUrl ? "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&q=80&w=1200" : undefined}
                        onClick={togglePlay}
                        onDoubleClick={toggleFullscreen}
                        playsInline
                        muted={isMuted}
                        autoPlay
                    />

                    {isEditMode && !isPlaying && (
                        <div className="absolute inset-0 pointer-events-auto">
                            <DrawingCanvas
                                jobId={jobId || "temp-job"}
                                currentTime={currentTime}
                                onConfirm={handleManualEditConfirm}
                                onCancel={() => setIsEditMode(false)}
                            />
                        </div>
                    )}

                    {/* Overlay Container - now properly constrained to video aspect ratio */}
                    <div
                        id="video-overlay"
                        className="absolute pointer-events-none"
                        style={{
                            width: `${videoDimensions.width}px`,
                            height: `${videoDimensions.height}px`,
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        {/* Bounding box overlays - toggle with Eye button */}
                        {showOverlays && (
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
                        )}
                    </div>
                </div>

                {!isPlaying && videoUrl && !isEditMode && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] pointer-events-none">
                        <button
                            className="w-20 h-20 flex items-center justify-center rounded-full bg-accent text-white shadow-2xl scale-100 hover:scale-110 transition-transform pointer-events-auto cursor-pointer"
                            onClick={togglePlay}
                        >
                            <Play className="fill-current w-8 h-8 ml-1" />
                        </button>
                    </div>
                )}

                <div className={cn(
                    "absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 z-50",
                    showControls ? "opacity-100" : "opacity-0 invisible"
                )}>
                    <div className="flex flex-col gap-3">
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
                                    className="text-white/80 hover:text-white transition-colors cursor-pointer"
                                >
                                    <SkipBack className="w-5 h-5" />
                                </button>
                                <button onClick={togglePlay} className="text-white hover:text-white transition-colors cursor-pointer">
                                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                                </button>
                                <button
                                    onClick={() => videoRef.current && (videoRef.current.currentTime += 5)}
                                    className="text-white/80 hover:text-white transition-colors cursor-pointer"
                                >
                                    <SkipForward className="w-5 h-5" />
                                </button>
                                <div className="text-xs font-mono text-white select-none bg-black/50 px-2 py-1 rounded">
                                    <span className="font-bold">{formatTime(currentTime)}</span> / {formatTime(duration)}
                                </div>

                                <div className="h-4 w-[1px] bg-white/20 mx-1" />

                                <button
                                    onClick={() => {
                                        setIsEditMode(!isEditMode);
                                        if (isPlaying) videoRef.current?.pause();
                                    }}
                                    className={cn(
                                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer",
                                        isEditMode
                                            ? "bg-accent text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                                            : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                                    )}
                                >
                                    <PencilLine className="w-4 h-4" />
                                    {isEditMode ? 'Editing...' : 'Manual Edit'}
                                </button>

                                {/* Toggle overlays button */}
                                <button
                                    onClick={() => setShowOverlays(!showOverlays)}
                                    className={cn(
                                        "p-2 rounded-lg transition-all cursor-pointer",
                                        showOverlays
                                            ? "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                                            : "bg-white/5 text-white/40 hover:bg-white/10"
                                    )}
                                    title={showOverlays ? "Hide overlays" : "Show overlays"}
                                >
                                    {showOverlays ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                </button>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 group/vol">
                                    <button onClick={toggleMute} className="text-white/80 hover:text-white transition-colors cursor-pointer">
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
                                <button onClick={toggleFullscreen} className="text-white/80 hover:text-white transition-colors cursor-pointer">
                                    <Maximize2 className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="h-48 overflow-hidden">
                <TimelineEditor
                    duration={duration}
                    currentTime={currentTime}
                    findings={findings}
                    onSeek={(time) => {
                        if (videoRef.current) videoRef.current.currentTime = time;
                    }}
                />
            </div>
        </div>
    );
};

export default VideoWorkspace;
