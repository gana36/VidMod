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
