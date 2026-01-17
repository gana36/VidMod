"""
VidMod Pipeline Module
Orchestrates the full video processing workflow.
"""

import uuid
import shutil
import logging
from pathlib import Path
from typing import Optional, Callable, Dict, Any
from dataclasses import dataclass, field
from enum import Enum

from .frame_extractor import FrameExtractor
from .segmentation import SegmentationEngine, VideoSegmentationEngine
from .inpainting import InpaintingEngine
from .video_builder import VideoBuilder

logger = logging.getLogger(__name__)


class PipelineStage(str, Enum):
    """Pipeline processing stages."""
    INITIALIZED = "initialized"
    EXTRACTING_FRAMES = "extracting_frames"
    DETECTING_OBJECTS = "detecting_objects"
    GENERATING_MASKS = "generating_masks"
    VIDEO_SEGMENTING = "video_segmenting"  # SAM-2 Video segmentation
    INPAINTING = "inpainting"
    RECONSTRUCTING = "reconstructing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class JobState:
    """State container for a processing job."""
    job_id: str
    video_path: Optional[Path] = None
    frames_dir: Optional[Path] = None
    masks_dir: Optional[Path] = None
    inpainted_dir: Optional[Path] = None
    output_path: Optional[Path] = None
    audio_path: Optional[Path] = None
    
    video_info: Dict[str, Any] = field(default_factory=dict)
    frame_paths: list = field(default_factory=list)
    mask_paths: list = field(default_factory=list)
    inpainted_paths: list = field(default_factory=list)
    
    stage: PipelineStage = PipelineStage.INITIALIZED
    progress: float = 0
    error: Optional[str] = None
    
    # Detection settings
    text_prompt: Optional[str] = None
    bounding_box: Optional[tuple] = None
    
    # Replacement settings
    replacement_prompt: Optional[str] = None
    replacement_image: Optional[str] = None
    
    # Video segmentation (SAM-2 Video)
    segmented_video_path: Optional[Path] = None
    segmented_video_url: Optional[str] = None


