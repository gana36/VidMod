import React, { useState } from 'react';
import {
    Download,
    ShieldCheck,
    User,
    Calendar,
    CheckCircle2,
    History,
    FileVideo,
    Info,
    AlertCircle,
    Check,
    Share2
} from 'lucide-react';

import { type Finding } from './VideoWorkspace';
import { type EditVersion } from './AppLayout';
import { type VideoMetadata } from './UploadZone';

interface ComplianceReportProps {
    findings: Finding[];
    editHistory: EditVersion[];
    metadata: VideoMetadata | null;
    platform: string;
    region: string;
    rating: string;
}

const ComplianceReport: React.FC<ComplianceReportProps> = ({
    findings,
    editHistory,
    metadata,
    platform,
    region,
    rating
}) => {
    const [isApproved, setIsApproved] = useState(false);
    const [approverName, setApproverName] = useState('');
    const [notes, setNotes] = useState('');
    const [reportTitle, setReportTitle] = useState(`Compliance Certificate - ${metadata?.name || 'Untitled Video'}`);

    const totalEdits = editHistory.filter(v => v.enabled).length;
    const totalFindings = findings.length;
    const resolvedFindings = findings.filter(f =>
        editHistory.some(e => e.objectName.toLowerCase().includes(f.content.toLowerCase()) && e.enabled)
    ).length;

    const handleDownload = () => {
        // Mock download - in real app would generate PDF
        window.print();
    };

    const handleApprove = () => {
        if (!approverName.trim()) {
            alert('Please enter approver name before approving.');
            return;
        }
        setIsApproved(true);
    };

    return (
        <div className="flex-1 overflow-y-auto bg-background p-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-8 pb-12">

                {/* Header Section */}
                <div className="flex items-center justify-between border-b border-border pb-6">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-primary font-bold text-[10px] uppercase tracking-[0.2em]">
                            <ShieldCheck className="w-4 h-4" />
                            Official Compliance Report
                        </div>
                        <input
                            value={reportTitle}
                            onChange={(e) => setReportTitle(e.target.value)}
                            className="text-2xl font-black bg-transparent border-none focus:ring-0 w-full p-0 text-foreground"
                            placeholder="Report Title"
                        />
                        <p className="text-xs text-muted-foreground">Generated on {new Date().toLocaleDateString()} • System ID: {metadata?.jobId?.substring(0, 8) || 'N/A'}</p>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleDownload}
                            disabled={!isApproved}
                            className="flex items-center gap-2 px-4 py-2 bg-secondary border border-border rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-secondary/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Export PDF
                        </button>
                        <button
                            disabled={!isApproved}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            <Share2 className="w-3.5 h-3.5" />
                            Share
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Media Info */}
                    <div className="md:col-span-2 space-y-6">
                        <section className="glass-card p-6 bg-secondary/20 space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                <FileVideo className="w-4 h-4" />
                                Media Intelligence
                            </h3>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Filename</span>
                                    <p className="text-sm font-bold truncate">{metadata?.name || 'N/A'}</p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Duration</span>
                                    <p className="text-sm font-bold">{metadata?.duration || '0:00'}s</p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Compliance Standard</span>
                                    <p className="text-sm font-bold text-accent">{platform} - {region}</p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Target Rating</span>
                                    <p className="text-sm font-bold">{rating}</p>
                                </div>
                            </div>
                        </section>

                        <section className="glass-card p-6 bg-secondary/20 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                                    <History className="w-4 h-4" />
                                    Modification Timeline
                                </h3>
                                <div className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[9px] font-black uppercase tracking-widest">
                                    {totalEdits} actions applied
                                </div>
                            </div>

                            {editHistory.filter(v => v.enabled).length === 0 ? (
                                <div className="p-8 text-center border border-dashed border-border rounded-xl bg-background/50">
                                    <p className="text-xs text-muted-foreground">No modifications have been applied to this version.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {editHistory.filter(v => v.enabled).map((edit, i) => (
                                        <div key={edit.id} className="flex gap-4 relative">
                                            {i !== editHistory.filter(v => v.enabled).length - 1 && (
                                                <div className="absolute left-[11px] top-6 bottom-[-20px] w-px bg-border" />
                                            )}
                                            <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0 z-10">
                                                <div className="w-2 h-2 rounded-full bg-primary" />
                                            </div>
                                            <div className="flex-1 pb-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-bold">Applied {edit.effectType} to "{edit.objectName}"</h4>
                                                    <span className="text-[10px] font-mono text-muted-foreground">v{edit.version} • {new Date(edit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <div className="mt-2 text-[11px] text-muted-foreground bg-background/40 p-2 rounded border border-border/50">
                                                    Object was successfully {edit.effectType === 'blur' ? 'masked' : edit.effectType === 'pixelate' ? 'pixelated' : 'replaced'} using AI-guided remediation.
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Violations Summary */}
                        <section className="glass-card p-6 border-emerald-500/20 bg-emerald-500/[0.02] space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4" />
                                Compliance Status
                            </h3>

                            <div className="flex items-center gap-6 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between text-xs mb-1">
                                        <span className="font-bold">Remediation Coverage</span>
                                        <span className="font-bold">{totalFindings === 0 ? '100%' : `${Math.round((resolvedFindings / totalFindings) * 100)}%`}</span>
                                    </div>
                                    <div className="w-full h-2 bg-emerald-500/20 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-1000"
                                            style={{ width: `${totalFindings === 0 ? 100 : (resolvedFindings / totalFindings) * 100}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="text-center">
                                    <p className="text-2xl font-black text-emerald-500 tabular-nums">{resolvedFindings}/{totalFindings}</p>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500/60 leading-none">Resolved</p>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Sidebar: Editor Rules & Approval */}
                    <div className="space-y-6">
                        <section className="glass-card p-5 bg-card/50 space-y-4 border-amber-500/20">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-amber-500 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                Editor Notes
                            </h3>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Add specific details about the remediation process or special approvals..."
                                className="w-full h-32 p-3 bg-background/50 border border-border rounded-lg text-xs placeholder:text-muted-foreground focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 outline-none resize-none transition-all"
                            />
                        </section>

                        <section className="glass-card p-5 bg-primary/5 space-y-6 border-primary/20">
                            <div className="space-y-4">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    Review & Approval
                                </h3>

                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Approver Name</label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                            <input
                                                value={approverName}
                                                onChange={(e) => setApproverName(e.target.value)}
                                                readOnly={isApproved}
                                                className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                                                placeholder="Legal Officer Name"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Date</label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                            <input
                                                type="text"
                                                value={new Date().toLocaleDateString()}
                                                readOnly
                                                className="w-full pl-9 pr-4 py-2 bg-background/50 border border-border rounded-lg text-sm outline-none opacity-70"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {!isApproved ? (
                                <button
                                    onClick={handleApprove}
                                    className="w-full py-4 bg-primary text-primary-foreground font-black text-xs uppercase tracking-[0.2em] rounded-xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
                                >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Approve & Certify
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="w-full py-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 font-black text-xs uppercase tracking-[0.2em] rounded-xl flex items-center justify-center gap-2">
                                        <Check className="w-4 h-4" />
                                        Certified
                                    </div>
                                    <p className="text-[10px] text-center text-muted-foreground italic">
                                        Electronic signature verified at {new Date().toLocaleTimeString()}
                                    </p>
                                </div>
                            )}
                        </section>

                        <div className="p-4 rounded-xl border border-dashed border-border bg-muted/20 space-y-2">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                <Info className="w-3.5 h-3.5" />
                                Compliance Engine
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                This report is cryptographically linked to job ID <span className="font-mono text-foreground">{metadata?.jobId || 'N/A'}</span>. All modifications are tracked in the system ledger.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ComplianceReport;
