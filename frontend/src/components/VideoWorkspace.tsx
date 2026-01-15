import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2 } from 'lucide-react';

const VideoWorkspace: React.FC = () => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress] = useState(35);

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Video Container */}
            <div className="flex-1 relative rounded-xl border border-border bg-black overflow-hidden group shadow-2xl">
                <video
                    className="w-full h-full object-contain"
                    poster="https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&q=80&w=1200"
                />

                {/* Play Overlay (Hidden when playing) */}
                {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                        <button
                            onClick={() => setIsPlaying(true)}
                            className="w-20 h-20 flex items-center justify-center rounded-full bg-accent/90 text-white shadow-2xl hover:scale-110 transition-transform"
                        >
                            <Play className="fill-current w-8 h-8 ml-1" />
                        </button>
                    </div>
                )}

                {/* Floating Controls Bar (Shows on hover) */}
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex flex-col gap-3">
                        {/* Scrubber */}
                        <div className="relative h-1 w-full bg-white/20 rounded-full cursor-pointer group/scrub">
                            <div
                                className="absolute top-0 left-0 h-full bg-accent rounded-full flex items-center justify-end"
                                style={{ width: `${progress}%` }}
                            >
                                <div className="w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover/scrub:scale-100 transition-transform" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <button className="text-white/80 hover:text-white transition-colors"><SkipBack className="w-5 h-5" /></button>
                                <button onClick={() => setIsPlaying(!isPlaying)} className="text-white hover:text-white transition-colors">
                                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                                </button>
                                <button className="text-white/80 hover:text-white transition-colors"><SkipForward className="w-5 h-5" /></button>
                                <div className="text-xs font-mono text-white/60 select-none">
                                    <span className="text-white">00:12:44</span> / 00:45:00
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 group/vol">
                                    <Volume2 className="w-5 h-5 text-white/80" />
                                    <div className="w-20 h-1 bg-white/20 rounded-full overflow-hidden">
                                        <div className="w-2/3 h-full bg-white" />
                                    </div>
                                </div>
                                <button className="text-white/80 hover:text-white transition-colors"><Maximize2 className="w-5 h-5" /></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Timeline Placeholder */}
            <div className="h-48 border border-border bg-card/40 rounded-xl p-4 overflow-hidden relative">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Master Timeline</span>
                    <div className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-2 py-0.5 rounded">FPS: 60</div>
                </div>

                {/* Mock Waveform/Tracks */}
                <div className="flex flex-col gap-2 mt-4 opacity-50">
                    <div className="h-8 w-full bg-blue-500/10 border border-blue-500/20 rounded-md relative overflow-hidden">
                        <div className="absolute left-1/4 right-1/3 top-0 bottom-0 bg-accent/30 border-x border-accent/50" />
                    </div>
                    <div className="h-8 w-full bg-green-500/10 border border-green-500/20 rounded-md relative overflow-hidden">
                        <div className="absolute left-[10%] right-[60%] top-0 bottom-0 bg-green-500/30 border-x border-green-500/50" />
                    </div>
                    <div className="h-8 w-full bg-purple-500/10 border border-purple-500/20 rounded-md relative overflow-hidden">
                        <div className="absolute left-[40%] right-[10%] top-0 bottom-0 bg-purple-500/30 border-x border-purple-500/50" />
                    </div>
                </div>

                {/* Playhead */}
                <div
                    className="absolute top-0 bottom-0 w-px bg-accent z-10 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                    style={{ left: `calc(${progress}% + 16px)` }}
                >
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-accent rotate-45" />
                </div>
            </div>
        </div>
    );
};

export default VideoWorkspace;