class VideoPipeline:
    """
    Main orchestrator for video object replacement pipeline.
    
    Workflow:
    1. Upload video → extract frames
    2. Detect object (text prompt or bounding box)
    3. Generate masks for all frames
    4. Inpaint replacement
    5. Reconstruct video
    """
    
    def __init__(
        self,
        replicate_api_token: str,
        base_storage_dir: Path,
        keyframe_interval: int = 5,
        ffmpeg_path: str = "ffmpeg",
        ffprobe_path: str = "ffprobe"
    ):
        self.ffmpeg_path = ffmpeg_path  # Store for blur/pixelate effects
        self.ffprobe_path = ffprobe_path
        self.frame_extractor = FrameExtractor(ffmpeg_path=ffmpeg_path, ffprobe_path=ffprobe_path)
        self.video_builder = VideoBuilder(ffmpeg_path=ffmpeg_path)
        
        # Lazy-initialized engines (require Replicate token)
        self._segmentation = None
        self._video_segmentation = None
        self._inpainting = None
        
        self.base_storage_dir = base_storage_dir
        self.keyframe_interval = keyframe_interval
        self.replicate_api_token = replicate_api_token
        
        # In-memory job storage (use Redis/DB for production)
        self.jobs: Dict[str, JobState] = {}
    
    @property
    def segmentation(self) -> SegmentationEngine:
        """Lazy-load segmentation engine."""
        if self._segmentation is None:
            if not self.replicate_api_token:
                raise ValueError("Replicate API token required for segmentation")
            self._segmentation = SegmentationEngine(self.replicate_api_token)
        return self._segmentation
    
    @property
    def video_segmentation(self) -> VideoSegmentationEngine:
        """Lazy-load video segmentation engine."""
        if self._video_segmentation is None:
            if not self.replicate_api_token:
                raise ValueError("Replicate API token required for video segmentation")
            self._video_segmentation = VideoSegmentationEngine(self.replicate_api_token)
        return self._video_segmentation
    
    @property
    def inpainting(self) -> InpaintingEngine:
        """Lazy-load inpainting engine."""
        if self._inpainting is None:
            if not self.replicate_api_token:
                raise ValueError("Replicate API token required for inpainting")
            self._inpainting = InpaintingEngine(self.replicate_api_token)
        return self._inpainting
    
    def _get_job_dir(self, job_id: str) -> Path:
        """Get the directory for a specific job."""
        job_dir = self.base_storage_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        return job_dir
    
    def create_job(self, video_path: Path) -> JobState:
        """Create a new processing job."""
        job_id = str(uuid.uuid4())[:8]
        job_dir = self._get_job_dir(job_id)
        
        # Copy video to job directory
        job_video_path = job_dir / f"input{video_path.suffix}"
        shutil.copy(video_path, job_video_path)
        
        job = JobState(
            job_id=job_id,
            video_path=job_video_path,
            frames_dir=job_dir / "frames",
            masks_dir=job_dir / "masks",
            inpainted_dir=job_dir / "inpainted",
            output_path=job_dir / "output.mp4",
            audio_path=job_dir / "audio.aac"
        )
        
        self.jobs[job_id] = job
        return job
    
    def get_job(self, job_id: str) -> Optional[JobState]:
        """Get job state by ID."""
        return self.jobs.get(job_id)
    
    def extract_frames(self, job_id: str) -> JobState:
        """Extract frames from uploaded video."""
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        job.stage = PipelineStage.EXTRACTING_FRAMES
        job.progress = 5
        
        try:
            # Extract frames
            frames, video_info = self.frame_extractor.extract_frames(
                job.video_path,
                job.frames_dir
            )
            job.frame_paths = frames
            job.video_info = video_info
            
            # Extract audio
            self.frame_extractor.extract_audio(job.video_path, job.audio_path)
            
            job.progress = 15
            logger.info(f"Job {job_id}: Extracted {len(frames)} frames")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            raise
        
        return job
    
    def detect_object(
        self,
        job_id: str,
        text_prompt: Optional[str] = None,
        bounding_box: Optional[tuple] = None
    ) -> JobState:
        """Detect and generate masks for target object."""
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        if not text_prompt and not bounding_box:
            raise ValueError("Either text_prompt or bounding_box required")
        
        job.stage = PipelineStage.GENERATING_MASKS
        job.text_prompt = text_prompt
        job.bounding_box = bounding_box
        job.progress = 20
        
        try:
            if text_prompt:
                # Use Grounded SAM with text
                masks = self.segmentation.segment_frames(
                    job.frame_paths,
                    text_prompt,
                    job.masks_dir,
                    keyframe_interval=self.keyframe_interval
                )
            else:
                # Use SAM with bounding box on first frame, track rest
                first_mask = job.masks_dir / "mask_000000.png"
                self.segmentation.segment_with_box(
                    job.frame_paths[0],
                    bounding_box,
                    first_mask
                )
                # For simplicity, apply same mask to all frames
                # (In production, use object tracking)
                masks = [first_mask] * len(job.frame_paths)
            
            job.mask_paths = masks
            job.progress = 50
            logger.info(f"Job {job_id}: Generated {len(masks)} masks")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            raise
        
        return job
    
    def replace_object(
        self,
        job_id: str,
        replacement_prompt: Optional[str] = None,
        replacement_image: Optional[str] = None
    ) -> JobState:
        """Replace masked object in all frames."""
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        if not replacement_prompt and not replacement_image:
            raise ValueError("Either replacement_prompt or replacement_image required")
        
        job.stage = PipelineStage.INPAINTING
        job.replacement_prompt = replacement_prompt
        job.replacement_image = replacement_image
        job.progress = 55
        
        try:
            prompt = replacement_prompt or "natural replacement object"
            
            inpainted = self.inpainting.inpaint_frames(
                job.frame_paths,
                job.mask_paths,
                prompt,
                job.inpainted_dir,
                seed=42  # Consistent seed for temporal coherence
            )
            
            job.inpainted_paths = inpainted
            job.progress = 85
            logger.info(f"Job {job_id}: Inpainted {len(inpainted)} frames")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            raise
        
        return job
    
    def reconstruct_video(self, job_id: str) -> JobState:
        """Reconstruct video from processed frames."""
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        job.stage = PipelineStage.RECONSTRUCTING
        job.progress = 90
        
        try:
            fps = job.video_info.get("extracted_fps", 30)
            audio = job.audio_path if job.audio_path.exists() else None
            
            self.video_builder.build_video(
                job.inpainted_dir,
                job.output_path,
                fps=fps,
                audio_path=audio
            )
            
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            logger.info(f"Job {job_id}: Video reconstruction complete")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            raise
        
        return job
    
    def segment_video_with_clicks(
        self,
        job_id: str,
        click_coordinates: list,
        click_frames: list = None,
        click_labels: list = None,
        object_ids: list = None,
        mask_type: str = "highlighted",
        output_format: str = "mp4",
        video_fps: int = 25,
        output_quality: int = 80
    ) -> "JobState":
        """
        Segment video using SAM-2 Video with click-based prompts.
        Requires video to be uploaded to a public URL first.
        
        Args:
            job_id: Job ID from create_job
            click_coordinates: List of (x, y) pixel coordinates
            click_frames: Frame index for each click (default: all frame 0)
            click_labels: 1=foreground, 0=background for each click
            object_ids: Unique ID for each object
            mask_type: highlighted, green_screen, alpha, composite
            output_format: mp4, webp, gif
            video_fps: Output FPS
            output_quality: Quality 1-100
            
        Returns:
            Updated JobState with segmented video
        """
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        job.stage = PipelineStage.VIDEO_SEGMENTING
        job.progress = 20
        
        try:
            # For SAM-2 Video, we need a public URL to the video
            # In production, you'd upload to cloud storage
            # For now, we'll raise an error if video_path is local
            video_url = job.video_info.get("video_url")
            
            if not video_url:
                raise ValueError(
                    "Video must be accessible via public URL for SAM-2 Video. "
                    "Upload the video to cloud storage and set video_url in video_info."
                )
            
            # Call SAM-2 Video
            result = self.video_segmentation.segment_video(
                video_url=video_url,
                click_coordinates=click_coordinates,
                click_frames=click_frames,
                click_labels=click_labels,
                object_ids=object_ids,
                mask_type=mask_type,
                output_format=output_format,
                video_fps=video_fps,
                output_quality=output_quality
            )
            
            job.segmented_video_url = result.get("video_url")
            job.progress = 80
            
            # Download the segmented video
            if job.segmented_video_url:
                job_dir = self._get_job_dir(job_id)
                ext = output_format if output_format != "mp4" else "mp4"
                output_path = job_dir / f"segmented.{ext}"
                
                self.video_segmentation.download_result(
                    job.segmented_video_url,
                    output_path
                )
                job.segmented_video_path = output_path
            
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            logger.info(f"Job {job_id}: Video segmentation complete")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"Video segmentation failed: {e}")
            raise
        
        return job
    
    def segment_video_with_text(
        self,
        job_id: str,
        object_prompts: list,
        detection_frame: int = 0,
        mask_type: str = "highlighted",
        output_format: str = "mp4",
        video_fps: int = 25,
        output_quality: int = 80
    ) -> tuple:
        """
        Segment video using text prompts - automatically detects objects and tracks them.
        
        Args:
            job_id: Job ID from create_job
            object_prompts: List of text prompts describing objects (e.g., ["coffee cup", "person"])
            detection_frame: Which frame to use for initial object detection
            mask_type: highlighted, green_screen, alpha, composite
            output_format: mp4, webp, gif
            video_fps: Output FPS
            output_quality: Quality 1-100
            
        Returns:
            Tuple of (JobState, detected_coordinates_list)
        """
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        if not job.frame_paths:
            raise ValueError("Frames not extracted. Run extract_frames first.")
        
        if detection_frame >= len(job.frame_paths):
            raise ValueError(f"Detection frame {detection_frame} out of range (max: {len(job.frame_paths) - 1})")
        
        job.stage = PipelineStage.DETECTING_OBJECTS
        job.progress = 10
        
        detected_coords = []
        
        try:
            # Step 1: Detect each object and get coordinates
            frame_path = job.frame_paths[detection_frame]
            logger.info(f"Detecting {len(object_prompts)} objects in frame {detection_frame}")
            
            for i, prompt in enumerate(object_prompts):
                # Add delay between API calls to avoid rate limits
                if i > 0:
                    import time
                    time.sleep(10)  # 10 second delay between detections
                
                # Retry logic for rate limits
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        coords = self.segmentation.detect_object_coordinates(frame_path, prompt)
                        object_id = f"{prompt.replace(' ', '_')}_{i+1}"
                        detected_coords.append({
                            "object_id": object_id,
                            "prompt": prompt,
                            "x": coords[0],
                            "y": coords[1],
                            "frame": detection_frame
                        })
                        logger.info(f"Detected '{prompt}' at ({coords[0]}, {coords[1]})")
                        break
                    except Exception as e:
                        error_str = str(e)
                        if "429" in error_str and attempt < max_retries - 1:
                            import time
                            wait_time = 15 * (attempt + 1)  # Exponential backoff
                            logger.warning(f"Rate limited, waiting {wait_time}s before retry...")
                            time.sleep(wait_time)
                        else:
                            logger.warning(f"Failed to detect '{prompt}': {e}")
                            break
            
            if not detected_coords:
                raise RuntimeError("No objects could be detected from the provided prompts")
            
            job.progress = 30
            
            # Step 2: Use detected coordinates with SAM-2 Video
            job.stage = PipelineStage.VIDEO_SEGMENTING
            
            video_url = job.video_info.get("video_url")
            if not video_url:
                raise ValueError(
                    "Video must be accessible via public URL for SAM-2 Video. "
                    "Upload the video to cloud storage and set video_url in video_info."
                )
            
            click_coordinates = [(d["x"], d["y"]) for d in detected_coords]
            click_frames = [d["frame"] for d in detected_coords]
            click_labels = [1] * len(detected_coords)  # All foreground
            object_ids = [d["object_id"] for d in detected_coords]
            
            result = self.video_segmentation.segment_video(
                video_url=video_url,
                click_coordinates=click_coordinates,
                click_frames=click_frames,
                click_labels=click_labels,
                object_ids=object_ids,
                mask_type=mask_type,
                output_format=output_format,
                video_fps=video_fps,
                output_quality=output_quality
            )
            
            job.segmented_video_url = result.get("video_url")
            job.progress = 80
            
            # Download the segmented video
            if job.segmented_video_url:
                job_dir = self._get_job_dir(job_id)
                ext = output_format if output_format != "mp4" else "mp4"
                output_path = job_dir / f"segmented.{ext}"
                
                self.video_segmentation.download_result(
                    job.segmented_video_url,
                    output_path
                )
                job.segmented_video_path = output_path
            
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            logger.info(f"Job {job_id}: Text-based video segmentation complete")
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"Text-based video segmentation failed: {e}")
            raise
        
        return job, detected_coords
    
    def segment_video_with_sam3(
        self,
        job_id: str,
        text_prompt: str,
        mask_only: bool = False,
        mask_color: str = "green",
        mask_opacity: float = 0.5
    ) -> "JobState":
        """
        Segment video using SAM3 with text prompt via Replicate API.
        
        Args:
            job_id: Job ID from create_job
            text_prompt: Text description of object to segment (e.g., "coffee cup", "person")
            mask_only: Return only the mask without overlay
            mask_color: Color for the mask overlay
            mask_opacity: Opacity of the mask overlay
            
        Returns:
            Updated JobState
        """
        from .sam3_engine import Sam3VideoEngine
        
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        # Get video path - use local file (job.video_path) or URL
        video_info = job.video_info or {}
        video_source = video_info.get("video_url") or job.video_path
        
        if not video_source:
            raise ValueError(
                "No video source found. Upload a video first via /upload."
            )
        
        # Convert to string if it's a Path
        if isinstance(video_source, Path):
            video_source = str(video_source)
        
        # Check if local file exists
        if not video_source.startswith(('http://', 'https://')):
            if not Path(video_source).exists():
                raise ValueError(f"Video file not found: {video_source}")
        
        job.stage = PipelineStage.VIDEO_SEGMENTING
        job.progress = 10
        
        try:
            # Initialize SAM3 Video engine
            logger.info("Initializing SAM3 Video engine (Replicate)...")
            sam3_video = Sam3VideoEngine(api_token=self.replicate_api_token)
            
            job.progress = 20
            
            # Segment video with text prompt (supports both local files and URLs)
            logger.info(f"Segmenting video with SAM3, prompt: '{text_prompt}'")
            logger.info(f"Video source: {video_source}")
            result = sam3_video.segment_video(
                video_source=video_source,
                prompt=text_prompt,
                mask_only=mask_only,
                mask_color=mask_color,
                mask_opacity=mask_opacity
            )
            
            job.progress = 70
            
            # Download the result
            output_url = result.get("output_url")
            if output_url:
                job_dir = self._get_job_dir(job_id)
                output_path = job_dir / "segmented_sam3.mp4"
                
                sam3_video.download_result(output_url, output_path)
                job.segmented_video_path = output_path
                job.segmented_video_url = output_url
            
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            
            logger.info(f"Job {job_id}: SAM3 video segmentation complete with prompt '{text_prompt}'")
            
            return job
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"SAM3 video segmentation failed: {e}")
            raise
    
    def replace_object(
        self,
        job_id: str,
        replacement_prompt: str,
        num_frames: int = 81,
        guidance_scale: float = 5.0
    ) -> "JobState":
        """
        Replace masked object in video using Wan 2.1 inpainting.
        
        Requires SAM3 segmentation to have been run first with mask_only=True.
        
        Args:
            job_id: Job ID from create_job (must have segmented_video_path from SAM3)
            replacement_prompt: Text describing replacement (e.g., "a red Coca-Cola can")
            num_frames: Number of output frames
            guidance_scale: Guidance scale for generation
            
        Returns:
            Updated JobState with replaced_video_path
        """
        from .inpaint_engine import WanInpaintingEngine
        
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        # Check for original video
        if not job.video_path or not job.video_path.exists():
            raise ValueError("Original video not found. Upload video first via /upload.")
        
        # Check for mask video (from SAM3 with mask_only=True)
        if not job.segmented_video_path or not job.segmented_video_path.exists():
            raise ValueError(
                "Mask video not found. Run SAM3 segmentation first with mask_only=True."
            )
        
        job.stage = PipelineStage.INPAINTING
        job.progress = 10
        
        try:
            # Initialize Wan inpainting engine
            logger.info("Initializing Wan 2.1 Inpainting engine...")
            inpainter = WanInpaintingEngine(api_token=self.replicate_api_token)
            
            job.progress = 20
            
            # Replace object
            logger.info(f"Replacing object with prompt: '{replacement_prompt}'")
            result = inpainter.replace_object(
                video_path=str(job.video_path),
                mask_path=str(job.segmented_video_path),
                prompt=replacement_prompt,
                num_frames=num_frames,
                guidance_scale=guidance_scale
            )
            
            job.progress = 70
            
            # Download the result
            output_url = result.get("output_url")
            if output_url:
                job_dir = self._get_job_dir(job_id)
                output_path = job_dir / "replaced_object.mp4"
                
                inpainter.download_result(output_url, output_path)
                job.output_path = output_path
            
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            
            logger.info(f"Job {job_id}: Object replacement complete with prompt '{replacement_prompt}'")
            
            return job
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"Object replacement failed: {e}")
            raise
    
    def replace_object_framewise(
        self,
        job_id: str,
        object_prompt: str,
        replacement_prompt: str,
        reference_image_path: Optional[Path] = None,
        frame_interval: int = 10
    ) -> "JobState":
        """
        Replace object in video frame-by-frame using Gemini image editing.
        
        Args:
            job_id: Job ID from create_job
            object_prompt: What object to find (e.g., "coffee cup")
            replacement_prompt: What to replace with (e.g., "red Coca-Cola can")
            reference_image_path: Optional path to reference image
            frame_interval: Process every Nth frame (default 10)
            
        Returns:
            Updated JobState with output_path
        """
        from .gemini_inpaint_engine import GeminiInpaintEngine
        
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        if not job.frame_paths:
            raise ValueError("Frames not extracted. Upload video first via /upload.")
        
        job.stage = PipelineStage.INPAINTING
        job.progress = 5
        
        try:
            # Initialize Gemini engine
            logger.info("Initializing Gemini Inpaint engine...")
            from app.config import get_settings
            settings = get_settings()
            gemini = GeminiInpaintEngine(api_key=settings.gemini_api_key)
            
            job.progress = 10
            
            # Process frames
            job_dir = self._get_job_dir(job_id)
            edited_dir = job_dir / "edited_frames"
            
            def progress_update(pct, msg):
                job.progress = 10 + (pct * 0.7)  # 10-80%
                logger.info(f"Progress: {pct:.1f}% - {msg}")
            
            edited_paths = gemini.process_frames(
                frame_paths=job.frame_paths,
                object_prompt=object_prompt,
                replacement_prompt=replacement_prompt,
                reference_image_path=reference_image_path,
                frame_interval=frame_interval,
                output_dir=edited_dir,
                progress_callback=progress_update
            )
            
            job.progress = 80
            
            # Build output video
            output_path = job_dir / "replaced_framewise.mp4"
            video_info = job.video_info or {}
            fps = video_info.get("fps", 25)
            
            self.video_builder.build_video(
                frames_dir=edited_dir,
                output_path=output_path,
                fps=fps,
                audio_path=job.audio_path if job.audio_path and job.audio_path.exists() else None
            )
            
            job.output_path = output_path
            job.inpainted_paths = edited_paths
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            
            logger.info(f"Job {job_id}: Framewise replacement complete - {len(edited_paths)} frames")
            
            return job
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"Framewise replacement failed: {e}")
            raise
    
    def replace_with_vace(
        self,
        job_id: str,
        prompt: str = "",
        reference_image_path: Optional[Path] = None,
        num_inference_steps: int = 30,
        guidance_scale: float = 5.0
    ) -> "JobState":
        """
        Replace masked object using fal.ai VACE video inpainting.
        
        Requires SAM3 segmentation to be run first with mask_only=True.
        
        Args:
            job_id: Job ID from create_job
            prompt: Text prompt for replacement (optional)
            reference_image_path: Optional path to reference image
            num_inference_steps: Diffusion steps (default 30)
            guidance_scale: Prompt guidance (default 5.0)
            
        Returns:
            Updated JobState with output_path
        """
        from .fal_vace_engine import FalVaceEngine
        
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        if not job.video_path:
            raise ValueError("No video found. Upload video first.")
        
        if not job.segmented_video_path:
            raise ValueError("No mask video found. Run SAM3 segmentation with mask_only=True first.")
        
        job.stage = PipelineStage.INPAINTING
        job.progress = 10
        
        try:
            # Initialize fal.ai VACE engine
            logger.info("Initializing fal.ai VACE engine...")
            from app.config import get_settings
            settings = get_settings()
            vace = FalVaceEngine(api_key=settings.fal_key)
            
            job.progress = 20
            
            # Run VACE inpainting
            job_dir = self._get_job_dir(job_id)
            output_path = job_dir / "replaced_vace.mp4"
            
            result_path = vace.replace_and_download(
                video_path=job.video_path,
                mask_video_path=job.segmented_video_path,
                output_path=output_path,
                prompt=prompt,
                reference_image_path=reference_image_path,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale
            )
            
            job.output_path = result_path
            job.stage = PipelineStage.COMPLETED
            job.progress = 100
            
            logger.info(f"Job {job_id}: VACE replacement complete - {result_path}")
            
            return job
            
        except Exception as e:
            job.stage = PipelineStage.FAILED
            job.error = str(e)
            logger.error(f"VACE replacement failed: {e}")
            raise
    
    def run_full_pipeline(
        self,
        video_path: Path,
        text_prompt: str,
        replacement_prompt: str,
        progress_callback: Optional[Callable[[float, str], None]] = None
    ) -> Path:
        """
        Run the complete pipeline end-to-end.
        
        Args:
            video_path: Path to input video
            text_prompt: Object to detect (e.g., "beer bottle")
            replacement_prompt: What to replace with (e.g., "coca cola can")
            progress_callback: Optional callback for progress updates
            
        Returns:
            Path to output video
        """
        def update(progress: float, stage: str):
            if progress_callback:
                progress_callback(progress, stage)
        
        # Create job
        job = self.create_job(video_path)
        update(5, "Job created")
        
        # Extract frames
        self.extract_frames(job.job_id)
        update(15, f"Extracted {len(job.frame_paths)} frames")
        
        # Detect object
        self.detect_object(job.job_id, text_prompt=text_prompt)
        update(50, "Masks generated")
        
        # Replace object
        self.replace_object(job.job_id, replacement_prompt=replacement_prompt)
        update(85, "Inpainting complete")
        
        # Reconstruct
        self.reconstruct_video(job.job_id)
        update(100, "Complete")
        
        return job.output_path
    
    def cleanup_job(self, job_id: str):
        """Remove all files for a job."""
        job = self.jobs.get(job_id)
        if job:
            job_dir = self._get_job_dir(job_id)
            if job_dir.exists():
                shutil.rmtree(job_dir)
            del self.jobs[job_id]
