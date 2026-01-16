import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import VideoWorkspace, { type Finding } from './VideoWorkspace';
import RightPanel from './RightPanel';
import UploadZone, { type VideoMetadata } from './UploadZone';

const AppLayout: React.FC = () => {
    const [activeTab, setActiveTab] = useState('Upload');
    const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [currentTime, setCurrentTime] = useState(0);
    const [seekToTimestamp, setSeekToTimestamp] = useState<number | null>(null);
    const [platform, setPlatform] = useState('YouTube');
    const [region, setRegion] = useState('US');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Mock re-analysis when profile changes
    useEffect(() => {
        if (!videoUrl) return;

        setIsAnalyzing(true);
        const timer = setTimeout(() => {
            setIsAnalyzing(false);
        }, 1500);

        return () => clearTimeout(timer);
    }, [platform, region]);

    const handleFileSelected = (metadata: VideoMetadata) => {
        setVideoMetadata(metadata);
        setVideoUrl(metadata.url);
    };

    const handleUploadComplete = async (metadata: VideoMetadata) => {
        const jobId = metadata.jobId;
        if (!jobId) {
            console.error('No job_id available for analysis');
            setFindings([]);
            return;
        }

        setActiveTab('Analysis');
        setIsAnalyzing(true);
        try {
            // Call the Gemini analysis API
            const response = await fetch(`http://localhost:8000/api/analyze-video/${jobId}`, {
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

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
            {/* Sidebar - Fixed width */}
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} metadata={videoMetadata} />

            {/* Main Content Area */}
            <div className="flex flex-col flex-1 min-w-0">
                <TopBar
                    platform={platform}
                    region={region}
                    onPlatformChange={setPlatform}
                    onRegionChange={setRegion}
                />

                <main className="flex flex-1 overflow-hidden p-4 gap-4">
                    {activeTab === 'Upload' ? (
                        <div className="flex-1">
                            <UploadZone
                                onUploadComplete={handleUploadComplete}
                                onFileSelected={handleFileSelected}
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex-[3] min-w-0">
                                <VideoWorkspace
                                    videoUrl={videoUrl || ''}
                                    seekTo={seekToTimestamp ?? undefined}
                                    findings={findings}
                                    onTimeUpdate={setCurrentTime}
                                    onAddFinding={handleAddFinding}
                                />
                            </div>
                            <div className="flex-1 min-w-[300px] max-w-[400px]">
                                <RightPanel
                                    onSeekTo={handleSeekTo}
                                    findings={findings}
                                    currentTime={currentTime}
                                    isAnalyzing={isAnalyzing}
                                />
                            </div>
                        </>
                    )}
                </main>
            </div>
        </div>
    );
};

export default AppLayout;
