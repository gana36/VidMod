import React, { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import VideoWorkspace from './VideoWorkspace';
import RightPanel from './RightPanel';

const AppLayout: React.FC = () => {
    const [activeTab, setActiveTab] = useState('Analysis');

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
            {/* Sidebar - Fixed width */}
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

            {/* Main Content Area */}
            <div className="flex flex-col flex-1 min-w-0">
                <TopBar />

                <main className="flex flex-1 overflow-hidden p-4 gap-4">
                    <div className="flex-[3] min-w-0">
                        <VideoWorkspace />
                    </div>
                    <div className="flex-1 min-w-[300px] max-w-[400px]">
                        <RightPanel activeTab={activeTab} />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default AppLayout;
