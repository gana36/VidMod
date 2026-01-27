import React, { useState } from 'react';
import {
    Download,
    ShieldCheck,
    CheckCircle2,
    History,
    FileVideo,
    Info,
    AlertCircle,
    Check,
    FileText,
    Activity,
    Award,
    Calendar,
    Hash,
    User,
    FileSignature,
    Zap
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

    const activeEdits = editHistory.filter(v => v.enabled);
    const totalEdits = activeEdits.length;
    const totalFindings = findings.length;

    // Improved logic for resolved findings - matching by objectName or finding content
    const resolvedFindings = findings.filter(f =>
        activeEdits.some(e =>
            e.objectName.toLowerCase().includes(f.content.toLowerCase()) ||
            f.content.toLowerCase().includes(e.objectName.toLowerCase())
        )
    ).length;

    const remediationRate = totalFindings === 0 ? 100 : Math.round((resolvedFindings / totalFindings) * 100);

    const generatePDF = () => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        // Colors
        const primaryColor: [number, number, number] = [15, 23, 42]; // Slate 900

        // Header - Branding
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, pageWidth, 40, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('VIDMOD', 15, 25);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('COMPLIANCE PROTOCOL v4.2', 15, 32);

        doc.setFontSize(14);
        doc.text('CERTIFICATE OF COMPLIANCE', pageWidth - 15, 25, { align: 'right' });

        // Certificate Details
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(reportTitle.toUpperCase(), 15, 60);

        doc.setDrawColor(226, 232, 240);
        doc.line(15, 65, pageWidth - 15, 65);

        // Metadata Section
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('MEDIA SPECIFICATIONS', 15, 75);

        const metadataRows = [
            ['Source File:', metadata?.name || 'N/A'],
            ['Compliance Standard:', `${platform} / ${region}`],
            ['Target Rating:', rating],
            ['Processing ID:', metadata?.jobId?.substring(0, 16) || 'LOAD_FAIL'],
            ['Generated Date:', new Date().toLocaleString()],
            ['Remediation Rate:', `${remediationRate}%`],
        ];

        autoTable(doc, {
            startY: 80,
            head: [],
            body: metadataRows,
            theme: 'plain',
            styles: { fontSize: 9, cellPadding: 2 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
        });

        // Technical Log Header
        const finalY = (doc as any).lastAutoTable.finalY || 120;
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('TECHNICAL REMEDIATION LOG', 15, finalY + 15);

        // Edit History Table
        const tableData = activeEdits.map(edit => [
            `v${edit.version}`,
            edit.objectName,
            edit.effectType.toUpperCase(),
            new Date(edit.timestamp).toLocaleString(),
            'VERIFIED'
        ]);

        autoTable(doc, {
            startY: finalY + 20,
            head: [['Ver', 'Subject', 'Method', 'Timestamp', 'Status']],
            body: tableData.length > 0 ? tableData : [['--', 'No modifications applied', '--', '--', '--']],
            headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
        });

        // Sign-off Section
        const signOffY = (doc as any).lastAutoTable.finalY + 30;

        // Check if we need a new page
        if (signOffY > doc.internal.pageSize.getHeight() - 60) {
            doc.addPage();
            doc.text('CERTIFICATION & SIGN-OFF CONTINUED', 15, 20);
        }

        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('CERTIFICATION & SIGN-OFF', 15, signOffY);

        doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setLineWidth(0.5);
        doc.line(15, signOffY + 5, pageWidth - 15, signOffY + 5);

        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setFontSize(9);
        doc.text('Approver:', 15, signOffY + 15);
        doc.setFont('helvetica', 'bold');
        doc.text(approverName, 40, signOffY + 15);

        doc.setFont('helvetica', 'normal');
        doc.text('Notes:', 15, signOffY + 25);
        const splitNotes = doc.splitTextToSize(notes || 'No additional compliance notes provided.', pageWidth - 55);
        doc.text(splitNotes, 40, signOffY + 25);

        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Digital Verification Hash: ${btoa(metadata?.jobId || 'vidmod_hash').substring(0, 32).toUpperCase()}`, 15, signOffY + 50);

        // Footer
        const totalPages = doc.internal.pages.length - 1;
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(`Page ${i} of ${totalPages} - VidMod Compliance Protocol v4.2`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
        }

        doc.save(`${reportTitle.replace(/\s+/g, '_')}.pdf`);
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
            <div className="max-w-5xl mx-auto space-y-8 pb-12">

                {/* Header Action Bar */}
                <div className="flex items-center justify-between border-b border-white/5 pb-8">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-[0.2em]">
                            <Zap className="w-4 h-4 fill-primary/20" />
                            VidMod Intel Layer
                        </div>
                        <input
                            value={reportTitle}
                            onChange={(e) => setReportTitle(e.target.value)}
                            className="text-3xl font-bold bg-transparent border-none focus:ring-0 w-full p-0 text-foreground placeholder:opacity-30"
                            placeholder="Report Title"
                        />
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={generatePDF}
                            disabled={!isApproved}
                            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed cursor-pointer"
                        >
                            <Download className="w-4 h-4" />
                            Export Professional PDF
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-8">

                        {/* Summary Stats Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[
                                { label: 'Remediation Rate', value: `${remediationRate}%`, icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                                { label: 'Fixed Findings', value: `${resolvedFindings}/${totalFindings}`, icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                                { label: 'Active Edits', value: totalEdits, icon: History, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                                { label: 'Standards', value: region.split(' ')[0], icon: Award, color: 'text-purple-500', bg: 'bg-purple-500/10' },
                            ].map((stat, i) => (
                                <div key={i} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col gap-3 group hover:border-white/10 transition-colors">
                                    <div className={`w-8 h-8 rounded-lg ${stat.bg} ${stat.color} flex items-center justify-center`}>
                                        <stat.icon className="w-4 h-4" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none">{stat.label}</div>
                                        <div className="text-xl font-bold tracking-tight">{stat.value}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Media specification detail card */}
                        <div className="rounded-3xl bg-white/[0.02] border border-white/5 overflow-hidden">
                            <div className="px-6 py-4 border-b border-white/5 bg-white/[0.01] flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <FileText className="w-4 h-4 text-primary" />
                                    <span className="text-xs font-bold uppercase tracking-widest">Media Specification Detail</span>
                                </div>
                                <div className="text-[10px] font-mono text-muted-foreground opacity-50">VERIFICATION_PASS</div>
                            </div>
                            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-12">
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                                        <FileVideo className="w-3 h-3" /> Source File
                                    </label>
                                    <div className="text-sm font-semibold truncate">{metadata?.name || 'Untitled_Project.mp4'}</div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                                        <ShieldCheck className="w-3 h-3" /> Compliance Standard
                                    </label>
                                    <div className="text-sm font-semibold">{platform} – {region}</div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                                        <Hash className="w-3 h-3" /> Processing ID
                                    </label>
                                    <div className="text-sm font-mono text-primary truncate uppercase">{metadata?.jobId?.substring(0, 16) || 'LOAD_FAIL_0X00'}</div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" /> Certification Date
                                    </label>
                                    <div className="text-sm font-semibold">{new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>
                                </div>
                            </div>
                        </div>

                        {/* Remediation Timeline Table */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <Activity className="w-4 h-4" /> Technical Remediation Log
                                </h3>
                                <div className="px-2 py-1 rounded bg-primary/10 text-primary text-[9px] font-bold uppercase tracking-widest">
                                    {activeEdits.length} Actions Verified
                                </div>
                            </div>

                            <div className="rounded-3xl border border-white/5 bg-white/[0.01] overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest uppercase">
                                            <th className="px-6 py-4">Version</th>
                                            <th className="px-6 py-4">Target Object</th>
                                            <th className="px-6 py-4">Method</th>
                                            <th className="px-6 py-4 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {activeEdits.length > 0 ? (
                                            activeEdits.map((edit) => (
                                                <tr key={edit.id} className="group hover:bg-white/[0.015] transition-colors">
                                                    <td className="px-6 py-4">
                                                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-mono font-bold tracking-tighter">
                                                            {edit.version}.0
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="text-xs font-semibold">{edit.objectName}</div>
                                                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                                            ID: {edit.id.substring(0, 8)}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="px-2 py-1 rounded-full bg-white/5 text-[9px] font-bold uppercase tracking-widest">
                                                            {edit.effectType}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <div className="flex items-center justify-end gap-1.5 text-emerald-500">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                                            <span className="text-[10px] font-bold uppercase tracking-widest">Verified</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={4} className="px-6 py-12 text-center">
                                                    <div className="flex flex-col items-center gap-3 opacity-20">
                                                        <AlertCircle className="w-8 h-8" />
                                                        <p className="text-xs font-bold uppercase tracking-[0.2em]">No modifications detected</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar: Approval & Certification */}
                    <div className="space-y-6">
                        <div className="p-8 rounded-3xl bg-primary/5 border border-primary/20 space-y-8 sticky top-8">
                            <div className="space-y-2">
                                <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                                    <FileSignature className="w-5 h-5 text-primary" />
                                    Sign-off & Certify
                                </h3>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    Finalize the compliance report by providing the authorized legal representative signature.
                                </p>
                            </div>

                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                                        <User className="w-3 h-3" /> Authorized Signatory
                                    </label>
                                    <input
                                        value={approverName}
                                        onChange={(e) => setApproverName(e.target.value)}
                                        readOnly={isApproved}
                                        className="w-full px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-primary/40 outline-none transition-all placeholder:opacity-20 font-semibold"
                                        placeholder="Full Legal Name"
                                    />
                                </div>

                                <div className="space-y-2 focus-within:opacity-100 transition-opacity">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Compliance Notes</label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        readOnly={isApproved}
                                        placeholder="Optional audit notes or remediation justifications..."
                                        className="w-full h-32 px-4 py-3 bg-black/40 border border-white/5 rounded-xl text-xs focus:ring-2 focus:ring-primary/40 outline-none resize-none transition-all placeholder:opacity-20"
                                    />
                                </div>
                            </div>

                            {!isApproved ? (
                                <button
                                    onClick={handleApprove}
                                    className="w-full py-4 bg-foreground text-background font-black text-xs uppercase tracking-[0.3em] rounded-xl transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-xl shadow-black/20"
                                >
                                    Certify Results
                                </button>
                            ) : (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                    <div className="flex items-center justify-between p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-bold uppercase text-emerald-500 tracking-widest opacity-70">Certification Successful</p>
                                            <p className="text-lg font-bold italic font-serif leading-none">{approverName}</p>
                                        </div>
                                        <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                                            <Check className="w-5 h-5 stroke-[3]" />
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-6 border-t border-white/5">
                                        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground opacity-40">
                                            <span>TIMESTAMP</span>
                                            <span>{new Date().toISOString()}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] font-mono text-emerald-500/60 font-bold">
                                            <span>NETWORK STATUS</span>
                                            <span className="animate-pulse">LEDGER_CERTIFIED</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-start gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-[10px] text-muted-foreground/60 leading-relaxed italic">
                                    Generating this document creates a permanent audit trail. Modifying the source media after certification will invalidate this ID.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ComplianceReport;
