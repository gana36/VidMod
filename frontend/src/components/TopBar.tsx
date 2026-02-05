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
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[#0a0a0c]/40 backdrop-blur-xl sticky top-0 z-10 font-mono">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5 text-zinc-100">
                    <Video className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]">VidMod Node / Prime</span>
                </div>

                <div className="h-4 w-[1px] bg-white/5 mx-2" />

                {hasVideo ? (
                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-white/5 bg-white/[0.01]">
                            <Layout className="w-3 h-3 text-zinc-600" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-400">{platform}</span>
                        </div>
                        <div className="text-zinc-800 font-bold text-[9px]">/</div>
                        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-white/5 bg-white/[0.01]">
                            <ShieldCheck className="w-3 h-3 text-zinc-600" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-400">{rating}</span>
                        </div>
                        <div className="text-zinc-800 font-bold text-[9px]">/</div>
                        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-white/5 bg-white/[0.01]">
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-400">{region}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] text-zinc-600">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em]">Awaiting Uplink...</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3">
                {isAnalyzing && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-500/5 border border-zinc-500/10 text-zinc-500 mr-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em]">Analyzing</span>
                    </div>
                )}

                <button className="p-2 mr-1 rounded-xl hover:bg-white/5 text-zinc-500 hover:text-zinc-200 relative cursor-pointer transition-all">
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-white/20 rounded-full" />
                </button>

                <button className="flex items-center gap-2 px-5 py-2 rounded-xl bg-white text-zinc-950 text-[10px] font-bold hover:bg-zinc-200 transition-all uppercase tracking-[0.2em] cursor-pointer shadow-2xl">
                    <Download className="w-3.5 h-3.5" />
                    Export
                </button>
            </div>
        </header>
    );
};

export default TopBar;
