/**
 * VidMod API Service
 * Centralized API calls for backend integration
 */

const API_BASE = 'http://localhost:8000/api';

export interface VideoUploadResponse {
    job_id: string;
    message: string;
    preview_frame_url: string;
    video_info: {
        duration: number;
        fps: number;
        width: number;
        height: number;
    };
}

export interface Finding {
    id: number;
    type: string;
    category: 'alcohol' | 'logo' | 'violence' | 'language' | 'other';
    content: string;
    status: 'warning' | 'critical';
    confidence: 'Low' | 'Medium' | 'High';
    startTime: number;
    endTime: number;
    context?: string;
    suggestedAction?: string;
    box?: {
        top: number;
        left: number;
        width: number;
        height: number;
    };
}

export interface AnalysisResponse {
    job_id: string;
    status: string;
    findings: Finding[];
    summary: string;
    riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical';
    predictedAgeRating: string;
}

export interface Sam3SegmentResponse {
    job_id: string;
    status: string;
    download_path?: string;
    output_url?: string;
    text_prompt: string;
    message: string;
}

export interface ReplaceResponse {
    job_id: string;
    status: string;
    download_path?: string;
    message: string;
}

export interface JobStatusResponse {
    job_id: string;
    status: string;
    progress: number;
    current_step: string;
    error?: string;
}

/**
 * Upload a video file
 */
export async function uploadVideo(file: File): Promise<VideoUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Analyze video with Gemini for compliance violations
 */
export async function analyzeVideo(jobId: string): Promise<AnalysisResponse> {
    const response = await fetch(`${API_BASE}/analyze-video/${jobId}`, {
        method: 'POST',
    });

    if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Segment video using SAM3 with text prompt
 */
export async function segmentWithSAM3(
    jobId: string,
    textPrompt: string,
    maskOnly: boolean = true,
    maskColor: string = 'green',
    maskOpacity: number = 0.5
): Promise<Sam3SegmentResponse> {
    const response = await fetch(`${API_BASE}/segment-video-sam3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            text_prompt: textPrompt,
            mask_only: maskOnly,
            mask_color: maskColor,
            mask_opacity: maskOpacity,
        }),
    });

    if (!response.ok) {
        throw new Error(`SAM3 segmentation failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Replace object using Pika Labs (requires reference image)
 */
export async function replaceWithPika(
    jobId: string,
    prompt: string,
    referenceImage: File,
    negativePrompt: string = 'blurry, distorted, low quality, deformed',
    duration: number = 5
): Promise<ReplaceResponse> {
    const formData = new FormData();
    formData.append('job_id', jobId);
    formData.append('prompt', prompt);
    formData.append('reference_image', referenceImage);
    formData.append('negative_prompt', negativePrompt);
    formData.append('duration', duration.toString());

    const response = await fetch(`${API_BASE}/replace-with-pika`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Pika replacement failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Replace object using VACE (prompt only, requires SAM3 mask first)
 */
export async function replaceWithVACE(
    jobId: string,
    prompt: string,
    numInferenceSteps: number = 30,
    guidanceScale: number = 5.0
): Promise<ReplaceResponse> {
    const response = await fetch(`${API_BASE}/replace-with-vace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            prompt: prompt,
            num_inference_steps: numInferenceSteps,
            guidance_scale: guidanceScale,
        }),
    });

    if (!response.ok) {
        throw new Error(`VACE replacement failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await fetch(`${API_BASE}/status/${jobId}`);

    if (!response.ok) {
        throw new Error(`Failed to get status: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Get download URL for processed video
 */
export function getDownloadUrl(jobId: string): string {
    return `${API_BASE}/download/${jobId}`;
}

/**
 * Get download URL for segmented video
 */
export function getSegmentedDownloadUrl(jobId: string): string {
    return `${API_BASE}/download-segmented/${jobId}`;
}

/**
 * Download processed video
 */
export async function downloadVideo(jobId: string): Promise<Blob> {
    const response = await fetch(getDownloadUrl(jobId));

    if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
    }

    return response.blob();
}

export interface BlurEffectResponse {
    job_id: string;
    status: string;
    download_path?: string;
    text_prompt: string;
    effect_type: string;
    message: string;
}

/**
 * Apply blur/pixelate effect to detected object (like Meta's Segment Anything)
 * This combines SAM3 mask + FFmpeg blur in one call
 */
export async function blurObject(
    jobId: string,
    textPrompt: string,
    blurStrength: number = 30,
    effectType: 'blur' | 'pixelate' = 'blur',
    startTime?: number,
    endTime?: number
): Promise<BlurEffectResponse> {
    const response = await fetch(`${API_BASE}/blur-object`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            text_prompt: textPrompt,
            blur_strength: blurStrength,
            effect_type: effectType,
            start_time: startTime,
            end_time: endTime,
        }),
    });

    if (!response.ok) {
        throw new Error(`Blur effect failed: ${response.statusText}`);
    }

    return response.json();
}

export interface ObjectDetectionResponse {
    suggestions: string[];
}

/**
 * Detect objects within a bounding box using Gemini
 */
export async function detectObjects(
    jobId: string,
    timestamp: number,
    box: { top: number; left: number; width: number; height: number }
): Promise<ObjectDetectionResponse> {
    const response = await fetch(`${API_BASE}/detect-objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            timestamp: timestamp,
            box: box,
        }),
    });

    if (!response.ok) {
        throw new Error(`Object detection failed: ${response.statusText}`);
    }

    return response.json();
}
