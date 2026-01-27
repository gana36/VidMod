import React, { useState, useRef } from 'react';
import { Upload as UploadIcon, X, Loader2, Check, ChevronDown, Video } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Platform, Region, Rating } from '../services/policyEngine';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface UploadZoneProps {
    platform: string;
    region: string;
    rating: string;
    onPlatformChange: (platform: string) => void;
    onRegionChange: (region: string) => void;
    onRatingChange: (rating: string) => void;
    onUploadComplete: (metadata: VideoMetadata) => void;
    onFileSelected: (metadata: VideoMetadata) => void;
    onBrowseLibrary?: () => void;
}

export interface VideoMetadata {
    name: string;
    size: string;
    duration: string;
    resolution: string;
    url: string;
    file: File;
    jobId?: string;
}

const platforms = Object.values(Platform);
const regions = Object.values(Region);
const ratings = Object.values(Rating);

const UploadZone: React.FC<UploadZoneProps> = ({
    platform,
    region,
    rating,
    onPlatformChange,
    onRegionChange,
    onRatingChange,
    onUploadComplete,
    onFileSelected,
    onBrowseLibrary
}) => {
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
            const metadataPromise = new Promise<VideoMetadata>((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    resolve({
                        name: selectedFile.name,
                        size: (selectedFile.size / (1024 * 1024)).toFixed(2) + ' MB',
                        duration: `${Math.floor(video.duration)} s`,
                        resolution: `${video.videoWidth}x${video.videoHeight} `,
                        url: url,
                        file: selectedFile
                    });
                };
                video.src = url;
            });

            const jobIdPromise = uploadToBackend(selectedFile);
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
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText} `);

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
        <div className="h-full flex flex-col items-center justify-center p-6 bg-background">
            <div className="w-full max-w-4xl">
                <div className="mb-10 text-center animate-in fade-in slide-in-from-top-4 duration-700">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-border bg-secondary/50 mb-4">
                        <Video className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Source Ingestion</span>
                    </div>
                    <h1 className="text-3xl font-bold mb-2 tracking-tight text-foreground uppercase">VidMod</h1>
                    <p className="text-muted-foreground font-medium text-[10px] uppercase tracking-wide max-w-sm mx-auto leading-relaxed opacity-60">Professional media compliance and remediation suite.</p>
                </div>

                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                        "relative rounded-xl border border-border transition-all duration-300 flex flex-col items-center justify-center p-8 min-h-[480px] overflow-hidden bg-secondary/20 shadow-none",
                        isDragging ? "border-primary/40 bg-primary/5" : "hover:border-border/80",
                        status !== 'idle' && "p-6"
                    )}
                >
                    {/* Minimal Overlay Pattern */}
                    <div className="absolute inset-0 opacity-[0.01] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

                    {status === 'idle' && (
                        <>
                            <div
                                className="w-14 h-14 rounded bg-secondary border border-border flex items-center justify-center mb-6 transition-colors group cursor-pointer hover:bg-secondary/80"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <UploadIcon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                            <div className="text-center space-y-8 z-10">
                                <div className="space-y-1">
                                    <p className="text-lg font-semibold text-foreground tracking-tight">Select Media</p>
                                    <p className="text-muted-foreground max-w-[280px] mx-auto text-xs font-medium leading-relaxed opacity-60">Upload video for compliance verification.</p>
                                </div>
                                <div className="flex flex-col gap-4 items-center">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-bold text-[10px] tracking-wider shadow-xl hover:brightness-105 transition-all active:scale-95 uppercase cursor-pointer"
                                    >
                                        BROWSE SOURCE
                                    </button>
                                    {onBrowseLibrary && (
                                        <button
                                            onClick={onBrowseLibrary}
                                            className="text-[10px] font-black text-muted-foreground hover:text-foreground transition-all tracking-[0.2em] uppercase opacity-30 hover:opacity-100 cursor-pointer"
                                        >
                                            Library Search
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-6 justify-center items-center mt-12 opacity-40">
                                    <span className="text-[9px] font-semibold uppercase tracking-wider">MAX 120S</span>
                                    <div className="w-[1px] h-3 bg-border" />
                                    <span className="text-[9px] font-semibold uppercase tracking-wider">MP4 / MOV</span>
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
                        <div className="w-full h-full flex flex-col z-10">
                            {/* Compact Video Info */}
                            <div className="flex items-center gap-6 p-6 rounded-2xl bg-white/[0.02] border border-white/5 backdrop-blur-3xl mb-8 transition-all">
                                <div className="w-32 h-20 rounded-xl bg-black flex items-center justify-center flex-shrink-0 shadow-2xl overflow-hidden border border-white/5 group/preview relative cursor-pointer">
                                    {videoUrl && (
                                        <video src={videoUrl} className="w-full h-full object-cover opacity-60 group-hover/preview:opacity-100 transition-opacity" autoPlay muted loop playsInline />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="font-black truncate pr-4 text-lg tracking-tight text-foreground/80">{metadata?.name}</h3>
                                        <button onClick={reset} className="p-2 hover:bg-white/10 text-muted-foreground hover:text-foreground rounded-lg transition-all cursor-pointer">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex gap-3 text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-40">
                                        <span>{metadata?.size}</span>
                                        <span>{metadata?.duration}</span>
                                        <span>{metadata?.resolution}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Main Configuration Section */}
                            <div className="flex-1 flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {status === 'uploading' || status === 'processing' ? (
                                    <div className="flex-1 flex flex-col justify-center gap-6">
                                        <div className="flex justify-between items-end mb-2">
                                            <div className="flex items-center gap-3">
                                                <Loader2 className="w-4 h-4 animate-spin text-foreground opacity-30" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-50">
                                                    {status === 'uploading' ? 'Ingesting...' : 'Analyzing...'}
                                                </span>
                                            </div>
                                            <span className="text-xs font-black font-mono text-foreground opacity-50">{Math.floor(progress)}%</span>
                                        </div>
                                        <div className="h-0.5 w-full bg-secondary rounded-full overflow-hidden">
                                            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}% ` }} />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {[
                                                { label: 'Platform', value: platform, options: platforms, onChange: onPlatformChange },
                                                { label: 'Rating', value: rating, options: ratings, onChange: onRatingChange },
                                                { label: 'Region', value: region, options: regions, onChange: onRegionChange }
                                            ].map((sel, idx) => (
                                                <div key={idx} className="space-y-3">
                                                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-30 ml-1">{sel.label}</label>
                                                    <div className="relative group/sel">
                                                        <div className="w-full flex items-center justify-between px-3 py-2 rounded border border-border bg-secondary hover:border-primary/40 hover:bg-secondary/80 cursor-pointer transition-all">
                                                            <span className="font-semibold text-[10px] tracking-wider text-muted-foreground uppercase">{sel.value}</span>
                                                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                                                        </div>
                                                        <div className="absolute bottom-full left-0 w-full mb-1 p-1 bg-secondary border border-border rounded shadow-xl opacity-0 scale-95 origin-bottom group-hover/sel:opacity-100 group-hover/sel:scale-100 pointer-events-none group-hover/sel:pointer-events-auto transition-all z-50">
                                                            {sel.options.map(opt => (
                                                                <button key={opt} onClick={() => sel.onChange(opt)} className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[9px] font-semibold tracking-wider hover:bg-primary/10 transition-all text-muted-foreground hover:text-primary uppercase">
                                                                    {opt}
                                                                    {sel.value === opt && <Check className="w-3 h-3 text-primary" />}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-auto">
                                            <button
                                                onClick={() => metadata && onUploadComplete(metadata)}
                                                disabled={!metadata}
                                                className={cn(
                                                    "w-full py-3.5 text-primary-foreground rounded-lg font-semibold text-[10px] tracking-widest transition-all relative overflow-hidden group/btn uppercase",
                                                    metadata ? "bg-primary hover:bg-primary/90 active:scale-[0.99] shadow-sm" : "bg-muted cursor-not-allowed opacity-20"
                                                )}
                                            >
                                                Start Compliance Scan
                                            </button>
                                            <div className="mt-6 flex items-center justify-center gap-4 opacity-5">
                                                <div className="h-[1px] w-8 bg-white" />
                                                <span className="text-[8px] font-black uppercase tracking-[0.4em]">Verified Unit</span>
                                                <div className="h-[1px] w-8 bg-white" />
                                            </div>
                                        </div>
                                    </>
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
