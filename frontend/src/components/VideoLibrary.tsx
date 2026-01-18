import React, { useState, useEffect } from 'react';
import { Video, Clock, HardDrive, X, Check } from 'lucide-react';

interface VideoMetadata {
    key: string;
    filename: string;
    size: number;
    size_mb: number;
    last_modified: string;
    url: string;
}

interface VideoLibraryProps {
    onVideoSelect: (jobId: string) => void;
    onClose: () => void;
}

export const VideoLibrary: React.FC<VideoLibraryProps> = ({ onVideoSelect, onClose }) => {
    const [videos, setVideos] = useState<VideoMetadata[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selecting, setSelecting] = useState<string | null>(null);

    useEffect(() => {
        fetchVideos();
    }, []);

    const fetchVideos = async () => {
        try {
            setLoading(true);
            setError(''); // Clear previous errors

            const response = await fetch('http://localhost:8000/api/videos');

            if (!response.ok) {
                throw new Error(`Failed to fetch videos: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Server returned non-JSON response. Is S3 configured?');
            }

            const data = await response.json();
            setVideos(data);
        } catch (err: any) {
            console.error('Failed to load video library:', err);
            setError(err.message || 'Failed to load videos');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectVideo = async (video: VideoMetadata) => {
        try {
            setSelecting(video.key);

            const response = await fetch('/api/use-existing-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    s3_url: video.url,
                    filename: video.filename
                })
            });

            if (!response.ok) {
                throw new Error('Failed to create job from video');
            }

            const data = await response.json();
            onVideoSelect(data.job_id);
            onClose();
        } catch (err: any) {
            setError(err.message);
            setSelecting(null);
        }
    };

    const formatDate = (isoDate: string) => {
        const date = new Date(isoDate);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="relative w-full max-w-6xl max-h-[90vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
                    <h2 className="font-bold text-xl flex items-center gap-2">
                        <Video className="w-6 h-6 text-accent" />
                        Video Library
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-muted transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64">
                            <div className="w-12 h-12 border-4 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
                            <p className="text-muted-foreground">Loading videos...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-64">
                            <p className="text-red-400 mb-4">❌ {error}</p>
                            <button
                                onClick={fetchVideos}
                                className="px-4 py-2 bg-accent rounded-lg hover:bg-accent/90 transition-colors"
                            >
                                Retry
                            </button>
                        </div>
                    ) : videos.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64">
                            <Video className="w-16 h-16 text-muted-foreground/50 mb-4" />
                            <p className="text-muted-foreground">No videos in library yet</p>
                            <p className="text-sm text-muted-foreground mt-2">
                                Upload videos with S3 enabled to see them here
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {videos.map((video) => (
                                <div
                                    key={video.key}
                                    className="border border-border rounded-xl overflow-hidden hover:border-accent transition-all bg-muted/10 hover:bg-muted/20"
                                >
                                    {/* Video Preview */}
                                    <div className="aspect-video bg-muted flex items-center justify-center">
                                        <video
                                            src={video.url}
                                            className="w-full h-full object-cover"
                                            preload="metadata"
                                        />
                                    </div>

                                    {/* Video Info */}
                                    <div className="p-4">
                                        <h3 className="font-semibold text-sm mb-2 truncate" title={video.filename}>
                                            {video.filename}
                                        </h3>

                                        <div className="space-y-1 mb-3">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <HardDrive className="w-3 h-3" />
                                                <span>{video.size_mb.toFixed(2)} MB</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Clock className="w-3 h-3" />
                                                <span>{formatDate(video.last_modified)}</span>
                                            </div>
                                        </div>

                                        {/* Use Button */}
                                        <button
                                            onClick={() => handleSelectVideo(video)}
                                            disabled={selecting === video.key}
                                            className="w-full py-2 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {selecting === video.key ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    Loading...
                                                </>
                                            ) : (
                                                <>
                                                    <Check className="w-4 h-4" />
                                                    Use This Video
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-muted/20">
                    <p className="text-sm text-muted-foreground text-center">
                        {videos.length} video{videos.length !== 1 ? 's' : ''} in library
                    </p>
                </div>
            </div>
        </div>
    );
};
