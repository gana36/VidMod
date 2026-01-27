import React from 'react';
import { Download, Bell, ShieldCheck, Video, Layout } from 'lucide-react';

interface TopBarProps {
    platform: string;
    region: string;
    rating: string;
    isAnalyzing: boolean;
    hasVideo: boolean;
}

const TopBar: React.FC<TopBarProps> = ({
    platform,
    region,
    rating,
    isAnalyzing,
    hasVideo
}) => {
    return (
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/30 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/5 text-zinc-100">
                    <Video className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Compliance AI</span>
                </div>

                <div className="h-4 w-[1px] bg-border mx-2" />

                {hasVideo ? (
                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-500">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 bg-zinc-900 shadow-sm">
                            <Layout className="w-3 h-3 text-zinc-500" />
                            <span className="text-[10px] font-bold uppercase tracking-tight text-zinc-300">{platform}</span>
                        </div>
                        <div className="text-zinc-700 font-light">/</div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 bg-zinc-900 shadow-sm">
                            <ShieldCheck className="w-3 h-3 text-zinc-500" />
                            <span className="text-[10px] font-bold uppercase tracking-tight text-zinc-300">{rating}</span>
                        </div>
                        <div className="text-zinc-700 font-light">/</div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 bg-zinc-900 shadow-sm">
                            <span className="text-[10px] font-bold uppercase tracking-tight text-zinc-300">{region}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-widest">Waiting for configuration...</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3">
                {isAnalyzing && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100/5 border border-white/5 text-zinc-500 mr-2">
                        <div className="w-1 h-1 rounded-full bg-zinc-500 animate-pulse" />
                        <span className="text-[9px] font-bold uppercase tracking-wider">Live Analysis</span>
                    </div>
                )}

                <button className="p-2 mr-1 rounded-full hover:bg-muted/30 text-muted-foreground hover:text-foreground relative cursor-pointer">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-card" />
                </button>

                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-[10px] font-bold hover:bg-white transition-all uppercase tracking-wider cursor-pointer">
                    <Download className="w-3.5 h-3.5" />
                    Export
                </button>
            </div>
        </header>
    );
};

export default TopBar;
