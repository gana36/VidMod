"""
VidMod Pydantic Models
Request/Response schemas for API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Tuple
from enum import Enum


class JobStatus(str, Enum):
    """Status of a processing job."""
    PENDING = "pending"
    EXTRACTING_FRAMES = "extracting_frames"
    DETECTING_OBJECTS = "detecting_objects"
    GENERATING_MASKS = "generating_masks"
    INPAINTING = "inpainting"
    RECONSTRUCTING = "reconstructing"
    COMPLETED = "completed"
    FAILED = "failed"


class BoundingBox(BaseModel):
    """Bounding box coordinates (normalized 0-1)."""
    x1: float = Field(..., ge=0, le=1, description="Left edge (0-1)")
    y1: float = Field(..., ge=0, le=1, description="Top edge (0-1)")
    x2: float = Field(..., ge=0, le=1, description="Right edge (0-1)")
    y2: float = Field(..., ge=0, le=1, description="Bottom edge (0-1)")


class VideoUploadResponse(BaseModel):
    """Response after uploading a video."""
    job_id: str
    message: str
    preview_frame_url: str
    video_info: dict


class DetectionRequest(BaseModel):
    """Request to detect an object in video frames."""
    job_id: str
    text_prompt: Optional[str] = Field(None, description="Text description of object to detect")
    bounding_box: Optional[BoundingBox] = Field(None, description="Bounding box for object")
    frame_index: Optional[int] = Field(0, description="Frame index for bounding box (if provided)")


class DetectionResponse(BaseModel):
    """Response with detected object masks."""
    job_id: str
    status: str
    masks_generated: int
    preview_mask_url: str


class ReplacementRequest(BaseModel):
    """Request to replace detected object."""
    job_id: str
    replacement_prompt: Optional[str] = Field(None, description="Text description of replacement")
    replacement_image_base64: Optional[str] = Field(None, description="Base64 encoded reference image")


class ReplacementResponse(BaseModel):
    """Response after queuing replacement job."""
    job_id: str
    status: str
    message: str


class JobStatusResponse(BaseModel):
    """Current status of a processing job."""
    job_id: str
    status: JobStatus
    progress: float = Field(..., ge=0, le=100, description="Progress percentage")
    current_step: str
    error: Optional[str] = None


class DownloadResponse(BaseModel):
    """Response with download information."""
    job_id: str
    download_url: str
    file_size_mb: float


# ===== SAM-2 Video Segmentation Models =====

class ClickCoordinate(BaseModel):
    """A single click point for video segmentation."""
    x: int = Field(..., description="X coordinate in pixels")
    y: int = Field(..., description="Y coordinate in pixels")
    frame: int = Field(0, ge=0, description="Frame index for this click (0-indexed)")
    label: int = Field(1, ge=0, le=1, description="1=foreground (include), 0=background (exclude)")
    object_id: str = Field("object_1", description="Unique ID for the object being tracked")


class VideoSegmentRequest(BaseModel):
    """Request to segment objects in video using click coordinates."""
    job_id: str = Field(..., description="Job ID from video upload")
    clicks: List[ClickCoordinate] = Field(..., min_length=1, description="Click points for segmentation")
    mask_type: str = Field("highlighted", description="Output mask type: highlighted, green_screen, alpha, composite")
    output_format: str = Field("mp4", description="Output format: mp4, webp, gif")
    video_fps: int = Field(25, ge=1, le=60, description="Output video FPS")
    output_quality: int = Field(80, ge=1, le=100, description="Output quality (1-100)")


class VideoSegmentResponse(BaseModel):
    """Response with video segmentation results."""
    job_id: str
    status: str
    segmented_video_url: Optional[str] = None
    download_path: Optional[str] = None
    mask_urls: dict = Field(default_factory=dict)
    detected_coordinates: Optional[List[dict]] = None  # Show what was detected
    message: str = ""


class TextVideoSegmentRequest(BaseModel):
    """Request to segment objects in video using text prompts (auto-detect coordinates)."""
    job_id: str = Field(..., description="Job ID from video upload")
    objects: List[str] = Field(
        ..., 
        min_length=1,
        description="List of objects to detect and track (e.g., ['coffee cup', 'person'])"
    )
    detection_frame: int = Field(0, ge=0, description="Frame to use for initial object detection")
    mask_type: str = Field("highlighted", description="Output mask type: highlighted, green_screen, alpha, composite")
    output_format: str = Field("mp4", description="Output format: mp4, webp, gif")
    video_fps: int = Field(25, ge=1, le=60, description="Output video FPS")
    output_quality: int = Field(80, ge=1, le=100, description="Output quality (1-100)")


class Sam3SegmentRequest(BaseModel):
    """Request to segment video using SAM3 via Replicate API (requires public video URL)."""
    job_id: str = Field(..., description="Job ID from video upload")
    text_prompt: str = Field(
        ...,
        description="Text description of object to segment (e.g., 'coffee cup', 'person')"
    )
    mask_only: bool = Field(False, description="Return only the mask without overlay")
    mask_color: str = Field("green", description="Mask overlay color (green, red, blue, etc.)")
    mask_opacity: float = Field(0.5, ge=0.0, le=1.0, description="Mask overlay opacity (0.0 - 1.0)")


class Sam3SegmentResponse(BaseModel):
    """Response from SAM3 video segmentation."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    output_url: Optional[str] = None
    text_prompt: str = ""
    message: str = ""


