import React, { useState } from 'react';
import {
    BarChart3,
    FileText,
    Upload,
    FileVideo,
    ShieldCheck,
    ChevronDown,
    ChevronUp,
    Video,
    Settings
} from 'lucide-react';
import { type VideoMetadata } from './UploadZone';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { type EnforcementObject, RemediationAction } from '../services/policyEngine';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SidebarProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    metadata?: VideoMetadata | null;
    policy?: EnforcementObject;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, metadata, policy }) => {
    const [showPolicies, setShowPolicies] = useState(true);

    const menuItems = [
        { id: 'Upload', icon: Upload, label: 'Upload' },
        { id: 'Analysis', icon: BarChart3, label: 'Analysis' },
        { id: 'Compliance', icon: FileText, label: 'Compliance Report' },
    ];

    const getActionColor = (action: string) => {
        switch (action) {
            case RemediationAction.ALLOWED: return 'text-emerald-400';
            case RemediationAction.BLOCK_SEGMENT: return 'text-red-400';
            case RemediationAction.PIXELATE:
            case RemediationAction.BLUR: return 'text-amber-400';
            case RemediationAction.OBJECT_REPLACE: return 'text-blue-400';
            default: return 'text-accent';
        }
    };

    return (
        <aside className="w-64 border-r border-border flex flex-col bg-[#0a0a0c]/80 backdrop-blur-xl">
            <div className="p-6 overflow-y-auto no-scrollbar flex-1">
                <div className="flex items-center gap-3 mb-10 px-2">
                    <div className="w-6 h-6 rounded bg-zinc-800 border border-white/5 flex items-center justify-center">
                        <Video className="w-3.5 h-3.5 text-zinc-400" />
                    </div>
                    <span className="font-bold text-[11px] uppercase tracking-[0.2em] text-white/90">VidMod AI</span>
                </div>

                <nav className="space-y-1.5 mb-10">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.15em] transition-all group cursor-pointer",
                                activeTab === item.id
                                    ? "bg-white/[0.04] text-white border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
                                    : "text-zinc-500 hover:bg-white/[0.02] hover:text-zinc-300 border border-transparent"
                            )}
                        >
                            <item.icon className={cn(
                                "w-3.5 h-3.5",
                                activeTab === item.id ? "text-white" : "text-zinc-600 group-hover:text-zinc-400"
                            )} />
                            {item.label}
                        </button>
                    ))}
                </nav>

                {/* Policy Section */}
                {policy && (
                    <div className="space-y-4">
                        <button
                            onClick={() => setShowPolicies(!showPolicies)}
                            className="w-full flex items-center justify-between text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer px-2"
                        >
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Enforcement</span>
                            </div>
                            {showPolicies ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {showPolicies && (
                            <div className="bg-white/[0.02] rounded-2xl p-4 border border-white/5 space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                {Object.entries(policy.rules).map(([category, action]) => {
                                    if (action === RemediationAction.ALLOWED) return null;
                                    return (
                                        <div key={category} className="flex flex-col gap-1.5">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-bold text-zinc-500 capitalize tracking-wide">
                                                    {category.replace('_', ' ')}
                                                </span>
                                                <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/5", getActionColor(action))}>
                                                    {action}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {Object.values(policy.rules).every(a => a === RemediationAction.ALLOWED) && (
                                    <div className="text-[10px] text-emerald-500/80 font-bold text-center py-2 tracking-widest uppercase">
                                        Compliance Clear
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="p-6 border-t border-white/5 space-y-6">
                {metadata && (
                    <div className="space-y-3 pb-2">
                        <div className="flex items-center gap-2 text-zinc-600 px-1">
                            <FileVideo className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Source Meta</span>
                        </div>
                        <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5 flex flex-col gap-3">
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-zinc-500 font-bold uppercase tracking-wider">Resolution</span>
                                <span className="font-mono text-zinc-300">{metadata.resolution}</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-zinc-500 font-bold uppercase tracking-wider">Size</span>
                                <span className="font-mono text-zinc-300">{metadata.size}</span>
                            </div>
                        </div>
                    </div>
                )}
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:bg-white/[0.02] hover:text-zinc-300 transition-all cursor-pointer">
                    <Settings className="w-4 h-4" />
                    System
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
