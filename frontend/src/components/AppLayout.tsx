import React, { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import VideoWorkspace, { type Finding } from './VideoWorkspace';
import RightPanel from './RightPanel';
import UploadZone, { type VideoMetadata } from './UploadZone';

const MOCK_FINDINGS: Finding[] = [
    {
        id: 1,
        type: 'Brand Identification',
        category: 'logo',
        content: 'Coca-Cola Logo',
        status: 'warning',
        confidence: 'High',
        startTime: 2,
        endTime: 5,
        box: { top: 20, left: 30, width: 15, height: 10 }
    },
    {
        id: 2,
        type: 'Restricted Content',
        category: 'alcohol',
        content: 'Alcoholic Beverage',
        status: 'critical',
        confidence: 'Medium',
        startTime: 8,
        endTime: 12,
        box: { top: 60, left: 45, width: 20, height: 15 }
    },
    {
        id: 3,
        type: 'Explicit Language',
        category: 'language',
        content: 'Profanity Detected',
        status: 'critical',
        confidence: 'High',
        startTime: 12,
        endTime: 14
    },
    {
        id: 4,
        type: 'Visual Violence',
        category: 'violence',
        content: 'Aggressive Motion',
        status: 'warning',
        confidence: 'Low',
        startTime: 16,
        endTime: 18,
        box: { top: 30, left: 10, width: 40, height: 40 }
    },
];

const AppLayout: React.FC = () => {
    const [activeTab, setActiveTab] = useState('Upload');
    const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [findings, setFindings] = useState<Finding[]>([]);
    const [currentTime, setCurrentTime] = useState(0);

    // We'll use a ref to expose a seek function or similar if needed, 
    // but for simple local interactivity, we can pass a timestamp to seek to.
    const [seekToTimestamp, setSeekToTimestamp] = useState<number | null>(null);

    const handleFileSelected = (metadata: VideoMetadata) => {
        setVideoMetadata(metadata);
        setVideoUrl(metadata.url);
        setActiveTab('Analysis');
    };

    const handleUploadComplete = () => {
        setFindings(MOCK_FINDINGS);
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
                <TopBar />

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
                                />
                            </div>
                            <div className="flex-1 min-w-[300px] max-w-[400px]">
                                <RightPanel
                                    onSeekTo={handleSeekTo}
                                    findings={findings}
                                    currentTime={currentTime}
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
