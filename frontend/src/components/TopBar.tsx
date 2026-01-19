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
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Compliance AI</span>
                </div>

                <div className="h-4 w-[1px] bg-border mx-2" />

                {hasVideo ? (
                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-500">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background/50">
                            <Layout className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold">{platform}</span>
                        </div>
                        <div className="text-muted-foreground font-light">/</div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background/50">
                            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold">{rating}</span>
                        </div>
                        <div className="text-muted-foreground font-light">/</div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background/50">
                            <span className="text-xs font-bold">{region}</span>
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
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent mr-2 animate-pulse">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Analyzing Compliance...</span>
                    </div>
                )}

                <button className="p-2 mr-1 rounded-full hover:bg-muted/30 text-muted-foreground hover:text-foreground relative">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-card" />
                </button>

                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-[10px] font-black hover:bg-white transition-all uppercase tracking-[0.2em]">
                    <Download className="w-3.5 h-3.5" />
                    Export
                </button>
            </div>
        </header>
    );
};

export default TopBar;
