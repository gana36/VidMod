/**
 * VidMod API Service
 * Centralized API calls for backend integration
 */

export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api';

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
 * Analyze video with Gemini for compliance violations.
 * 
 * @param jobId - The job ID
 * @param platform - Target platform (e.g., "YouTube")
 * @param region - Target region (e.g., "Middle East", "United States")
 * @param rating - Target rating (e.g., "Kids (G)", "Teens (PG-13)")
 */
export async function analyzeVideo(
    jobId: string,
    platform?: string,
    region?: string,
    rating?: string
): Promise<AnalysisResponse> {
    // Build URL with query parameters for compliance policy
    const params = new URLSearchParams();
    if (platform) params.append('platform', platform);
    if (region) params.append('region', region);
    if (rating) params.append('rating', rating);

    const queryString = params.toString();
    const url = `${API_BASE}/analyze-video/${jobId}${queryString ? '?' + queryString : ''}`;

    const response = await fetch(url, {
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
 * Replace object using Runway Gen-4 with optional reference image for grounded replacement
 * Supports Smart Clipping - pass startTime/endTime to process only a portion of video
 * Now supports reference images via promptImage parameter for more accurate replacements
 */
export async function replaceWithRunway(
    jobId: string,
    prompt: string,
    referenceImage?: File,  // Optional reference image for grounded replacement
    negativePrompt: string = 'blurry, distorted, low quality, deformed',
    duration: number = 5,
    startTime?: number,
    endTime?: number,
    referenceImagePath?: string  // Alternatively, path to already-saved reference image
): Promise<ReplaceResponse> {
    const formData = new FormData();
    formData.append('job_id', jobId);
    formData.append('prompt', prompt);

    // Reference image - either file upload or path to generated image
    if (referenceImage) {
        formData.append('reference_image', referenceImage);
    }
    if (referenceImagePath) {
        formData.append('reference_image_path', referenceImagePath);
    }

    // Other parameters with defaults
    formData.append('negative_prompt', negativePrompt || 'blurry, distorted, low quality, deformed');
    formData.append('duration', duration.toString());

    // Smart Clipping - if timestamps provided, only process that portion
    if (startTime !== undefined) {
        formData.append('start_time', startTime.toString());
    }
    if (endTime !== undefined) {
        formData.append('end_time', endTime.toString());
    }

    const response = await fetch(`${API_BASE}/replace-with-runway`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Runway replacement failed: ${errorText}`);
    }

    return response.json();
}

// ============================================================================
// Reference Image Generation (Gemini 3)
// ============================================================================

export interface GenerateImageResponse {
    job_id: string;
    image_url: string;
    image_path: string;
    message: string;
}

/**
 * Generate a reference image using Gemini 3
 * Used when user doesn't have a reference image to upload
 * @param jobId - The job ID
 * @param prompt - Description of the image (e.g., "Coca-Cola bottle on white background")
 * @param aspectRatio - Image aspect ratio (default: "1:1" for product shots)
 * @param negativePrompt - What to avoid in generation
 */
export async function generateReferenceImage(
    jobId: string,
    prompt: string,
    aspectRatio: string = '1:1',
    negativePrompt?: string
): Promise<GenerateImageResponse> {
    const formData = new FormData();
    formData.append('job_id', jobId);
    formData.append('prompt', prompt);
    formData.append('aspect_ratio', aspectRatio);
    if (negativePrompt) {
        formData.append('negative_prompt', negativePrompt);
    }

    const response = await fetch(`${API_BASE}/generate-reference-image`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Image generation failed: ${errorText}`);
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

export interface ManualAction {
    id: string;
    type: string;
    label: string;
    description: string;
}

export interface ManualAnalysisResponse {
    job_id: string;
    item_name: string;
    reasoning: string;
    suggested_actions: ManualAction[];
    confidence: string;
}

/**
 * Analyze a manually drawn bounding box using Gemini
 */
export async function analyzeManual(
    jobId: string,
    timestamp: number,
    box: { top: number; left: number; width: number; height: number }
): Promise<ManualAnalysisResponse> {
    const response = await fetch(`${API_BASE}/analyze-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            timestamp: timestamp,
            box: {
                x1: box.left / 100,
                y1: box.top / 100,
                x2: (box.left + box.width) / 100,
                y2: (box.top + box.height) / 100,
            }
        }),
    });

    if (!response.ok) {
        throw new Error(`Manual analysis failed: ${response.statusText}`);
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

// ============================================================================
// Audio Censoring
// ============================================================================

export interface ProfanityMatch {
    word: string;
    start_time: number;
    end_time: number;
    replacement: string;
    confidence: string;
    context: string;
    speaker_id?: string;
}

export interface CensorAudioResponse {
    job_id: string;
    status: string;
    profanity_count: number;
    words_detected: string[];
    matches: ProfanityMatch[];
    download_path?: string;
    message: string;
    mode: 'beep' | 'dub';
}

/**
 * Censor profanity in video audio
 * Modes:
 * - beep: Fast, free - overlay beep sounds (like TV censoring)
 * - dub: Premium - ElevenLabs voice cloning for seamless replacement
 */
export async function censorAudio(
    jobId: string,
    mode: 'beep' | 'dub' | 'clone' | 'auto',
    voiceSampleStart?: number,
    voiceSampleEnd?: number,
    customWords?: string[],
    customReplacements?: Record<string, string>,
    profanityMatches?: Array<{
        word: string;
        start_time: number;
        end_time: number;
        replacement: string;
        confidence?: string;
        context?: string;
        speaker_id?: string;
    }>
): Promise<CensorAudioResponse> {
    const response = await fetch(`${API_BASE}/censor-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            mode: mode,
            voice_sample_start: voiceSampleStart,
            voice_sample_end: voiceSampleEnd,
            custom_words: customWords,
            custom_replacements: customReplacements,
            profanity_matches: profanityMatches,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Audio censoring failed: ${errorText}`);
    }

    return response.json();
}

// ============================================================================
// Word Suggestions (Gemini-powered)
// ============================================================================

export interface WordSuggestion {
    original_word: string;
    suggestions: string[];
    duration: number;
}

export interface SuggestReplacementsResponse {
    job_id: string;
    suggestions: WordSuggestion[];
    message: string;
}

/**
 * Get Gemini-powered word suggestions that match duration
 */
export async function suggestReplacements(
    jobId: string,
    wordsToReplace: string[]
): Promise<SuggestReplacementsResponse> {
    const response = await fetch(`${API_BASE}/suggest-replacements/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            words_to_replace: wordsToReplace,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Word suggestion failed: ${errorText}`);
    }

    return response.json();
}

export interface AnalyzeAudioResponse {
    job_id: string;
    profanity_count: number;
    matches: ProfanityMatch[];
}

/**
 * Analyze audio for profanity detection only (no censoring)
 * Returns detected words with timestamps for UI display
 */
export async function analyzeAudio(
    jobId: string
): Promise<AnalyzeAudioResponse> {
    const response = await fetch(`${API_BASE}/analyze-audio/${jobId}`);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Audio analysis failed: ${errorText}`);
    }

    return response.json();
}
