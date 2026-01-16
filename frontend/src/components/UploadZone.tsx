import React, { useState, useRef } from 'react';
import { Upload as UploadIcon, X, CheckCircle2, Loader2, Play } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface UploadZoneProps {
    onUploadComplete: (metadata: VideoMetadata) => void;
    onFileSelected: (metadata: VideoMetadata) => void;
}

export interface VideoMetadata {
    name: string;
    size: string;
    duration: string;
    resolution: string;
    url: string;
    file: File;
    jobId?: string;  // Added for backend upload
}

const UploadZone: React.FC<UploadZoneProps> = ({ onUploadComplete, onFileSelected }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'ready'>('idle');
    const [progress, setProgress] = useState(0);
    const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && droppedFile.type.startsWith('video/')) {
            handleFileSelection(droppedFile);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            handleFileSelection(selectedFile);
        }
    };

    const handleFileSelection = async (selectedFile: File) => {
        const url = URL.createObjectURL(selectedFile);
        setVideoUrl(url);
        setStatus('uploading');
        setProgress(0);

        try {
            // 1. Start metadata extraction in parallel
            const metadataPromise = new Promise<VideoMetadata>((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    resolve({
                        name: selectedFile.name,
                        size: (selectedFile.size / (1024 * 1024)).toFixed(2) + ' MB',
                        duration: `${Math.floor(video.duration)}s`,
                        resolution: `${video.videoWidth}x${video.videoHeight}`,
                        url: url,
                        file: selectedFile
                    });
                };
                video.src = url;
            });

            // 2. Start upload
            const jobIdPromise = uploadToBackend(selectedFile);

            // 3. Wait for both
            const [baseMetadata, jobId] = await Promise.all([metadataPromise, jobIdPromise]);

            if (jobId) {
                const finalMetadata = { ...baseMetadata, jobId };
                setMetadata(finalMetadata);
                onFileSelected(finalMetadata);
                setStatus('ready');
                setProgress(100);
            } else {
                setStatus('idle');
            }

        } catch (error) {
            console.error('File selection failed:', error);
            setStatus('idle');
        }
    };

    const uploadToBackend = async (file: File) => {
        setProgress(10);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('http://localhost:8000/api/upload', {
                method: 'POST',
                body: formData,
            });

            setProgress(50);
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);

            const data = await response.json();
            return data.job_id;
        } catch (error) {
            console.error('Upload failed:', error);
            return null;
        }
    };


    const reset = () => {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
        setStatus('idle');
        setProgress(0);
        setMetadata(null);
    };

    return (
        <div className="h-full flex flex-col items-center justify-center p-8 bg-background">
            <div className="w-full max-w-2xl">
                <div className="mb-8 text-center animate-in fade-in slide-in-from-top-4 duration-700">
                    <h1 className="text-3xl font-bold mb-2 tracking-tight">Upload Video for Analysis</h1>
                    <p className="text-muted-foreground">Zenith Sensor automatically detects compliance violations locally.</p>
                </div>

                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                        "relative rounded-3xl border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-12 min-h-[450px] bg-card/20 backdrop-blur-sm",
                        isDragging ? "border-accent bg-accent/10 scale-[1.02] shadow-[0_0_40px_rgba(59,130,246,0.1)]" : "border-border hover:border-accent/40 hover:bg-card/40",
                        status !== 'idle' && "border-solid border-border-muted"
                    )}
                >
                    {status === 'idle' && (
                        <>
                            <div className="w-24 h-24 rounded-full bg-accent/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-all duration-500 shadow-inner">
                                <UploadIcon className="w-10 h-10 text-accent" />
                            </div>
                            <div className="text-center space-y-6">
                                <div className="space-y-2">
                                    <p className="text-xl font-semibold text-foreground">Drag and drop video files to upload</p>
                                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">Upload content to detect brands, restricted objects, and offensive language.</p>
                                </div>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-8 py-3 bg-accent text-white rounded-xl font-bold shadow-xl shadow-accent/25 hover:opacity-90 hover:translate-y-[-2px] transition-all active:scale-95"
                                >
                                    Select File
                                </button>
                                <div className="flex gap-4 justify-center items-center mt-12">
                                    <span className="text-[10px] bg-muted/30 px-3 py-1 rounded-full font-bold text-muted-foreground tracking-widest uppercase">Max 120s</span>
                                    <span className="text-[10px] bg-muted/30 px-3 py-1 rounded-full font-bold text-muted-foreground tracking-widest uppercase">MP4 / MOV</span>
                                </div>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="video/*"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </>
                    )}

                    {status !== 'idle' && (
                        <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <div className="flex items-center gap-6 p-6 rounded-2xl bg-background/40 border border-border/50 backdrop-blur-md shadow-2xl overflow-hidden">
                                <div className="w-32 h-20 rounded-xl bg-black flex items-center justify-center flex-shrink-0 shadow-lg shadow-accent/20 overflow-hidden relative">
                                    {videoUrl && (
                                        <video
                                            src={videoUrl}
                                            className="w-full h-full object-cover"
                                            autoPlay
                                            muted
                                            loop
                                            playsInline
                                        />
                                    )}
                                    <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="font-bold truncate pr-4 text-xl tracking-tight">{metadata?.name}</h3>
                                        <button onClick={reset} className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-full transition-all pointer-events-auto">
                                            <X className="w-6 h-6" />
                                        </button>
                                    </div>
                                    <div className="flex gap-4 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-80">
                                        <span className="bg-muted/20 px-2 py-0.5 rounded">{metadata?.size}</span>
                                        <span className="bg-muted/20 px-2 py-0.5 rounded">{metadata?.duration}</span>
                                        <span className="bg-muted/20 px-2 py-0.5 rounded">{metadata?.resolution}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-8 px-2">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end text-xs">
                                        <span className="font-black uppercase tracking-widest flex items-center gap-3">
                                            {status === 'uploading' ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                                    <span className="animate-pulse">Uploading...</span>
                                                </>
                                            ) : status === 'processing' ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                                                    <span className="animate-pulse">Analyzing...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                    <span className="text-emerald-500">Video Verified</span>
                                                </>
                                            )}
                                        </span>
                                        <span className="text-accent font-black font-mono text-base">{Math.floor(progress)}%</span>
                                    </div>
                                    <div className="h-2 w-full bg-muted/30 rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full transition-all duration-300 ease-out shadow-[0_0_15px_rgba(59,130,246,0.3)]",
                                                status === 'ready' ? "bg-emerald-500" : "bg-accent"
                                            )}
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>

                                {status === 'ready' && (
                                    <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-8 duration-700">
                                        <button
                                            onClick={() => metadata && onUploadComplete(metadata)}
                                            disabled={!metadata}
                                            className={cn(
                                                "w-full py-5 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-2xl transition-all",
                                                metadata
                                                    ? "bg-accent shadow-accent/40 hover:translate-y-[-2px] hover:shadow-accent/50 active:scale-[0.98]"
                                                    : "bg-muted cursor-not-allowed opacity-50"
                                            )}
                                        >
                                            <Play className="w-6 h-6 fill-current" />
                                            {metadata ? "Run Compliance Analysis" : "Processing Video..."}
                                        </button>
                                        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground font-black uppercase tracking-[0.3em]">
                                            Local AI Engine Ready
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UploadZone;
