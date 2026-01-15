import React from 'react';
import {
    BarChart3,
    Clock,
    FileText,
    Upload,
    LayoutDashboard,
    Settings,
    FileVideo
} from 'lucide-react';
import { type VideoMetadata } from './UploadZone';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SidebarProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    metadata?: VideoMetadata | null;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, metadata }) => {
    const menuItems = [
        { id: 'Upload', icon: Upload, label: 'Upload' },
        { id: 'Analysis', icon: BarChart3, label: 'Analysis' },
        { id: 'Timeline', icon: Clock, label: 'Timeline' },
        { id: 'Compliance', icon: FileText, label: 'Compliance Report' },
    ];

    return (
        <aside className="w-64 border-r border-border flex flex-col bg-card/50 backdrop-blur-sm">
            <div className="p-6">
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                        <LayoutDashboard className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold text-lg tracking-tight">Zenith Sensor</span>
                </div>

                <nav className="space-y-1">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group",
                                activeTab === item.id
                                    ? "bg-accent/10 text-accent shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
            </div>

            <div className="mt-auto p-6 border-t border-border space-y-4">
                {metadata && (
                    <div className="space-y-3 pb-4">
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
