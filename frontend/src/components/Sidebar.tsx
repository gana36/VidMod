import React, { useState } from 'react';
import {
    BarChart3,
    Clock,
    FileText,
    Upload,
    LayoutDashboard,
    Settings,
    FileVideo,
    ShieldCheck,
    ChevronDown,
    ChevronUp
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
        { id: 'Timeline', icon: Clock, label: 'Timeline' },
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
        <aside className="w-64 border-r border-border flex flex-col bg-card/50 backdrop-blur-sm">
            <div className="p-6 overflow-y-auto no-scrollbar flex-1">
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shadow-sm">
                        <LayoutDashboard className="w-5 h-5 text-accent-foreground" />
                    </div>
                    <span className="font-bold text-lg tracking-tight">Zenith Sensor</span>
                </div>

                <nav className="space-y-1 mb-8">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group",
                                activeTab === item.id
                                    ? "bg-white/10 text-foreground font-black"
                                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                            )}
                        >
                            <item.icon className={cn(
                                "w-4 h-4",
                                activeTab === item.id ? "text-accent" : "text-muted-foreground group-hover:text-foreground"
                            )} />
                            {item.label}
                        </button>
                    ))}
                </nav>

                {/* Policy Section */}
                {policy && (
                    <div className="space-y-3">
                        <button
                            onClick={() => setShowPolicies(!showPolicies)}
                            className="w-full flex items-center justify-between text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Locked Policies</span>
                            </div>
                            {showPolicies ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {showPolicies && (
                            <div className="bg-background/40 rounded-xl p-3 border border-border/50 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                {Object.entries(policy.rules).map(([category, action]) => {
                                    if (action === RemediationAction.ALLOWED) return null;
                                    return (
                                        <div key={category} className="flex flex-col gap-1">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-medium text-muted-foreground capitalize">
                                                    {category.replace('_', ' ')}
                                                </span>
                                                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/5 border border-white/5", getActionColor(action))}>
                                                    {action}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {Object.values(policy.rules).every(a => a === RemediationAction.ALLOWED) && (
                                    <div className="text-[10px] text-emerald-400 font-medium text-center py-2">
                                        All Content Allowed
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="p-6 border-t border-border space-y-4">
                {metadata && (
                    <div className="space-y-3 pb-2">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <FileVideo className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Active File</span>
                        </div>
                        <div className="bg-background/40 rounded-lg p-3 border border-border/50 flex flex-col gap-2">
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-muted-foreground font-medium">Resolution</span>
                                <span className="font-bold">{metadata.resolution}</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-muted-foreground font-medium">Size</span>
                                <span className="font-bold">{metadata.size}</span>
                            </div>
                        </div>
                    </div>
                )}
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                    <Settings className="w-4 h-4" />
                    Settings
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
