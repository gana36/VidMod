import React, { useState, useRef } from 'react';
import { Upload as UploadIcon, X, Loader2, Check, ChevronDown, Video } from 'lucide-react';
import { API_BASE } from '../services/api';
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
            // 1. Try to get Signed URL
            let uploadUrlData = null;
            try {
                const urlRes = await fetch(`${API_BASE}/upload-url`);
                if (urlRes.ok) {
                    uploadUrlData = await urlRes.json();
                }
            } catch (e) {
                console.warn("Signed URL not supported, falling back to direct upload");
            }

            if (uploadUrlData) {
                // 2a. Upload to GCS via Signed URL
                const { upload_url, job_id, gcs_key } = uploadUrlData;

                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('PUT', upload_url, true);
                    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            // Map 0-100 upload to 10-90 spread
                            const percentComplete = (e.loaded / e.total) * 80;
                            setProgress(10 + percentComplete);
                        }
                    };

                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(xhr.response);
                        } else {
                            reject(new Error(`GCS Upload failed: ${xhr.statusText}`));
                        }
                    };

                    xhr.onerror = () => reject(new Error("GCS Network Error"));
                    xhr.send(file);
                });

                // 2b. Notify backend to start processing
                setProgress(95);
                const processRes = await fetch(`${API_BASE}/process-upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        job_id,
                        gcs_key,
                        filename: file.name
                    })
                });

                if (!processRes.ok) throw new Error(`Processing trigger failed: ${processRes.statusText}`);
                const data = await processRes.json();
                return data.job_id;

            } else {
                // 3. Fallback to Direct Upload (Legacy)
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${API_BASE}/upload`, {
                    method: 'POST',
                    body: formData,
                });

                setProgress(50);
                if (!response.ok) throw new Error(`Upload failed: ${response.statusText} `);

                const data = await response.json();
                return data.job_id;
            }
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
        <div className="h-full flex flex-col items-center justify-center p-6 bg-[#0a0a0c]">
            <div className="w-full max-w-4xl font-mono">
                <div className="mb-12 text-center animate-in fade-in slide-in-from-top-4 duration-700">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-white/5 bg-white/[0.02] mb-6">
                        <Video className="w-3 h-3 text-zinc-500" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500">Source Ingestion Node</span>
                    </div>
                    <h1 className="text-4xl font-black mb-3 tracking-[0.2em] text-white/90">VIDMOD</h1>
                    <p className="text-zinc-500 font-bold text-[10px] uppercase tracking-[0.2em] max-w-sm mx-auto leading-relaxed opacity-40">High-Precision Media Compliance & Remediation</p>
                </div>

                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                        "relative rounded-3xl border border-white/5 transition-all duration-500 flex flex-col items-center justify-center p-12 min-h-[520px] overflow-hidden bg-white/[0.01] shadow-2xl",
                        isDragging ? "border-zinc-500/40 bg-zinc-500/5" : "hover:border-white/10",
                        status !== 'idle' && "p-8"
                    )}
                >
                    {/* Technical Grid Pattern */}
                    <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

                    {status === 'idle' && (
                        <>
                            <div
                                className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-center mb-8 transition-all duration-300 group cursor-pointer hover:bg-white/[0.04] hover:border-white/10 hover:scale-105"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <UploadIcon className="w-6 h-6 text-zinc-600 group-hover:text-white transition-colors" />
                            </div>
                            <div className="text-center space-y-10 z-10">
                                <div className="space-y-2">
                                    <p className="text-xl font-bold text-white/80 tracking-[0.1em] uppercase">Select Source</p>
                                    <p className="text-zinc-500 max-w-[320px] mx-auto text-[10px] font-bold leading-relaxed opacity-40 uppercase tracking-widest">Awaiting local media for compliance validation.</p>
                                </div>
                                <div className="flex flex-col gap-5 items-center">
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="px-10 py-4 bg-white text-zinc-950 rounded-xl font-bold text-[11px] tracking-[0.2em] shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:bg-zinc-200 transition-all active:scale-95 uppercase cursor-pointer"
                                    >
                                        Uplink Media
                                    </button>
                                    {onBrowseLibrary && (
                                        <button
                                            onClick={onBrowseLibrary}
                                            className="text-[10px] font-bold text-zinc-600 hover:text-white transition-all tracking-[0.3em] uppercase opacity-40 hover:opacity-100 cursor-pointer"
                                        >
                                            Search Archive
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-8 justify-center items-center mt-16 opacity-20">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.3em]">Max 120s</span>
                                    <div className="w-[1px] h-4 bg-white/20" />
                                    <span className="text-[9px] font-bold uppercase tracking-[0.3em]">MP4 / MOV</span>
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
                        <div className="w-full h-full flex flex-col z-10 font-mono">
                            {/* Compact Video Info */}
                            <div className="flex items-center gap-8 p-6 rounded-[32px] bg-white/[0.02] border border-white/5 backdrop-blur-3xl mb-10 transition-all shadow-[0_32px_64px_rgba(0,0,0,0.4)]">
                                <div className="w-40 h-24 rounded-2xl bg-black flex items-center justify-center flex-shrink-0 shadow-2xl overflow-hidden border border-white/5 group/preview relative cursor-pointer">
                                    {videoUrl && (
                                        <video src={videoUrl} className="w-full h-full object-cover opacity-50 group-hover/preview:opacity-100 transition-all duration-500" autoPlay muted loop playsInline />
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/preview:opacity-100 transition-opacity" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-bold truncate pr-6 text-xl tracking-[0.05em] text-white/90 uppercase">{metadata?.name}</h3>
                                        <button onClick={reset} className="p-2 hover:bg-white/5 text-zinc-600 hover:text-white rounded-xl transition-all cursor-pointer">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex gap-6 text-[9px] font-bold text-zinc-500 uppercase tracking-[0.3em] opacity-40">
                                        <span className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-zinc-500" />{metadata?.size}</span>
                                        <span className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-zinc-500" />{metadata?.duration}</span>
                                        <span className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-zinc-500" />{metadata?.resolution}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Main Configuration Section */}
                            <div className="flex-1 flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {status === 'uploading' || status === 'processing' ? (
                                    <div className="flex-1 flex flex-col justify-center gap-8">
                                        <div className="flex justify-between items-end mb-2">
                                            <div className="flex items-center gap-4">
                                                <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                                                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">
                                                    {status === 'uploading' ? 'Ingesting Pipeline' : 'Neural Analysis Active'}
                                                </span>
                                            </div>
                                            <span className="text-sm font-bold font-mono text-white/80">{Math.floor(progress)}%</span>
                                        </div>
                                        <div className="h-1 w-full bg-white/[0.02] rounded-full overflow-hidden border border-white/5">
                                            <div className="h-full bg-white transition-all duration-500 shadow-[0_0_20px_rgba(255,255,255,0.2)]" style={{ width: `${progress}%` }} />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            {[
                                                { label: 'Target Platform', value: platform, options: platforms, onChange: onPlatformChange },
                                                { label: 'Compliance Rating', value: rating, options: ratings, onChange: onRatingChange },
                                                { label: 'Regional Logic', value: region, options: regions, onChange: onRegionChange }
                                            ].map((sel, idx) => (
                                                <div key={idx} className="space-y-4">
                                                    <label className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600 ml-1">{sel.label}</label>
                                                    <div className="relative group/sel">
                                                        <div className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-white/[0.01] hover:border-white/20 hover:bg-white/[0.03] cursor-pointer transition-all">
                                                            <span className="font-bold text-[10px] tracking-[0.1em] text-zinc-400 uppercase">{sel.value}</span>
                                                            <ChevronDown className="w-3.5 h-3.5 text-zinc-600 transition-transform group-hover/sel:rotate-180" />
                                                        </div>
                                                        <div className="absolute bottom-full left-0 w-full pb-3 opacity-0 scale-95 origin-bottom group-hover/sel:opacity-100 group-hover/sel:scale-100 pointer-events-none group-hover/sel:pointer-events-auto transition-all z-50">
                                                            <div className="p-2 bg-[#0a0a0c] border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl">
                                                                {sel.options.map(opt => (
                                                                    <button key={opt} onClick={() => sel.onChange(opt)} className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[10px] font-bold tracking-widest hover:bg-white/5 transition-all text-zinc-500 hover:text-white uppercase">
                                                                        {opt}
                                                                        {sel.value === opt && <Check className="w-3.5 h-3.5 text-white" />}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-auto pt-8">
                                            <button
                                                onClick={() => metadata && onUploadComplete(metadata)}
                                                disabled={!metadata}
                                                className={cn(
                                                    "w-full py-4 bg-white text-zinc-950 rounded-2xl font-bold text-[11px] tracking-[0.3em] transition-all relative overflow-hidden group/btn uppercase shadow-[0_32px_64px_rgba(0,0,0,0.5)]",
                                                    metadata ? "hover:bg-zinc-200 active:scale-[0.98]" : "bg-white/10 cursor-not-allowed opacity-20"
                                                )}
                                            >
                                                Initialize Scan Sequence
                                            </button>
                                            <div className="mt-8 flex items-center justify-center gap-6 opacity-10">
                                                <div className="h-[1px] w-12 bg-white" />
                                                <span className="text-[8px] font-bold uppercase tracking-[0.5em] text-white">System Integrity Verified</span>
                                                <div className="h-[1px] w-12 bg-white" />
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
