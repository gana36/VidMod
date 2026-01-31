"""
VidMod Video Processing Router
API endpoints for video upload, detection, replacement, and download.
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends, Form
from fastapi.responses import FileResponse

from ..config import Settings, get_settings
from ..models import (
    VideoUploadResponse,
    DetectionRequest,
    DetectionResponse,
    ReplacementRequest,
    ReplacementResponse,
    JobStatusResponse,
    JobStatus,
    VideoSegmentRequest,
    VideoSegmentResponse,
    ClickCoordinate,
    TextVideoSegmentRequest,
    Sam3SegmentRequest,
    Sam3SegmentResponse,
    ReplaceObjectRequest,
    ReplaceObjectResponse,
    FramewiseReplaceRequest,
    FramewiseReplaceResponse,
    VaceReplaceRequest,
    VaceReplaceResponse,
    NanoBananaRequest,
    NanoBananaResponse,
    PikaReplaceRequest,
    PikaReplaceResponse,
    RunwayReplaceRequest,
    RunwayReplaceResponse,
    BlurEffectRequest,
    BlurEffectResponse,
    ManualAction,
    ManualAnalysisRequest,
    ManualAnalysisResponse,
    ObjectDetectionRequest,
    ObjectDetectionResponse,
    VideoMetadata,
    UseExistingVideoRequest,
    CensorAudioRequest,
    CensorAudioResponse,
    ProfanityMatch as ProfanityMatchModel,
    SuggestReplacementsRequest,
    SuggestReplacementsResponse,
    WordSuggestion
)
from core.pipeline import VideoPipeline, PipelineStage
from core.gemini_video_analyzer import GeminiVideoAnalyzer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["video"])

# Pipeline instance (initialized on first request)
_pipeline: Optional[VideoPipeline] = None


def get_pipeline(settings: Settings = Depends(get_settings)) -> VideoPipeline:
    """Get or create pipeline instance."""
    global _pipeline
    if _pipeline is None:
        _pipeline = VideoPipeline(
            replicate_api_token=settings.replicate_api_token,
            base_storage_dir=settings.base_dir / "storage" / "jobs",
            keyframe_interval=settings.keyframe_interval,
            ffmpeg_path=settings.get_ffmpeg_path(),
            ffprobe_path=settings.get_ffprobe_path(),
            aws_bucket_name=settings.aws_s3_bucket_name if settings.aws_s3_bucket_name else None,
            aws_region=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id if settings.aws_access_key_id else None,
            aws_secret_access_key=settings.aws_secret_access_key if settings.aws_secret_access_key else None
        )
    return _pipeline


@router.post("/detect-objects", response_model=ObjectDetectionResponse)
async def detect_objects(
    request: ObjectDetectionRequest,
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Detect objects within a user-defined bounding box using Gemini.
    1. Extract frame crop at timestamp.
    2. Send to Gemini 2.0 Flash to identify object(s).
    """
    logger.info(f"Detecting objects for job {request.job_id} at {request.timestamp}s")
    
    # 1. Get Job
    job = pipeline.jobs.get(request.job_id)
    if not job:
        # Try to load logic if job exists on disk but not memory (restart scenario)
        potential_path = settings.base_dir / "storage" / "jobs" / request.job_id
        if potential_path.exists():
            from core.pipeline import JobState
            job = JobState(
                job_id=request.job_id,
                video_path=potential_path / "input.mp4",
                output_dir=potential_path,
                frames_dir=potential_path / "frames",
                status="loaded"
            )
            pipeline.jobs[request.job_id] = job
        else:
            raise HTTPException(status_code=404, detail="Job not found")

    # 2. Extract specific crop
    crop_path = job.output_dir / f"crop_{int(request.timestamp * 1000)}.jpg"
    
    try:
        pipeline.frame_extractor.extract_frame_crop(
            video_path=job.video_path,
            output_path=crop_path,
            timestamp=request.timestamp,
            box=request.box
        )
    except Exception as e:
        logger.error(f"Failed to extract crop: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract image crop")

    # 3. Analyze with Gemini
    try:
        analyzer = GeminiVideoAnalyzer(api_key=settings.gemini_api_key)
        suggestions = analyzer.identify_objects_in_image(crop_path)
        
        # Cleanup
        if crop_path.exists():
            crop_path.unlink()
            
        return ObjectDetectionResponse(suggestions=suggestions)
        
    except Exception as e:
        logger.error(f"Gemini analysis failed: {e}")
        # Return empty list rather than 500 so UI can still function manually
        return ObjectDetectionResponse(suggestions=[])



@router.post("/upload", response_model=VideoUploadResponse)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Upload a video file and return a job ID immediately.
    Heavy frame extraction is moved to background tasks.
    """
    # Validate file type
    allowed_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    file_ext = Path(file.filename).suffix.lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {allowed_extensions}"
        )
    
    # Save uploaded file temporarily
    temp_path = settings.upload_path / f"temp_{file.filename}"
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Create job
        job = pipeline.create_job(temp_path)
        
        # 1. Extract video metadata synchronously (FAST)
        video_info = pipeline.frame_extractor.get_video_info(job.video_path)
        job.video_info = video_info
        
        # 2. Extract a single preview frame synchronously (FAST)
        preview_filename = "frame_000000.png"
        preview_path = job.frames_dir / preview_filename
        job.frames_dir.mkdir(parents=True, exist_ok=True)
        pipeline.frame_extractor.extract_single_frame(job.video_path, preview_path, timestamp=0)
        job.frame_paths = [preview_path]
        
        # 3. Schedule full frame extraction in the background (HEAVY)
        background_tasks.add_task(pipeline.extract_frames, job.job_id)
        
        preview_url = f"/api/preview/{job.job_id}/frame/0"
        
        return VideoUploadResponse(
            job_id=job.job_id,
            message="Video uploaded successfully. Analysis and frame extraction starting in background.",
            preview_frame_url=preview_url,
            video_info=video_info
        )
        
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Cleanup temp file
        if temp_path.exists():
            temp_path.unlink()


@router.get("/download/{job_id}")
async def download_video(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Download the processed video for a job.
    Returns the edited video if available, otherwise the original video.
    """
    from fastapi.responses import FileResponse
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Serve edited video if available, otherwise original
    if job.output_path and job.output_path.exists():
        video_path = job.output_path
        logger.info(f"Serving edited video: {video_path}")
    elif job.video_path and job.video_path.exists():
        video_path = job.video_path
        logger.info(f"Serving original video: {video_path}")
    else:
        raise HTTPException(status_code=404, detail="Video file not found")
    
    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"{job_id}.mp4"
    )


@router.get("/videos", response_model=List[VideoMetadata])
async def list_videos(pipeline: VideoPipeline = Depends(get_pipeline)):
    """
    List all videos available in S3 bucket.
    Returns empty list if S3 is not configured.
    """
    if not pipeline.s3_uploader:
        logger.warning("S3 not configured, returning empty video list")
        return []
    
    try:
        videos = pipeline.s3_uploader.list_videos(prefix="jobs/")
        logger.info(f"Found {len(videos)} videos in S3")
        return videos
    except Exception as e:
        logger.error(f"Failed to list S3 videos: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list videos: {str(e)}")


