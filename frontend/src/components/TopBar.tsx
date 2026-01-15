import React from 'react';
import { Upload, Download, ChevronDown, Bell } from 'lucide-react';

const TopBar: React.FC = () => {
    return (
        <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/30 backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Workspace</h2>
                <div className="h-4 w-[1px] bg-border mx-2" />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/50 hover:bg-muted/20 cursor-pointer transition-colors group">
                    <span className="text-sm font-medium">Standard Compliance Profile</span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button className="p-2 mr-2 rounded-full hover:bg-muted/30 text-muted-foreground hover:text-foreground relative">
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
