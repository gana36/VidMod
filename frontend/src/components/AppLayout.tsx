import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import VideoWorkspace, { type Finding } from './VideoWorkspace';
import RightPanel from './RightPanel';
import UploadZone, { type VideoMetadata } from './UploadZone';
import { resolvePolicy } from '../services/policyEngine';
import { VideoLibrary } from './VideoLibrary';
import ComplianceReport from './ComplianceReport';

// Edit version interface for tracking history
export interface EditVersion {
    id: string;
    version: number;
    objectName: string;
    effectType: string;
    downloadUrl: string;
    enabled: boolean;
    timestamp: number;
}

const AppLayout: React.FC = () => {
    const [activeTab, setActiveTab] = useState('Upload');
    const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
    const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);  // Original video
    const [editedVideoUrl, setEditedVideoUrl] = useState<string | null>(null);      // Current processed video
    const [showOriginal, setShowOriginal] = useState(false);  // Toggle state
    const [findings, setFindings] = useState<Finding[]>([]);
    const [currentTime, setCurrentTime] = useState(0);
    const [seekToTimestamp, setSeekToTimestamp] = useState<number | null>(null);
    const [platform, setPlatform] = useState('YouTube');
    const [region, setRegion] = useState('Middle East');
    const [rating, setRating] = useState('Teens (PG-13)');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);  // Job ID for API actions

    // Edit history - tracks all applied effects with their versions
    const [editHistory, setEditHistory] = useState<EditVersion[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);  // For previewing specific version

    // Video library modal state
    const [showVideoLibrary, setShowVideoLibrary] = useState(false);

    // Current video to display
    const getDisplayVideoUrl = () => {
        if (showOriginal) {
            console.log('Showing original video');
            return originalVideoUrl;
        }
        if (selectedVersion !== null) {
            const version = editHistory.find(v => v.version === selectedVersion);
            console.log('Showing selected version:', selectedVersion, 'URL:', version?.downloadUrl);
            return version?.downloadUrl || editedVideoUrl || originalVideoUrl;
        }
        console.log('Showing latest edited video:', editedVideoUrl);
        return editedVideoUrl || originalVideoUrl;
    };
    const currentVideoUrl = getDisplayVideoUrl();

    // Mock re-analysis when profile changes
    useEffect(() => {
        if (!originalVideoUrl) return;

        setIsAnalyzing(true);
        const timer = setTimeout(() => {
            setIsAnalyzing(false);
        }, 1500);

        return () => clearTimeout(timer);
    }, [platform, region, rating]);

    const handleFileSelected = (metadata: VideoMetadata) => {
        setVideoMetadata(metadata);
        setOriginalVideoUrl(metadata.url);
        setEditedVideoUrl(null);  // Reset edited video
        setEditHistory([]);  // Reset edit history
        setSelectedVersion(null);
        setShowOriginal(false);
    };

    const handleUploadComplete = async (metadata: VideoMetadata) => {
        const uploadedJobId = metadata.jobId;
        if (!uploadedJobId) {
            console.error('No job_id available for analysis');
            setFindings([]);
            return;
        }

        setJobId(uploadedJobId);  // Store job ID for actions
        setActiveTab('Analysis');
        setIsAnalyzing(true);
        try {
            // Call the Gemini analysis API
            const response = await fetch(`http://localhost:8000/api/analyze-video/${uploadedJobId}`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error(`Analysis failed: ${response.statusText}`);
            }

            const data = await response.json();

            // Map API response to Finding[] format
            const mappedFindings: Finding[] = (data.findings || []).map((f: any) => ({
                id: f.id,
                type: f.type,
                category: f.category || 'other',
                content: f.content,
                status: f.status || 'warning',
                confidence: f.confidence || 'Medium',
                startTime: f.startTime,
                endTime: f.endTime,
                context: f.context,
                suggestedAction: f.suggestedAction,
                box: f.box
            }));

            setFindings(mappedFindings);
            console.log('Gemini analysis complete:', data.summary);
        } catch (error) {
            console.error('Analysis failed:', error);
            // Fallback to empty findings on error
            setFindings([]);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Handle video selection from library
    const handleLibraryVideoSelect = async (jobId: string) => {
        // When a video is selected from library, it creates a job
        // Just need to set the job ID and navigate to analysis
        setJobId(jobId);
        setActiveTab('Analysis');
        setIsAnalyzing(true);

        try {
            const response = await fetch(`http://localhost:8000/api/analyze-video/${jobId}`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error(`Analysis failed: ${response.statusText}`);
            }

            const data = await response.json();
            const mappedFindings: Finding[] = (data.findings || []).map((f: any) => ({
                id: f.id,
                type: f.type,
                category: f.category || 'other',
                content: f.content,
                status: f.status || 'warning',
                confidence: f.confidence || 'Medium',
                startTime: f.startTime,
                endTime: f.endTime,
                context: f.context,
                suggestedAction: f.suggestedAction,
                box: f.box
            }));

            setFindings(mappedFindings);
        } catch (error) {
            console.error('Analysis failed:', error);
            setFindings([]);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAddFinding = (newFinding: Omit<Finding, 'id'>) => {
        const id = findings.length > 0 ? Math.max(...findings.map(f => f.id)) + 1 : 1;
        setFindings(prev => [...prev, { ...newFinding, id }]);
    };

    const handleSeekTo = (time: string) => {
        // Convert "MM:SS" or "00:SS" to seconds
        const parts = time.split(':');
        const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        setSeekToTimestamp(seconds);
        // Reset after passing
        setTimeout(() => setSeekToTimestamp(null), 100);
    };

    const handleActionComplete = (actionType: string, result: any) => {
        console.log(`Action ${actionType} completed:`, result);

        // Update edited video URL to show the processed result
        if (result.downloadUrl) {
            // Add timestamp to force refresh
            const processedUrl = `${result.downloadUrl}?t=${Date.now()}`;
            setEditedVideoUrl(processedUrl);
            setShowOriginal(false);  // Show edited by default after processing
            setSelectedVersion(null);  // Show latest version

            // Add to edit history with correct version number
            setEditHistory(prev => {
                const newVersion: EditVersion = {
                    id: `edit-${Date.now()}`,
                    version: prev.length + 1,  // Use prev.length for correct numbering
                    objectName: result.objectName || result.text_prompt || 'Object',
                    effectType: actionType,
                    downloadUrl: processedUrl,
                    enabled: true,
                    timestamp: Date.now()
                };
                console.log('Added version to history:', newVersion);
                return [...prev, newVersion];
            });
        }
    };

    // Preview a specific version
    const handlePreviewVersion = (version: number) => {
        console.log('Preview version clicked:', version);
        console.log('Current editHistory:', editHistory);
        const found = editHistory.find(v => v.version === version);
        console.log('Found version:', found);
        setSelectedVersion(version);
        setShowOriginal(false);
    };

    // Toggle version enabled state (for future re-compositing)
    const handleToggleVersion = (id: string) => {
        setEditHistory(prev => prev.map(v =>
            v.id === id ? { ...v, enabled: !v.enabled } : v
        ));
    };

    // Right Panel Resizing Logic
    const [rightPanelWidth, setRightPanelWidth] = useState(380);
    const [isResizing, setIsResizing] = useState(false);

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((mouseMoveEvent: MouseEvent) => {
        if (isResizing) {
            const newWidth = window.innerWidth - mouseMoveEvent.clientX;
            if (newWidth >= 300 && newWidth <= 600) {
                setRightPanelWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    const activePolicy = resolvePolicy(platform, rating, region);

    return (
        <div className={`flex h-screen w-full overflow-hidden bg-background text-foreground ${isResizing ? 'cursor-col-resize select-none' : ''}`}>
            {/* Sidebar - Fixed width */}
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                metadata={videoMetadata}
                policy={activePolicy}
            />

            {/* Main Content Area */}
            <div className="flex flex-col flex-1 min-w-0">
                <TopBar
                    platform={platform}
                    region={region}
                    rating={rating}
                    isAnalyzing={isAnalyzing}
                    hasVideo={!!originalVideoUrl}
                />

                <main className="flex flex-1 overflow-hidden relative">
                    {activeTab === 'Upload' ? (
                        <div className="flex-1 p-4">
                            <UploadZone
                                platform={platform}
                                region={region}
                                rating={rating}
                                onPlatformChange={setPlatform}
                                onRegionChange={setRegion}
                                onRatingChange={setRating}
                                onUploadComplete={handleUploadComplete}
                                onFileSelected={handleFileSelected}
                                onBrowseLibrary={() => setShowVideoLibrary(true)}
                            />

                            {/* Video Library Modal */}
                            {showVideoLibrary && (
                                <VideoLibrary
                                    onVideoSelect={handleLibraryVideoSelect}
                                    onClose={() => setShowVideoLibrary(false)}
                                />
                            )}
                        </div>
                    ) : activeTab === 'Compliance' ? (
                        <ComplianceReport
                            findings={findings}
                            editHistory={editHistory}
                            metadata={videoMetadata}
                            platform={platform}
                            region={region}
                            rating={rating}
                        />
                    ) : (
                        <div className="flex-1 relative flex overflow-hidden">
                            {/* 1. Video Space (Flex-grow) */}
                            <div className="flex-1 relative min-w-0 h-full overflow-hidden p-4 pr-0">
                                <VideoWorkspace
                                    videoUrl={currentVideoUrl || ''}
                                    seekTo={seekToTimestamp ?? undefined}
                                    findings={findings}
                                    jobId={jobId || undefined}
                                    onTimeUpdate={setCurrentTime}
                                    onAddFinding={handleAddFinding}
                                />

                                {/* Status Indicator/Toggle Button */}
                                {editedVideoUrl && (
                                    <button
                                        onClick={() => setShowOriginal(!showOriginal)}
                                        className={`absolute top-10 left-10 z-20 flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-2xl glass-panel border-white/10 cursor-pointer ${showOriginal
                                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30'
                                            : 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                                            }`}
                                    >
                                        <div className="relative flex items-center justify-center w-2 h-2 mr-1">
                                            <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${showOriginal ? 'bg-amber-400' : 'bg-primary'}`} />
                                            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${showOriginal ? 'bg-amber-400' : 'bg-primary'}`} />
                                        </div>
                                        {showOriginal ? 'Original' : 'Remediated'}
                                    </button>
                                )}
                            </div>

                            {/* 2. Base Spacer - Reserves space for the RightPanel initially */}
                            <div className="flex-none w-[380px] h-full pointer-events-none" />

                            {/* 3. Absolute Right Panel Overlay */}
                            <div
                                className="absolute right-0 top-0 h-full z-[100] flex border-l border-white/5 bg-background/20 backdrop-blur-3xl"
                                style={{
                                    width: Math.max(380, rightPanelWidth),
                                    boxShadow: rightPanelWidth > 380 ? '-20px 0 50px rgba(0,0,0,0.5)' : 'none'
                                }}
                            >
                                {/* Resize Handle */}
                                <div
                                    className="absolute -left-1 top-0 w-2 h-full cursor-col-resize hover:bg-primary/20 transition-colors flex items-center justify-center group z-[110]"
                                    onMouseDown={startResizing}
                                >
                                    <div className={`w-0.5 h-16 rounded-full bg-white/10 group-hover:bg-primary/50 transition-colors ${isResizing ? 'bg-primary' : ''}`} />
                                </div>

                                <div className="flex-1 h-full p-4 overflow-hidden">
                                    <RightPanel
                                        onSeekTo={handleSeekTo}
                                        findings={findings}
                                        currentTime={currentTime}
                                        isAnalyzing={isAnalyzing}
                                        jobId={jobId || undefined}
                                        onActionComplete={handleActionComplete}
                                        editHistory={editHistory}
                                        onPreviewVersion={handlePreviewVersion}
                                        onToggleVersion={handleToggleVersion}
                                        selectedVersion={selectedVersion}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div >
        </div >
    );
};

export default AppLayout;
