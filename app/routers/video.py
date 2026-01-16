"""
VidMod Video Processing Router
API endpoints for video upload, detection, replacement, and download.
"""

import shutil
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends
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
)
from core.pipeline import VideoPipeline, PipelineStage

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
            ffprobe_path=settings.get_ffprobe_path()
        )
    return _pipeline


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