@router.post("/use-existing-video", response_model=VideoUploadResponse)
async def use_existing_video(
    request: UseExistingVideoRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Create a job from an existing S3 video without re-uploading.
    This allows users to reuse videos they've already uploaded.
    """
    if not pipeline.s3_uploader:
        raise HTTPException(status_code=501, detail="S3 not configured")
    
    try:
        from core.pipeline import JobState
        import uuid
        import httpx
        from pathlib import Path
        
        # Extract job_id from S3 URL (e.g., jobs/abc123/input.mp4 -> abc123)
        s3_key_parts = request.s3_url.split('/')
        existing_job_id = None
        if 'jobs' in s3_key_parts:
            idx = s3_key_parts.index('jobs')
            if idx + 1 < len(s3_key_parts):
                existing_job_id = s3_key_parts[idx + 1]
        
        # Check if we already have this video locally (from previous upload)
        if existing_job_id:
            existing_job_dir = Path(pipeline.storage_path) / "jobs" / existing_job_id
            existing_video_path = existing_job_dir / "input.mp4"
            
            if existing_video_path.exists():
                logger.info(f"♻️ Reusing existing local job: {existing_job_id}")
                
                # Check if job already exists in pipeline
                if existing_job_id in pipeline.jobs:
                    job = pipeline.jobs[existing_job_id]
                    logger.info(f"Job {existing_job_id} already in memory")
                else:
                    # Recreate job from existing files
                    job = JobState(
                        job_id=existing_job_id,
                        video_path=existing_video_path,
                        s3_url=request.s3_url,
                        frames_dir=None,
                        masks_dir=None,
                        inpainted_dir=None,
                        output_path=None
                    )
                    pipeline.jobs[job.job_id] = job
                    logger.info(f"Restored job {existing_job_id} from local files")
                
                filename = request.filename or request.s3_url.split("/")[-1]
                return VideoUploadResponse(
                    job_id=job.job_id,
                    message=f"Using existing video from library: {filename}",
                    preview_frame_url="",
                    video_info={"source": "s3_library_local", "url": request.s3_url}
                )
        
        # If not found locally, download from S3 (new job)
        logger.info(f"📥 Video not found locally, downloading from S3...")
        job_id = str(uuid.uuid4())[:8]
        job_dir = Path(pipeline.storage_path) / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        filename = request.filename or request.s3_url.split("/")[-1]
        local_video_path = job_dir / "input.mp4"
        
        logger.info(f"Downloading S3 video to local storage: {request.s3_url}")
        response = httpx.get(request.s3_url, follow_redirects=True)
        response.raise_for_status()
        with open(local_video_path, 'wb') as f:
            f.write(response.content)
        logger.info(f"Video downloaded: {local_video_path}")
        
        # Create new job
        job = JobState(
            job_id=job_id,
            video_path=local_video_path,
            s3_url=request.s3_url,
            frames_dir=None,
            masks_dir=None,
            inpainted_dir=None,
            output_path=None
        )
        
        pipeline.jobs[job.job_id] = job
        
        logger.info(f"Created new job {job.job_id} from S3 video: {request.s3_url}")
        
        return VideoUploadResponse(
            job_id=job.job_id,
            message=f"Downloaded from library: {filename}",
            preview_frame_url="",
            video_info={"source": "s3_library_download", "url": request.s3_url}
        )
        
    except Exception as e:
        logger.error(f"Failed to create job from S3 video: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/detect", response_model=DetectionResponse)
async def detect_object(
    request: DetectionRequest,
    background_tasks: BackgroundTasks,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Detect and mask an object in the video.
    Supports text prompts or bounding box selection.
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not request.text_prompt and not request.bounding_box:
        raise HTTPException(
            status_code=400,
            detail="Either text_prompt or bounding_box is required"
        )
    
    try:
        # Convert bounding box to tuple if provided
        bbox = None
        if request.bounding_box:
            bbox = (
                request.bounding_box.x1,
                request.bounding_box.y1,
                request.bounding_box.x2,
                request.bounding_box.y2
            )
        
        # Run detection
        pipeline.detect_object(
            request.job_id,
            text_prompt=request.text_prompt,
            bounding_box=bbox
        )
        
        valid_masks = sum(1 for m in job.mask_paths if m and m.exists())
        
        return DetectionResponse(
            job_id=request.job_id,
            status="completed",
            masks_generated=valid_masks,
            preview_mask_url=f"/api/preview/{request.job_id}/mask/0"
        )
        
    except Exception as e:
        logger.error(f"Detection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace", response_model=ReplacementResponse)
async def replace_object(
    request: ReplacementRequest,
    background_tasks: BackgroundTasks,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace the detected object with new content.
    Supports text prompts or reference images.
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.mask_paths:
        raise HTTPException(
            status_code=400,
            detail="No masks found. Run /detect first."
        )
    
    if not request.replacement_prompt and not request.replacement_image_base64:
        raise HTTPException(
            status_code=400,
            detail="Either replacement_prompt or replacement_image_base64 is required"
        )
    
    try:
        # Run inpainting and reconstruction
        pipeline.replace_object(
            request.job_id,
            replacement_prompt=request.replacement_prompt,
            replacement_image=request.replacement_image_base64
        )
        
        pipeline.reconstruct_video(request.job_id)
        
        return ReplacementResponse(
            job_id=request.job_id,
            status="completed",
            message="Video processing complete. Use /download to get the result."
        )
        
    except Exception as e:
        logger.error(f"Replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Get the current status of a processing job."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Map pipeline stage to job status
    stage_map = {
        PipelineStage.INITIALIZED: JobStatus.PENDING,
        PipelineStage.EXTRACTING_FRAMES: JobStatus.EXTRACTING_FRAMES,
        PipelineStage.DETECTING_OBJECTS: JobStatus.DETECTING_OBJECTS,
        PipelineStage.GENERATING_MASKS: JobStatus.GENERATING_MASKS,
        PipelineStage.VIDEO_SEGMENTING: JobStatus.GENERATING_MASKS,  # Map to existing status
        PipelineStage.INPAINTING: JobStatus.INPAINTING,
        PipelineStage.RECONSTRUCTING: JobStatus.RECONSTRUCTING,
        PipelineStage.COMPLETED: JobStatus.COMPLETED,
        PipelineStage.FAILED: JobStatus.FAILED,
    }
    
    return JobStatusResponse(
        job_id=job_id,
        status=stage_map.get(job.stage, JobStatus.PENDING),
        progress=job.progress,
        current_step=job.stage.value,
        error=job.error
    )


@router.get("/download/{job_id}")
async def download_video(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Download the processed video."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.stage != PipelineStage.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Job not complete. Current status: {job.stage.value}"
        )
    
    if not job.output_path or not job.output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    
    return FileResponse(
        path=job.output_path,
        filename=f"vidmod_{job_id}.mp4",
        media_type="video/mp4"
    )


@router.get("/preview/{job_id}/frame/{index}")
async def get_preview_frame(
    job_id: str,
    index: int,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Get a preview frame from the video."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if index < 0 or index >= len(job.frame_paths):
        raise HTTPException(status_code=400, detail="Frame index out of range")
    
    frame_path = job.frame_paths[index]
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    
    return FileResponse(path=frame_path, media_type="image/png")


@router.get("/preview/{job_id}/mask/{index}")
async def get_preview_mask(
    job_id: str,
    index: int,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Get a preview mask."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if index < 0 or index >= len(job.mask_paths):
        raise HTTPException(status_code=400, detail="Mask index out of range")
    
    mask_path = job.mask_paths[index]
    if not mask_path or not mask_path.exists():
        raise HTTPException(status_code=404, detail="Mask not found")
    
    return FileResponse(path=mask_path, media_type="image/png")


@router.post("/segment-video", response_model=VideoSegmentResponse)
async def segment_video_with_clicks(
    request: VideoSegmentRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Segment objects in video using click coordinates via SAM-2 Video.
    
    This is more efficient than frame-by-frame processing as it processes
    the entire video in a single API call with automatic object tracking.
    
    Requirements:
    - Video must be accessible via public URL (stored in job.video_info["video_url"])
    - Click coordinates should be pixel positions in the video frame
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Extract click data into separate lists
    click_coordinates = [(click.x, click.y) for click in request.clicks]
    click_frames = [click.frame for click in request.clicks]
    click_labels = [click.label for click in request.clicks]
    object_ids = [click.object_id for click in request.clicks]
    
    try:
        job = pipeline.segment_video_with_clicks(
            job_id=request.job_id,
            click_coordinates=click_coordinates,
            click_frames=click_frames,
            click_labels=click_labels,
            object_ids=object_ids,
            mask_type=request.mask_type,
            output_format=request.output_format,
            video_fps=request.video_fps,
            output_quality=request.output_quality
        )
        
        # Build response
        download_path = None
        if job.segmented_video_path and job.segmented_video_path.exists():
            download_path = f"/api/download-segmented/{request.job_id}"
        
        return VideoSegmentResponse(
            job_id=request.job_id,
            status="completed",
            segmented_video_url=job.segmented_video_url,
            download_path=download_path,
            mask_urls={},
            message="Video segmentation complete"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Video segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/segment-video-text", response_model=VideoSegmentResponse)
async def segment_video_with_text(
    request: TextVideoSegmentRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Segment objects in video using text descriptions.
    
    This automatically detects the specified objects using Grounded SAM,
    then tracks them throughout the video using SAM-2 Video.
    
    Example:
        objects: ["coffee cup", "person's hand"]
        
    The system will:
    1. Detect each object in the specified frame
    2. Get the center coordinates automatically
    3. Track objects throughout the video
    
    Requirements:
    - Video must be accessible via public URL (stored in job.video_info["video_url"])
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.frame_paths:
        raise HTTPException(
            status_code=400, 
            detail="Frames not extracted. Upload video first via /upload."
        )
    
    try:
        job, detected_coords = pipeline.segment_video_with_text(
            job_id=request.job_id,
            object_prompts=request.objects,
            detection_frame=request.detection_frame,
            mask_type=request.mask_type,
            output_format=request.output_format,
            video_fps=request.video_fps,
            output_quality=request.output_quality
        )
        
        # Build response
        download_path = None
        if job.segmented_video_path and job.segmented_video_path.exists():
            download_path = f"/api/download-segmented/{request.job_id}"
        
        return VideoSegmentResponse(
            job_id=request.job_id,
            status="completed",
            segmented_video_url=job.segmented_video_url,
            download_path=download_path,
            detected_coordinates=detected_coords,
            mask_urls={},
            message=f"Detected and tracked {len(detected_coords)} object(s)"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Text-based video segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/segment-video-sam3", response_model=Sam3SegmentResponse)
async def segment_video_with_sam3(
    request: Sam3SegmentRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Segment video using SAM3 with a text prompt via Replicate API.
    
    Just upload a video via /upload, then call this with a text prompt!
    Local files are automatically uploaded to Replicate - no public URL needed.
    
    Example:
        text_prompt: "person"
        text_prompt: "coffee cup"
        
    Requirements:
    - Video must be uploaded first via /upload
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Check that we have a video source (local file or URL)
    video_info = job.video_info or {}
    if not video_info.get("video_url") and not job.video_path:
        raise HTTPException(
            status_code=400, 
            detail="No video found. Upload a video first via /upload."
        )
    
    try:
        job = pipeline.segment_video_with_sam3(
            job_id=request.job_id,
            text_prompt=request.text_prompt,
            mask_only=request.mask_only,
            mask_color=request.mask_color,
            mask_opacity=request.mask_opacity
        )
        
        download_path = None
        if job.segmented_video_path and job.segmented_video_path.exists():
            download_path = f"/api/download-segmented/{request.job_id}"
        
        return Sam3SegmentResponse(
            job_id=request.job_id,
            status="completed",
            download_path=download_path,
            output_url=job.segmented_video_url if hasattr(job, 'segmented_video_url') else None,
            text_prompt=request.text_prompt,
            message=f"Video segmented with SAM3 using prompt: '{request.text_prompt}'"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"SAM3 video segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-object", response_model=ReplaceObjectResponse)
async def replace_object(
    request: ReplaceObjectRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace masked object in video using Wan 2.1 inpainting.
    
    Requires SAM3 segmentation to be run first with mask_only=True.
    The mask video (white = object to replace) will be used to guide replacement.
    
    Example workflow:
        1. POST /api/segment-video-sam3 with mask_only=true
        2. POST /api/replace-object with replacement_prompt="a red Coca-Cola can"
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.segmented_video_path:
        raise HTTPException(
            status_code=400, 
            detail="Run SAM3 segmentation first with mask_only=true."
        )
    
    try:
        job = pipeline.replace_object(
            job_id=request.job_id,
            replacement_prompt=request.replacement_prompt,
            num_frames=request.num_frames,
            guidance_scale=request.guidance_scale
        )
        
        download_path = None
        if job.output_path and job.output_path.exists():
            download_path = f"/api/download/{request.job_id}"
        
        return ReplaceObjectResponse(
            job_id=request.job_id,
            status="completed",
            download_path=download_path,
            replacement_prompt=request.replacement_prompt,
            message=f"Object replaced with '{request.replacement_prompt}'"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Object replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-object-framewise", response_model=FramewiseReplaceResponse)
async def replace_object_framewise(
    request: FramewiseReplaceRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace object in video frame-by-frame using Gemini image editing.
    
    This uses Nano Banana (Gemini 2.5 Flash Image) to edit each keyframe,
    then combines them back into a video. Supports reference images!
    
    Example:
        object_prompt: "coffee cup"
        replacement_prompt: "red Coca-Cola can"
        reference_image_url: "https://example.com/coke.jpg" (optional)
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.frame_paths:
        raise HTTPException(
            status_code=400,
            detail="No frames found. Upload video first via /upload."
        )
    
    # Handle reference image if provided
    reference_path = None
    if request.reference_image_url:
        import httpx
        from pathlib import Path
        try:
            # Download reference image
            job_dir = Path(f"storage/jobs/{request.job_id}")
            reference_path = job_dir / "reference_image.jpg"
            with httpx.Client(timeout=30.0) as client:
                response = client.get(request.reference_image_url, follow_redirects=True)
                response.raise_for_status()
                with open(reference_path, 'wb') as f:
                    f.write(response.content)
            logger.info(f"Downloaded reference image to {reference_path}")
        except Exception as e:
            logger.warning(f"Failed to download reference image: {e}")
    
    try:
        job = pipeline.replace_object_framewise(
            job_id=request.job_id,
            object_prompt=request.object_prompt,
            replacement_prompt=request.replacement_prompt,
            reference_image_path=reference_path,
            frame_interval=request.frame_interval
        )
        
        download_path = None
        if job.output_path and job.output_path.exists():
            download_path = f"/api/download/{request.job_id}"
        
        return FramewiseReplaceResponse(
            job_id=request.job_id,
            status="completed",
            download_path=download_path,
            frames_processed=len(job.inpainted_paths) if job.inpainted_paths else 0,
            frames_total=len(job.frame_paths) if job.frame_paths else 0,
            message=f"Replaced '{request.object_prompt}' with '{request.replacement_prompt}'"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Framewise replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-object-with-reference", response_model=FramewiseReplaceResponse)
async def replace_object_with_reference(
    job_id: str,
    object_prompt: str,
    replacement_prompt: str,
    reference_image: UploadFile,
    frame_interval: int = 1,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace object with a LOCAL reference image upload.
    
    Upload your reference image (e.g., coke-can.jpg) and it will be used
    for consistent object replacement across all frames.
    """
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.frame_paths:
        raise HTTPException(
            status_code=400,
            detail="No frames found. Upload video first via /upload."
        )
    
    # Save uploaded reference image
    from pathlib import Path
    job_dir = Path(f"storage/jobs/{job_id}")
    reference_path = job_dir / f"reference_{reference_image.filename}"
    
    with open(reference_path, 'wb') as f:
        content = await reference_image.read()
        f.write(content)
    
    logger.info(f"Saved reference image to {reference_path}")
    
    try:
        job = pipeline.replace_object_framewise(
            job_id=job_id,
            object_prompt=object_prompt,
            replacement_prompt=replacement_prompt,
            reference_image_path=reference_path,
            frame_interval=frame_interval
        )
        
        download_path = None
        if job.output_path and job.output_path.exists():
            download_path = f"/api/download/{job_id}"
        
        return FramewiseReplaceResponse(
            job_id=job_id,
            status="completed",
            download_path=download_path,
            frames_processed=len(job.inpainted_paths) if job.inpainted_paths else 0,
            frames_total=len(job.frame_paths) if job.frame_paths else 0,
            message=f"Replaced '{object_prompt}' with '{replacement_prompt}' using reference image"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Framewise replacement with reference failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-with-vace", response_model=VaceReplaceResponse)
async def replace_with_vace(
    request: VaceReplaceRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace masked object using fal.ai VACE video inpainting. ⭐
    
    This is the BEST method for object replacement:
    1. First run SAM3 segmentation with mask_only=true
    2. Then call this endpoint with a prompt
    
    Example workflow:
        POST /api/segment-video-sam3 {"text_prompt": "coffee cup", "mask_only": true}
        POST /api/replace-with-vace {"prompt": "red Coca-Cola can"}
    """
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.segmented_video_path:
        raise HTTPException(
            status_code=400,
            detail="No mask video found. Run SAM3 segmentation with mask_only=true first."
        )
    
    try:
        job = pipeline.replace_with_vace(
            job_id=request.job_id,
            prompt=request.prompt,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale
        )
        
        download_path = None
        if job.output_path and job.output_path.exists():
            download_path = f"/api/download/{request.job_id}"
        
        return VaceReplaceResponse(
            job_id=request.job_id,
            status="completed",
            download_path=download_path,
            message=f"Object replaced using VACE inpainting"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VACE replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-with-vace-ref", response_model=VaceReplaceResponse)
async def replace_with_vace_reference(
    job_id: str,
    prompt: str,
    reference_image: UploadFile,
    num_inference_steps: int = 30,
    guidance_scale: float = 5.0,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace masked object using VACE + reference image. ⭐
    
    Upload a reference image (e.g., coke-can.jpg) for better accuracy.
    """
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.segmented_video_path:
        raise HTTPException(
            status_code=400,
            detail="No mask video found. Run SAM3 segmentation with mask_only=true first."
        )
    
    # Save uploaded reference image
    from pathlib import Path
    job_dir = Path(f"storage/jobs/{job_id}")
    reference_path = job_dir / f"reference_{reference_image.filename}"
    
    with open(reference_path, 'wb') as f:
        content = await reference_image.read()
        f.write(content)
    
    logger.info(f"Saved reference image to {reference_path}")
    
    try:
        job = pipeline.replace_with_vace(
            job_id=job_id,
            prompt=prompt,
            reference_image_path=reference_path,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale
        )
        
        download_path = None
        if job.output_path and job.output_path.exists():
            download_path = f"/api/download/{job_id}"
        
        return VaceReplaceResponse(
            job_id=job_id,
            status="completed",
            download_path=download_path,
            message=f"Object replaced using VACE + reference image"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"VACE replacement with reference failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-nano-banana", response_model=NanoBananaResponse)
async def replace_with_nano_banana(
    job_id: str,
    object_prompt: str,
    replacement_prompt: str,
    reference_image: UploadFile,
    frame_interval: int = 1,
    use_composite: bool = False,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace object frame-by-frame using Nano Banana (Gemini) with SAM mask + reference image. ⭐
    
    Best for: Precise object replacement with reference image guidance.
    
    Requirements:
    1. Upload video first
    2. Run SAM3 segmentation (mask_only=true recommended)
    3. Upload reference image of replacement object
    
    The optimized prompts will ensure:
    - Matching lighting and color temperature
    - Preserving hands, fingers, shadows
    - Natural positioning
    - Photorealistic blending
    """
    from pathlib import Path
    from core.gemini_inpaint_engine import GeminiInpaintEngine
    from app.config import get_settings
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.frame_paths:
        raise HTTPException(status_code=400, detail="No frames found. Upload video first.")
    
    # Save reference image
    job_dir = Path(f"storage/jobs/{job_id}")
    reference_path = job_dir / f"nano_ref_{reference_image.filename}"
    with open(reference_path, 'wb') as f:
        content = await reference_image.read()
        f.write(content)
    
    logger.info(f"Saved reference image for Nano Banana: {reference_path}")
    
    # Get mask paths if available (from SAM3 segmentation)
    mask_dir = job_dir / "masks"
    mask_paths = []
    if mask_dir.exists():
        mask_paths = sorted(mask_dir.glob("*.png"))
    
    # If no mask frames, extract from SAM3 mask video
    if not mask_paths and job.segmented_video_path and job.segmented_video_path.exists():
        logger.info(f"Extracting mask frames from SAM3 video: {job.segmented_video_path}")
        mask_dir.mkdir(parents=True, exist_ok=True)
        
        # Use ffmpeg to extract frames from mask video
        import subprocess
        extract_cmd = [
            "ffmpeg", "-y",
            "-i", str(job.segmented_video_path),
            "-vf", "fps=25",  # Match typical video fps
            str(mask_dir / "mask_%06d.png")
        ]
        try:
            subprocess.run(extract_cmd, check=True, capture_output=True)
            mask_paths = sorted(mask_dir.glob("mask_*.png"))
            logger.info(f"Extracted {len(mask_paths)} mask frames")
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to extract mask frames: {e}")
    
    try:
        settings = get_settings()
        engine = GeminiInpaintEngine(api_key=settings.gemini_api_key)
        
        # Process frames with masks
        output_dir = job_dir / "nano_edited"
        
        if mask_paths:
            edited_paths = engine.process_frames_with_masks(
                frame_paths=job.frame_paths,
                mask_paths=mask_paths,
                reference_image_path=reference_path,
                object_prompt=object_prompt,
                replacement_prompt=replacement_prompt,
                frame_interval=frame_interval,
                output_dir=output_dir,
                use_composite=use_composite
            )
        else:
            edited_paths = engine.process_frames(
                frame_paths=job.frame_paths,
                object_prompt=object_prompt,
                replacement_prompt=replacement_prompt,
                reference_image_path=reference_path,
                frame_interval=frame_interval,
                output_dir=output_dir
            )
        
        # Build video from edited frames
        output_path = job_dir / "replaced_nano.mp4"
        video_info = job.video_info or {}
        fps = video_info.get("fps", 25)
        
        pipeline.video_builder.build_video(
            frames_dir=output_dir,
            output_path=output_path,
            fps=fps,
            audio_path=job.audio_path if job.audio_path and job.audio_path.exists() else None
        )
        
        job.output_path = output_path
        job.inpainted_paths = edited_paths
        
        return NanoBananaResponse(
            job_id=job_id,
            status="completed",
            download_path=f"/api/download/{job_id}",
            frames_processed=len([p for p in edited_paths if p.exists()]),
            frames_total=len(job.frame_paths),
            message=f"Replaced '{object_prompt}' with '{replacement_prompt}' using Nano Banana"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Nano Banana replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-with-pika", response_model=PikaReplaceResponse)
async def replace_with_pika(
    job_id: str,
    prompt: str,
    reference_image: UploadFile,
    negative_prompt: str = "blurry, distorted, low quality, deformed",
    duration: int = 5,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Replace object in video using Pika Labs Pikadditions. ⭐⭐
    
    BEST FOR: Shape-changing object replacement (cup → bottle).
    Uses Pika v2 which is better at complete object swaps than VACE.
    
    Workflow:
    1. Upload video
    2. Call this endpoint with prompt + reference image
    
    Note: Pika processes the whole video, no SAM mask required!
    """
    from pathlib import Path
    from core.pika_engine import PikaEngine
    from app.config import get_settings
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path:
        raise HTTPException(status_code=400, detail="No video found. Upload video first.")
    
    # Save reference image
    job_dir = Path(f"storage/jobs/{job_id}")
    reference_path = job_dir / f"pika_ref_{reference_image.filename}"
    with open(reference_path, 'wb') as f:
        content = await reference_image.read()
        f.write(content)
    
    logger.info(f"Saved Pika reference image: {reference_path}")
    
    try:
        settings = get_settings()
        engine = PikaEngine(api_key=settings.fal_key)
        
        output_path = job_dir / "replaced_pika.mp4"
        
        result_path = engine.replace_and_download(
            video_path=job.video_path,
            output_path=output_path,
            prompt=prompt,
            reference_image_path=reference_path,
            negative_prompt=negative_prompt,
            duration=duration
        )
        
        job.output_path = result_path
        
        return PikaReplaceResponse(
            job_id=job_id,
            status="completed",
            download_path=f"/api/download/{job_id}",
            message=f"Object replaced using Pika Labs: {prompt}"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pika replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download-segmented/{job_id}")
async def download_segmented_video(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Download the segmented video output."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.segmented_video_path or not job.segmented_video_path.exists():
        raise HTTPException(status_code=404, detail="Segmented video not found")
    
    # Determine media type based on file extension
    ext = job.segmented_video_path.suffix.lower()
    media_types = {
        ".mp4": "video/mp4",
        ".webp": "image/webp",
        ".gif": "image/gif"
    }
    media_type = media_types.get(ext, "video/mp4")
    
    return FileResponse(
        path=job.segmented_video_path,
        filename=f"segmented_{job_id}{ext}",
        media_type=media_type
    )


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """Delete a job and all associated files."""
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    pipeline.cleanup_job(job_id)
    return {"message": f"Job {job_id} deleted"}


@router.post("/analyze-video/{job_id}")
async def analyze_video(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Analyze video with Gemini 2.5 Pro for compliance violations.
    
    Uses native video understanding to detect:
    - Alcohol/substance use
    - Brand logos
    - Violence
    - Profanity/language
    - Other compliance issues
    
    Returns findings matching the frontend Finding type.
    """
    from core.gemini_video_analyzer import analyzeVideoWithGemini
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path or not job.video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        logger.info(f"Starting Gemini analysis for job {job_id}")
        
        # Analyze with Gemini
        result = analyzeVideoWithGemini(job.video_path, api_key=settings.gemini_api_key)
        
        # Add IDs to findings
        findings = result.get("findings", [])
        for i, finding in enumerate(findings):
            finding["id"] = i + 1
        
        logger.info(f"Analysis complete: {len(findings)} findings")
        
        return {
            "job_id": job_id,
            "status": "completed",
            "findings": findings,
            "summary": result.get("summary", ""),
            "riskLevel": result.get("riskLevel", "Low"),
            "predictedAgeRating": result.get("predictedAgeRating", "U")
        }
        
    except ValueError as e:
        logger.error(f"Analysis configuration error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Video analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/blur-object", response_model=BlurEffectResponse)
async def blur_object(
    request: BlurEffectRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Apply blur/pixelate effect to detected object - like Meta's Segment Anything demo! ⭐
    
    This is a two-step process:
    1. SAM3 detects and creates a mask for the object
    2. FFmpeg applies blur/pixelate effect only to the masked region
    
    Args:
        job_id: Job ID from video upload
        text_prompt: What to blur (e.g., 'face', 'logo', 'license plate')
        blur_strength: Intensity of blur (10-50 recommended)
        effect_type: 'blur' for Gaussian blur, 'pixelate' for mosaic effect
    
    Example:
        POST /api/blur-object
        {
            "job_id": "abc123",
            "text_prompt": "Veo watermark logo",
            "blur_strength": 30,
            "effect_type": "blur"
        }
    """
    from core.video_builder import VideoBuilder
    import hashlib
    
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path or not job.video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        # Define job directory first (needed for both paths)
        job_dir = job.video_path.parent
        
        # SMART CLIPPING OPTIMIZATION: If timestamps provided, process only the clip
        use_smart_clipping = request.start_time is not None and request.end_time is not None
        
        if use_smart_clipping:
            logger.info(f"🚀 Smart Clipping enabled: processing {request.start_time:.2f}s to {request.end_time:.2f}s")
            
            # Determine source video for extraction (for effect chaining)
            if job.output_path and job.output_path.exists():
                source_video_for_clip = job.output_path
                logger.info(f"✨ Chaining effect: extracting clip from previous output: {source_video_for_clip}")
            else:
                source_video_for_clip = job.video_path
                logger.info(f"📹 First effect: extracting clip from original video: {source_video_for_clip}")
            
            # Step 0: Extract clip from source video (original or previously edited)
            clip_path = job_dir / f"clip_{request.start_time}_{request.end_time}.mp4"
            pipeline.frame_extractor.extract_clip(
                video_path=source_video_for_clip,
                output_path=clip_path,
                start_time=request.start_time,
                end_time=request.end_time,
                buffer_seconds=1.0
            )
            
            # Upload clip to S3 for faster SAM3 processing
            clip_s3_url = None
            if pipeline.s3_uploader and job.s3_url:
                try:
                    logger.info(f"📤 Uploading clip to S3 for faster processing...")
                    clip_s3_key = f"jobs/{request.job_id}/clip_{request.start_time}_{request.end_time}.mp4"
                    clip_s3_url = pipeline.s3_uploader.upload_video(clip_path, clip_s3_key)
                    logger.info(f"✅ Clip uploaded to S3: {clip_s3_url}")
                except Exception as e:
                    logger.warning(f"Failed to upload clip to S3, will use local file: {e}")
            
            # Create a cache key from the prompt (sanitized for filename)
            prompt_hash = hashlib.md5(request.text_prompt.lower().encode()).hexdigest()[:8]
            prompt_slug = "".join(c if c.isalnum() else "_" for c in request.text_prompt.lower())[:20]
            cache_filename = f"mask_{prompt_slug}_{prompt_hash}_clip.mp4"
            cached_mask_path = job_dir / cache_filename
            
            # Check if mask is already cached for this clip
            if cached_mask_path.exists():
                logger.info(f"Using cached mask for '{request.text_prompt}': {cached_mask_path}")
                mask_video_path = cached_mask_path
            else:
                # Step 1: Run SAM3 on the CLIP (much faster!)
                logger.info(f"Step 1: Creating segmentation for '{request.text_prompt}' on clip using SAM3...")
                
                # Simplify prompt for better SAM3 results
                from core.prompt_simplifier import PromptSimplifier
                try:
                    simplifier = PromptSimplifier(api_key=pipeline.replicate_api_token)  # Reuse Replicate token for now
                    # Check if Gemini key is available
                    from app.config import get_settings
                    settings = get_settings()
                    if settings.gemini_api_key:
                        simplifier = PromptSimplifier(api_key=settings.gemini_api_key)
                    
                    simplified_prompt = simplifier.simplify(request.text_prompt)
                    logger.info(f"📝 Prompt optimized: '{request.text_prompt}' → '{simplified_prompt}'")
                except Exception as e:
                    logger.warning(f"Prompt simplification failed, using original: {e}")
                    simplified_prompt = request.text_prompt
                
                # Call SAM3 directly on the clip
                from core.sam3_engine import Sam3VideoEngine
                sam3_video = Sam3VideoEngine(api_token=pipeline.replicate_api_token)
                
                # Use clip's S3 URL if available (fastest), otherwise use local clip path
                video_source = clip_s3_url if clip_s3_url else clip_path
                logger.info(f"🎯 SAM3 video source: {'S3 clip URL' if clip_s3_url else 'local clip file'}")
                
                result = sam3_video.segment_video(
                    video_source=video_source,  # Use clip's S3 URL or local clip
                    prompt=simplified_prompt,  # Use simplified prompt
                    mask_only=True,  # Pure black/white mask (white = blur areas)
                )
                
                # Download mask
                mask_video_path = job_dir / f"mask_clip_{prompt_hash}.mp4"
                import httpx
                response = httpx.get(result['output_url'], follow_redirects=True)  # Fixed: was 'video_url'
                response.raise_for_status()
                with open(mask_video_path, 'wb') as f:
                    f.write(response.content)
                
                # Cache the mask
                import shutil
                shutil.copy(mask_video_path, cached_mask_path)
                logger.info(f"Cached mask to: {cached_mask_path}")
            
            # Step 2: Apply blur/pixelate effect to the clip
            logger.info(f"Step 2: Applying {request.effect_type} effect to clip...")
            video_builder = VideoBuilder(ffmpeg_path=pipeline.ffmpeg_path)
            
            processed_clip_path = job_dir / f"processed_clip_{prompt_hash}.mp4"
            
            if request.effect_type == "pixelate":
                video_builder.apply_pixelate_with_mask(
                    input_video=clip_path,
                    mask_video=mask_video_path,
                    output_path=processed_clip_path,
                    pixel_size=max(8, 64 // (request.blur_strength // 10 + 1))
                )
            else:
                video_builder.apply_blur_with_mask(
                    input_video=clip_path,
                    mask_video=mask_video_path,
                    output_path=processed_clip_path,
                    blur_strength=request.blur_strength
                )
            
            # Step 3: Stitch processed clip back into original video
            logger.info("Step 3: Stitching processed clip back into original video...")
            
            # Determine source video (for chaining effects)
            if job.output_path and job.output_path.exists():
                source_video = job.output_path
                logger.info(f"Chaining effect on previous result: {source_video}")
            else:
                source_video = job.video_path
                logger.info(f"Applying effect to original video: {source_video}")
            
            output_path = job_dir / f"output_{request.effect_type}_{prompt_hash}_stitched.mp4"
            
            video_builder.insert_segment(
                original_video=source_video,
                processed_segment=processed_clip_path,
                output_path=output_path,
                start_time=request.start_time,
                end_time=request.end_time,
                buffer_seconds=1.0
            )
            
            # Update job with final output
            job.output_path = output_path
            logger.info(f"✅ Smart Clipping complete: {output_path}")
            
        else:
            # LEGACY FULL VIDEO PROCESSING (when no timestamps provided)
            logger.info("⚠️ Processing full video (no timestamps provided)")
            
            # Create a cache key from the prompt (sanitized for filename)
            prompt_hash = hashlib.md5(request.text_prompt.lower().encode()).hexdigest()[:8]
            prompt_slug = "".join(c if c.isalnum() else "_" for c in request.text_prompt.lower())[:20]
            cache_filename = f"mask_{prompt_slug}_{prompt_hash}.mp4"
            cached_mask_path = job_dir / cache_filename
            
            # Check if mask is already cached
            if cached_mask_path.exists():
                logger.info(f"Using cached mask for '{request.text_prompt}': {cached_mask_path}")
                mask_video_path = cached_mask_path
            else:
                # Step 1: Run SAM3 to create mask
                logger.info(f"Step 1: Creating segmentation for '{request.text_prompt}' using SAM3...")
                job = pipeline.segment_video_with_sam3(
                    job_id=request.job_id,
                    text_prompt=request.text_prompt,
                    mask_only=False,
                    mask_color="green",
                    mask_opacity=1.0
                )
                
                if not job.segmented_video_path or not job.segmented_video_path.exists():
                    raise ValueError("SAM3 mask generation failed")
                
                # Cache the mask for future use
                import shutil
                shutil.copy(job.segmented_video_path, cached_mask_path)
                logger.info(f"Cached mask to: {cached_mask_path}")
                mask_video_path = cached_mask_path
            
            # Step 2: Apply blur/pixelate effect using FFmpeg
            logger.info(f"Step 2: Applying {request.effect_type} effect...")
            video_builder = VideoBuilder(ffmpeg_path=pipeline.ffmpeg_path)
            
            # Use previous output if exists (for chaining effects)
            if job.output_path and job.output_path.exists():
                input_video = job.output_path
                logger.info(f"Chaining effect on previous result: {input_video}")
            else:
                input_video = job.video_path
                logger.info(f"Applying effect to original video: {input_video}")
            
            output_path = job_dir / f"output_{request.effect_type}_{prompt_hash}.mp4"
            
            if request.effect_type == "pixelate":
                video_builder.apply_pixelate_with_mask(
                    input_video=input_video,
                    mask_video=mask_video_path,
                    output_path=output_path,
                    pixel_size=max(8, 64 // (request.blur_strength // 10 + 1))
                )
            else:
                video_builder.apply_blur_with_mask(
                    input_video=input_video,
                    mask_video=mask_video_path,
                    output_path=output_path,
                    blur_strength=request.blur_strength
                )
            
            # Update job with final output
            job.output_path = output_path
            logger.info(f"Blur effect applied successfully: {output_path}")
        
        return BlurEffectResponse(
            job_id=request.job_id,
            status="completed",
            download_path=f"/api/download/{request.job_id}",
            text_prompt=request.text_prompt,
            effect_type=request.effect_type,
            message=f"Applied {request.effect_type} effect to '{request.text_prompt}'" + (" (Smart Clipping)" if use_smart_clipping else "")
        )
        
    except ValueError as e:
        logger.error(f"Blur effect validation error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Blur effect failed with exception: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-manual", response_model=ManualAnalysisResponse)
async def analyze_manual(
    request: ManualAnalysisRequest,
    pipeline: VideoPipeline = Depends(get_pipeline)
):
    """
    Analyze a manually drawn bounding box using Gemini.
    Identifies the object and suggests remediation actions.
    """
    try:
        # Convert Pydantic box to dict for pipeline
        box_dict = {
            "x1": request.box.x1,
            "y1": request.box.y1,
            "x2": request.box.x2,
            "y2": request.box.y2
        }
        
        result = pipeline.analyze_manual_box(
            job_id=request.job_id,
            timestamp=request.timestamp,
            box=box_dict
        )
        
        return ManualAnalysisResponse(
            job_id=request.job_id,
            item_name=result.get("item_name", "Unknown Object"),
            reasoning=result.get("reasoning", ""),
            suggested_actions=[
                ManualAction(**action) for action in result.get("suggested_actions", [])
            ],
            confidence=result.get("confidence", "Medium")
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Manual analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-with-pika", response_model=PikaReplaceResponse)
async def replace_with_pika(
    job_id: str = Form(...),
    prompt: str = Form(...),
    reference_image: UploadFile = File(...),
    negative_prompt: str = Form("blurry, distorted, low quality, deformed"),
    duration: int = Form(5),
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Replace object in video using Pika Labs Pikadditions. ⭐⭐
    
    BEST FOR: Shape-changing object replacement (cup → bottle).
    Uses Pika v2 which is better at complete object swaps than VACE.
    
    Workflow:
    1. Upload video
    2. Call this endpoint with prompt + reference image
    
    Note: Pika processes the whole video, no SAM mask required!
    """
    from pathlib import Path
    from core.pika_engine import PikaEngine
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path:
        raise HTTPException(status_code=400, detail="No video found. Upload video first.")
    
    # Save reference image
    job_dir = Path(f"storage/jobs/{job_id}")
    reference_path = job_dir / f"pika_ref_{reference_image.filename}"
    with open(reference_path, 'wb') as f:
        content = await reference_image.read()
        f.write(content)
    
    logger.info(f"Saved Pika reference image: {reference_path}")
    
    try:
        engine = PikaEngine(api_key=settings.fal_key)
        
        output_path = job_dir / "replaced_pika.mp4"
        
        result_path = engine.replace_and_download(
            video_path=job.video_path,
            output_path=output_path,
            prompt=prompt,
            reference_image_path=reference_path,
            negative_prompt=negative_prompt,
            duration=duration
        )
        
        job.output_path = result_path
        
        return PikaReplaceResponse(
            job_id=job_id,
            status="completed",
            download_path=f"/api/download/{job_id}",
            message=f"Object replaced using Pika Labs: {prompt}"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pika replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replace-with-runway", response_model=RunwayReplaceResponse)
async def replace_with_runway(
    job_id: str = Form(...),
    prompt: str = Form(...),
    reference_image: Optional[UploadFile] = File(None),  # Optional - Runway's direct API is text-only
    negative_prompt: str = Form("blurry, distorted, low quality, deformed"),
    duration: int = Form(5),
    start_time: Optional[float] = Form(None),  # Smart Clipping start
    end_time: Optional[float] = Form(None),    # Smart Clipping end
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Replace object in video using Runway Gen-4 Aleph. ⭐⭐⭐
    
    BEST FOR: Premium quality AI video editing.
    Advanced in-context editing with text prompts.
    Supports Smart Clipping - pass start_time/end_time to process only a portion.
    
    Workflow:
    1. Upload video
    2. Call this endpoint with prompt + timestamps (optional)
    3. If timestamps provided, only that portion is processed
    
    Note: Runway Gen-4 is the most advanced but also most expensive option.
    """
    from pathlib import Path
    from core.runway_engine import RunwayEngine
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path:
        raise HTTPException(status_code=400, detail="No video found. Upload video first.")
    
    job_dir = Path(f"storage/jobs/{job_id}")
    
    # Reference image is optional for Runway (not actually used by the API)
    reference_path = None
    if reference_image and reference_image.filename:
        reference_path = job_dir / f"runway_ref_{reference_image.filename}"
        with open(reference_path, 'wb') as f:
            content = await reference_image.read()
            f.write(content)
        logger.info(f"Saved Runway reference image: {reference_path}")
    else:
        logger.info("No reference image provided (Runway uses text-only)")
    
    try:
        # Use Runway's direct API key from settings
        runway_key = settings.runway_api_key
        if not runway_key:
            raise HTTPException(status_code=500, detail="RUNWAY_API_KEY not configured in .env")
        
        engine = RunwayEngine(api_key=runway_key)
        
        output_path = job_dir / "replaced_runway.mp4"
        
        # SMART CLIPPING: If timestamps provided, clip the video first
        use_smart_clipping = start_time is not None and end_time is not None
        video_url = None
        
        if use_smart_clipping:
            logger.info(f"🚀 Smart Clipping enabled: processing {start_time:.2f}s to {end_time:.2f}s")
            
            # Determine source video for extraction
            if job.output_path and job.output_path.exists():
                source_video_for_clip = job.output_path
                logger.info(f"✨ Chaining effect: extracting clip from previous output")
            else:
                source_video_for_clip = job.video_path
                logger.info(f"📹 First effect: extracting clip from original video")
            
            # Runway requires at least 1 second of video
            MIN_RUNWAY_DURATION = 1.0
            clip_duration = end_time - start_time
            
            # If clip is too short, expand it to meet minimum requirement
            actual_start = start_time
            actual_end = end_time
            if clip_duration < MIN_RUNWAY_DURATION:
                # Expand equally on both sides, but ensure we don't go negative
                expand_needed = MIN_RUNWAY_DURATION - clip_duration
                half_expand = expand_needed / 2
                actual_start = max(0, start_time - half_expand)
                actual_end = end_time + half_expand
                logger.info(f"⚠️ Clip too short ({clip_duration:.2f}s). Expanding to {actual_start:.2f}s - {actual_end:.2f}s ({actual_end - actual_start:.2f}s)")
            
            # Step 1: Extract clip from video
            clip_path = job_dir / f"runway_clip_{actual_start}_{actual_end}.mp4"
            pipeline.frame_extractor.extract_clip(
                video_path=source_video_for_clip,
                output_path=clip_path,
                start_time=actual_start,
                end_time=actual_end,
                buffer_seconds=0.5  # Small buffer for smooth transitions
            )
            
            # Step 2: Upload clip to S3 for Runway
            if pipeline.s3_uploader:
                try:
                    logger.info(f"📤 Uploading clip to S3 for Runway...")
                    clip_s3_key = f"jobs/{job_id}/runway_clip_{actual_start}_{actual_end}.mp4"
                    video_url = pipeline.s3_uploader.upload_video(clip_path, clip_s3_key)
                    logger.info(f"✅ Clip uploaded to S3: {video_url}")
                except Exception as e:
                    logger.warning(f"Failed to upload clip to S3: {e}")
                    raise HTTPException(
                        status_code=400,
                        detail="Failed to upload clip to S3. Runway requires a publicly accessible URL."
                    )
        else:
            # No smart clipping - use the full video
            video_url = job.s3_url
        
        if not video_url:
            raise HTTPException(
                status_code=400, 
                detail="Runway requires a publicly accessible video URL. Please re-upload the video to generate an S3 URL."
            )
        
        logger.info(f"Using video URL for Runway: {video_url}")
        
        # Use new chunking pipeline
        # Pass the clipped segment (clip_path) if smart clipping is used, otherwise the full video
        input_video_for_processing = clip_path if use_smart_clipping else job.video_path
        
        logger.info(f"Using chunking pipeline. Input: {input_video_for_processing}, Duration: {duration}s")
        
        result_path = pipeline.process_runway_with_chunking(
            runway_engine=engine,
            input_video=input_video_for_processing, 
            job_id=job_id,
            prompt=prompt,
            total_duration=duration,
            reference_image_path=reference_path,
            negative_prompt=negative_prompt
        )
        
        # If we used smart clipping, we MUST stitch the result back into the main video
        if use_smart_clipping:
            logger.info(f"🧵 Stitching processed clip back into timeline: {actual_start:.2f}s - {actual_end:.2f}s")
            final_stitched_path = job_dir / "final_runway_output.mp4"
            
            # Use insert_segment to merge
            # Note: start_time/end_time here refer to the clip's position in original
            # We use actual_start/actual_end because those were the exact timestamps we clipped
            pipeline.video_builder.insert_segment(
                original_video=source_video_for_clip,
                processed_segment=result_path,
                output_path=final_stitched_path,
                start_time=actual_start,
                end_time=actual_end,
                buffer_seconds=0.0  # Zero buffer as we want exact replacement
            )
            
            # Update result path to be the full stitched video
            result_path = final_stitched_path
            logger.info(f"✅ Video stitching complete: {result_path}")
        
        job.output_path = result_path
        
        return RunwayReplaceResponse(
            job_id=job_id,
            status="completed",
            download_path=f"/api/download/{job_id}",
            message=f"Object replaced using Runway Gen-4: {prompt}"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Runway replacement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analyze-audio/{job_id}")
async def analyze_audio(
    job_id: str,
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Analyze audio for profanity detection only (no censoring).
    Returns detected profanity words with AI-suggested replacements.
    Used by frontend to populate editable word list for voice dubbing.
    """
    logger.info(f"Analyzing audio for profanity: {job_id}")
    
    try:
        # Get job and video path
        job = pipeline.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        if not job.video_path or not job.video_path.exists():
            raise HTTPException(status_code=400, detail="Video file not found")
        
        # Import audio analyzer
        from core.audio_analyzer import AudioAnalyzer
        
        # Analyze for profanity
        analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
        matches = analyzer.analyze_profanity(job.video_path)
        
        # Return matches for frontend
        return {
            "job_id": job_id,
            "profanity_count": len(matches),
            "matches": [
                {
                    "word": m.word,
                    "start_time": m.start_time,
                    "end_time": m.end_time,
                    "replacement": m.replacement,
                    "confidence": m.confidence,
                    "context": m.context
                }
                for m in matches
            ]
        }
        
    except Exception as e:
        logger.error(f"Audio analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/censor-audio", response_model=CensorAudioResponse)
async def censor_audio(
    request: CensorAudioRequest,
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Censor profanity in video audio using either beep or voice dubbing. ⭐⭐⭐
    
    MODES:
    - **beep**: Fast, free - overlays beep sounds over profanity (like TV censoring)
    - **dub**: Premium - uses ElevenLabs to clone voice and dub clean replacements
    
    WORKFLOW:
    1. Upload video
    2. Call this endpoint with mode "beep" or "dub"
    3. For "dub" mode, provide voice_sample_start/end from clean speech (no profanity)
    4. Get censored video with profanity removed/replaced
    
    COSTS:
    - Beep mode: ~$0.001/video (Gemini only)
    - Dub mode: ~$0.01-0.10/video (Gemini + ElevenLabs)
    
    Example:
        POST /api/censor-audio
        {
            "job_id": "abc123",
            "mode": "beep"
        }
        
        Or for voice dubbing:
        {
            "job_id": "abc123",
            "mode": "dub",
            "voice_sample_start": 5.0,
            "voice_sample_end": 15.0
        }
    """
    from pathlib import Path
    from core.audio_analyzer import AudioAnalyzer
    from core.audio_beep_processor import AudioBeepProcessor
    from core.elevenlabs_dubber import ElevenLabsDubber
    
    # Validate mode
    if request.mode not in ["beep", "dub"]:
        raise HTTPException(
            status_code=400,
            detail="Mode must be 'beep' or 'dub'"
        )
    
    logger.info(f"Audio censoring request: {request.job_id}, mode: {request.mode}")
    
    job = pipeline.get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path or not job.video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")
    
    job_dir = Path(f"storage/jobs/{request.job_id}")
    
    try:
        logger.info(f"Starting audio censoring in '{request.mode}' mode")
        
        # Step 1: Analyze audio for profanity using Gemini
        logger.info("Step 1: Analyzing audio for profanity with Gemini...")
        analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
        profanity_matches = analyzer.analyze_profanity(
            video_path=job.video_path,
            custom_words=request.custom_words
        )
        
        if not profanity_matches:
            logger.info("No profanity detected, returning original video")
            return CensorAudioResponse(
                job_id=request.job_id,
                status="completed",
                profanity_count=0,
                words_detected=[],
                matches=[],
                download_path=f"/api/download/{request.job_id}",
                message="No profanity detected in audio",
                mode=request.mode
            )
        
        logger.info(f"Detected {len(profanity_matches)} instances of profanity")
        
        # Step 2: Apply censoring based on mode
        if request.mode == "beep":
            logger.info("Step 2: Applying beep censoring with FFmpeg...")
            processor = AudioBeepProcessor(ffmpeg_path=pipeline.ffmpeg_path)
            output_path = job_dir / "censored_beep.mp4"
            
            processor.apply_beeps(
                video_path=job.video_path,
                profanity_matches=profanity_matches,
                output_path=output_path
            )
            
        else:  # dub mode
            logger.info("Step 2: Applying voice dubbing with ElevenLabs...")
            dubber = ElevenLabsDubber(
                api_key=settings.elevenlabs_api_key,
                ffmpeg_path=pipeline.ffmpeg_path
            )
            
            # Use custom replacements if provided, otherwise use AI suggestions
            word_replacements = request.custom_replacements if request.custom_replacements else {
                match.word: match.replacement for match in profanity_matches
            }
            
            # Detect voice type from video (default to female)
            # TODO: Could add gender detection from audio in the future
            voice_type = "female"  # Simple default for now
            
            # Apply dubs with pre-built voice
            output_path = job_dir / "censored_dubbed.mp4"
            dubber.apply_dubs(
                video_path=job.video_path,
                word_replacements=word_replacements,
                output_path=output_path,
                voice_type=voice_type
            )
        
        # Update job with censored video
        job.output_path = output_path
        
        # Build response
        unique_words = list(set(m.word for m in profanity_matches))
        
        # Convert profanity matches to Pydantic models for response
        match_models = [
            ProfanityMatchModel(
                word=m.word,
                start_time=m.start_time,
                end_time=m.end_time,
                replacement=m.replacement,
                confidence=m.confidence,
                context=m.context
            )
            for m in profanity_matches
        ]
        
        mode_name = "Beep" if request.mode == "beep" else "Voice Dub"
        
        return CensorAudioResponse(
            job_id=request.job_id,
            status="completed",
            profanity_count=len(profanity_matches),
            words_detected=unique_words,
            matches=match_models,
            download_path=f"/api/download/{request.job_id}",
            message=f"Audio censored using {mode_name} mode - {len(profanity_matches)} instances removed",
            mode=request.mode
        )
        
    except ValueError as e:
        logger.error(f"Audio censoring validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Audio censoring failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest-replacements/{job_id}", response_model=SuggestReplacementsResponse)
async def suggest_word_replacements(
    job_id: str,
    request: SuggestReplacementsRequest,
    pipeline: VideoPipeline = Depends(get_pipeline),
    settings: Settings = Depends(get_settings)
):
    """
    Use Gemini to suggest alternative words that match duration. ⭐
    
    This endpoint generates contextually appropriate replacement words
    for profanity or other words you want to replace. The suggestions
    are designed to match the speaking duration of the original word.
    
    WORKFLOW:
    1. Upload video and analyze audio to get detected words
    2. Call this endpoint with words you want replacements for
    3. Gemini generates 3-5 alternatives for each word
    4. Use suggestions in the voice dubbing workflow
    
    Example:
        POST /api/suggest-replacements/abc123
        {
            "job_id": "abc123",
            "words_to_replace": ["damn", "shit", "hell"]
        }
        
        Response:
        {
            "job_id": "abc123",
            "suggestions": [
                {
                    "original_word": "damn",
                    "suggestions": ["darn", "dang", "drat", "shoot"],
                    "duration": 0.4
                },
                ...
            ]
        }
    """
    from core.word_suggester import WordSuggester
    from core.audio_analyzer import AudioAnalyzer
    
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not job.video_path or not job.video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        logger.info(f"Generating word suggestions for {len(request.words_to_replace)} words")
        
        # First, analyze the video to get word timings
        analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
        matches = analyzer.analyze_profanity(
            video_path=job.video_path,
            custom_words=request.words_to_replace
        )
        
        # Create a mapping of words to their durations
        word_durations = {}
        for match in matches:
            word = match.word
            duration = match.end_time - match.start_time
            if word not in word_durations:
                word_durations[word] = duration
        
        # Generate suggestions for each word
        suggester = WordSuggester(api_key=settings.gemini_api_key)
        suggestions_list = []
        
        for word in request.words_to_replace:
            # Get duration (default to 0.5s if not detected)
            duration = word_durations.get(word, 0.5)
            
            # Generate suggestions
            alternatives = suggester.suggest_alternatives(word, duration, num_suggestions=5)
            
            suggestions_list.append(
                WordSuggestion(
                    original_word=word,
                    suggestions=alternatives,
                    duration=duration
                )
            )
        
        logger.info(f"✅ Generated suggestions for {len(suggestions_list)} words")
        
        return SuggestReplacementsResponse(
            job_id=job_id,
            suggestions=suggestions_list,
            message=f"Generated {len(suggestions_list)} word suggestions"
        )
        
    except Exception as e:
        logger.error(f"Word suggestion failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