class ReplaceObjectRequest(BaseModel):
    """Request to replace masked object in video using Wan 2.1 inpainting."""
    job_id: str = Field(..., description="Job ID with SAM3 segmentation")
    replacement_prompt: str = Field(
        ...,
        description="Text describing the replacement object (e.g., 'a red Coca-Cola can')"
    )
    num_frames: int = Field(81, ge=1, le=200, description="Number of output frames")
    guidance_scale: float = Field(5.0, ge=1.0, le=20.0, description="Guidance scale")


class ReplaceObjectResponse(BaseModel):
    """Response from object replacement."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    output_url: Optional[str] = None
    replacement_prompt: str = ""
    message: str = ""


class FramewiseReplaceRequest(BaseModel):
    """Request for frame-by-frame object replacement using Gemini."""
    job_id: str = Field(..., description="Job ID from video upload")
    object_prompt: str = Field(
        ...,
        description="What object to find (e.g., 'coffee cup')"
    )
    replacement_prompt: str = Field(
        ...,
        description="What to replace it with (e.g., 'red Coca-Cola can')"
    )
    reference_image_url: Optional[str] = Field(
        None,
        description="Optional URL to reference image for the replacement"
    )
    frame_interval: int = Field(
        10, ge=1, le=100,
        description="Process every Nth frame (default 10)"
    )


class FramewiseReplaceResponse(BaseModel):
    """Response from frame-by-frame replacement."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    frames_processed: int = 0
    frames_total: int = 0
    message: str = ""


class VaceReplaceRequest(BaseModel):
    """Request for VACE video inpainting (fal.ai)."""
    job_id: str = Field(..., description="Job ID from video upload")
    prompt: str = Field(
        "",
        description="Text prompt for replacement content (e.g., 'red Coca-Cola can')"
    )
    num_inference_steps: int = Field(30, ge=10, le=50, description="Diffusion steps")
    guidance_scale: float = Field(7.0, ge=1.0, le=10.0, description="Prompt guidance (max 10)")


class VaceReplaceResponse(BaseModel):
    """Response from VACE video inpainting."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    video_url: Optional[str] = None
    message: str = ""


class NanoBananaRequest(BaseModel):
    """Request for Nano Banana frame-by-frame with mask support."""
    job_id: str = Field(..., description="Job ID from video upload")
    object_prompt: str = Field("object", description="What object is being replaced")
    replacement_prompt: str = Field(..., description="What to replace it with (e.g., 'soda bottle')")
    frame_interval: int = Field(1, ge=1, le=100, description="Process every Nth frame")
    use_composite: bool = Field(False, description="Use composite image trick for single-image models")


class NanoBananaResponse(BaseModel):
    """Response from Nano Banana frame-by-frame editing."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    frames_processed: int = 0
    frames_total: int = 0
    message: str = ""


class PikaReplaceRequest(BaseModel):
    """Request for Pika Labs object replacement."""
    job_id: str = Field(..., description="Job ID from video upload")
    prompt: str = Field(
        ...,
        description="Description of object to add/replace (e.g., 'Coca-Cola bottle held in hand')"
    )
    negative_prompt: str = Field(
        "blurry, distorted, low quality, deformed",
        description="What to avoid in generation"
    )
    duration: int = Field(5, ge=1, le=10, description="Output duration in seconds")


class PikaReplaceResponse(BaseModel):
    """Response from Pika Labs object replacement."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    video_url: Optional[str] = None
    message: str = ""


class BlurEffectRequest(BaseModel):
    """Request to apply blur effect to masked region (like Meta's Segment Anything demo)."""
    job_id: str = Field(..., description="Job ID from video upload")
    text_prompt: str = Field(
        ...,
        description="Text description of object to blur (e.g., 'face', 'logo', 'license plate')"
    )
    blur_strength: int = Field(30, ge=5, le=100, description="Blur intensity (10-50 recommended)")
    effect_type: str = Field("blur", description="Effect type: 'blur' or 'pixelate'")
    start_time: Optional[float] = Field(None, description="Start time in seconds for clip processing (Smart Clipping optimization)")
    end_time: Optional[float] = Field(None, description="End time in seconds for clip processing (Smart Clipping optimization)")


class BlurEffectResponse(BaseModel):
    """Response from blur effect application."""
    job_id: str
    status: str
    download_path: Optional[str] = None
    text_prompt: str = ""
    message: str = ""


class ManualAction(BaseModel):
    """A suggested action for a manual edit."""
    id: str
    type: str  # 'blur', 'replace', 'mute'
    label: str
    description: str


class ManualAnalysisRequest(BaseModel):
    """Request for Gemini to analyze a manual bounding box."""
    job_id: str
    timestamp: float
    box: BoundingBox


class ManualAnalysisResponse(BaseModel):
    """Results from Gemini manual analysis."""
    job_id: str
    item_name: str
    reasoning: str
    suggested_actions: List[ManualAction]
    confidence: str


class ObjectDetectionRequest(BaseModel):
    """Request to detect objects in a specific bounding box."""
    job_id: str = Field(..., description="Job ID from video upload")
    timestamp: float = Field(..., description="Video timestamp to extract frame from")
    box: dict = Field(..., description="Bounding box {top, left, width, height} in percentages")


class ObjectDetectionResponse(BaseModel):
    """Response with object suggestions."""
    suggestions: List[str] = Field(default_factory=list)
