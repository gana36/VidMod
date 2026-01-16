import React from 'react';
import { Upload, Download, ChevronDown, Bell, Globe, Layout, Check } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface TopBarProps {
    platform: string;
    region: string;
    onPlatformChange: (platform: string) => void;
    onRegionChange: (region: string) => void;
}

const platforms = ['YouTube', 'OTT Streaming', 'Kids Content', 'Airline Entertainment'];
const regions = ['US', 'EU', 'Middle East', 'Asia'];

const TopBar: React.FC<TopBarProps> = ({ platform, region, onPlatformChange, onRegionChange }) => {
    return (
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/30 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Workspace</h2>
                <div className="h-4 w-[1px] bg-border mx-2" />

                {/* Platform Selector */}
                <div className="relative group/dropdown">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/50 hover:bg-muted/20 cursor-pointer transition-all group">
                        <Layout className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{platform}</span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                    <div className="absolute top-[calc(100%+4px)] left-0 w-56 p-1 bg-background border border-border rounded-xl shadow-2xl opacity-0 translate-y-2 pointer-events-none group-hover/dropdown:opacity-100 group-hover/dropdown:translate-y-0 group-hover/dropdown:pointer-events-auto transition-all z-50 backdrop-blur-xl">
                        {platforms.map((p) => (
                            <button
                                key={p}
                                onClick={() => onPlatformChange(p)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
                            >
                                {p}
                                {platform === p && <Check className="w-4 h-4 text-accent" />}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="text-muted-foreground font-light px-1">/</div>

                {/* Region Selector */}
                <div className="relative group/dropdown">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/50 hover:bg-muted/20 cursor-pointer transition-all group">
                        <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{region}</span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                    <div className="absolute top-[calc(100%+4px)] left-0 w-48 p-1 bg-background border border-border rounded-xl shadow-2xl opacity-0 translate-y-2 pointer-events-none group-hover/dropdown:opacity-100 group-hover/dropdown:translate-y-0 group-hover/dropdown:pointer-events-auto transition-all z-50 backdrop-blur-xl">
                        {regions.map((r) => (
                            <button
                                key={r}
                                onClick={() => onRegionChange(r)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
                            >
                                {r}
                                {region === r && <Check className="w-4 h-4 text-accent" />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/5 border border-accent/20 text-accent mr-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{platform} · {region}</span>
                </div>

                <button className="p-2 mr-1 rounded-full hover:bg-muted/30 text-muted-foreground hover:text-foreground relative">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-card" />
                </button>

                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background border border-border text-sm font-medium hover:bg-muted/30 transition-all">
                    <Upload className="w-4 h-4" />
                    Upload Video
                </button>

                <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 shadow-lg shadow-accent/20 transition-all">
                    <Download className="w-4 h-4" />
                    Export Result
                </button>
            </div>
        </header>
    );
};

export default TopBar;
