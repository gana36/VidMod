"""
VidMod Segmentation Module
Object detection and mask generation using SAM via Replicate.
"""

import replicate
import base64
import httpx
from pathlib import Path
from PIL import Image
import io
import logging
from typing import Optional, Tuple, List
import numpy as np

logger = logging.getLogger(__name__)


class SegmentationEngine:
    """
    Object segmentation using Grounded SAM via Replicate.
    Supports both text prompts and bounding box inputs.
    """
    
    # Replicate model versions - using Grounded SAM for text-based detection
    # schananas/grounded_sam - Grounding DINO + SAM combination
    GROUNDED_SAM_MODEL = "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c"
    SAM_MODEL = "meta/sam-2-base:35a89f6bffa538ba7e7e9e7f7b2eaa7a9e254edf1201a941d86f72e12d9abfa0"
    
    def __init__(self, api_token: str):
        """Initialize with Replicate API token."""
        if not api_token:
            raise ValueError("Replicate API token is required")
        self.client = replicate.Client(api_token=api_token)
    
    def _image_to_base64(self, image_path: Path) -> str:
        """Convert image file to base64 data URI."""
        with open(image_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        
        # Determine mime type
        suffix = image_path.suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp"
        }
        mime_type = mime_types.get(suffix, "image/png")
        
        return f"data:{mime_type};base64,{data}"
    
    def _download_mask(self, url: str, output_path: Path) -> Path:
        """Download mask image from URL."""
        response = httpx.get(url, follow_redirects=True)
        response.raise_for_status()
        
        with open(output_path, "wb") as f:
            f.write(response.content)
        
        return output_path
    
    def segment_with_text(
        self,
        image_path: Path,
        text_prompt: str,
        output_path: Path
    ) -> Path:
        """
        Segment object using text prompt via Grounded SAM.
        
        Args:
            image_path: Path to input image
            text_prompt: Text description of object to segment (e.g., "beer bottle")
            output_path: Path to save the binary mask
            
        Returns:
            Path to the generated mask
        """
        logger.info(f"Segmenting with text prompt: '{text_prompt}'")
        
        image_uri = self._image_to_base64(image_path)
        
        try:
            output = self.client.run(
                self.GROUNDED_SAM_MODEL,
                input={
                    "image": image_uri,
                    "prompt": text_prompt,  # schananas/grounded_sam uses "prompt"
                }
            )
            
            # Handle different output formats from Replicate
            # Output can be: generator, list, FileOutput, or string URL
            mask_url = None
            
            # If it's a generator, consume it to get the actual output
            if hasattr(output, '__iter__') and not isinstance(output, (str, list, dict)):
                output = list(output)
            
            # Now handle the result
            if isinstance(output, list) and len(output) > 0:
                first_item = output[0]
                # Check if it's a FileOutput object with a url attribute
                if hasattr(first_item, 'url'):
                    mask_url = first_item.url
                elif isinstance(first_item, str):
                    mask_url = first_item
                else:
                    mask_url = str(first_item)
            elif isinstance(output, str):
                mask_url = output
            elif hasattr(output, 'url'):
                mask_url = output.url
            else:
                mask_url = str(output)
            
            if not mask_url or not mask_url.startswith('http'):
                raise RuntimeError(f"Invalid mask URL received: {mask_url}")
            
            logger.info(f"Mask generated, downloading from {mask_url}")
            return self._download_mask(mask_url, output_path)
            
        except Exception as e:
            logger.error(f"Segmentation failed: {e}")
            raise RuntimeError(f"Segmentation failed: {e}")
    
    def detect_object_coordinates(
        self,
        image_path: Path,
        text_prompt: str
    ) -> Tuple[int, int]:
        """
        Detect an object using text prompt and return its center coordinates.
        Uses Grounded SAM to detect, then calculates mask centroid.
        
        Args:
            image_path: Path to input image/frame
            text_prompt: Text description of object (e.g., "coffee cup")
            
        Returns:
            Tuple of (x, y) pixel coordinates at the center of the detected object
        """
        import tempfile
        
        logger.info(f"Detecting object coordinates for: '{text_prompt}'")
        
        # Get a temporary path for the mask
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            temp_mask_path = Path(tmp.name)
        
        try:
            # Use Grounded SAM to generate a mask
            self.segment_with_text(image_path, text_prompt, temp_mask_path)
            
            # Load the mask and find the centroid
            with Image.open(temp_mask_path) as mask_img:
                mask_array = np.array(mask_img)
                
                # Convert to binary if needed (handle RGB/RGBA masks)
                if len(mask_array.shape) == 3:
                    # Take first channel or convert to grayscale
                    mask_array = mask_array[:, :, 0] if mask_array.shape[2] >= 1 else np.mean(mask_array, axis=2)
                
                # Find non-zero pixels (the mask)
                non_zero_coords = np.argwhere(mask_array > 127)
                
                if len(non_zero_coords) == 0:
                    raise RuntimeError(f"No object detected for prompt: '{text_prompt}'")
                
                # Calculate centroid (mean of all mask pixel coordinates)
                # argwhere returns (row, col) = (y, x), so we need to flip
                centroid_y = int(np.mean(non_zero_coords[:, 0]))
                centroid_x = int(np.mean(non_zero_coords[:, 1]))
                
                logger.info(f"Object '{text_prompt}' detected at coordinates: ({centroid_x}, {centroid_y})")
                return (centroid_x, centroid_y)
                
        finally:
            # Cleanup temp file
            if temp_mask_path.exists():
                temp_mask_path.unlink()
    
    def segment_with_box(
        self,
        image_path: Path,
        bounding_box: Tuple[float, float, float, float],
        output_path: Path
    ) -> Path:
        """
        Segment object using bounding box via SAM.
        
        Args:
            image_path: Path to input image
            bounding_box: Tuple of (x1, y1, x2, y2) normalized coordinates (0-1)
            output_path: Path to save the binary mask
            
        Returns:
            Path to the generated mask
        """
        # Get image dimensions to convert normalized coords to pixels
        with Image.open(image_path) as img:
            width, height = img.size
        
        x1, y1, x2, y2 = bounding_box
        box_pixels = [
            int(x1 * width),
            int(y1 * height),
            int(x2 * width),
            int(y2 * height)
        ]
        
        logger.info(f"Segmenting with bounding box: {box_pixels}")
        
        image_uri = self._image_to_base64(image_path)
        
        try:
            output = self.client.run(
                self.SAM_MODEL,
                input={
                    "image": image_uri,
                    "box": ",".join(map(str, box_pixels)),
                    "multimask_output": False
                }
            )
            
            # Handle output format
            if isinstance(output, list) and len(output) > 0:
                mask_url = str(output[0])
            else:
                mask_url = str(output)
            
            return self._download_mask(mask_url, output_path)
            
        except Exception as e:
            logger.error(f"Segmentation failed: {e}")
            raise RuntimeError(f"Segmentation failed: {e}")
    
    def segment_frames(
        self,
        frame_paths: List[Path],
        text_prompt: str,
        output_dir: Path,
        keyframe_interval: int = 5,
        rate_limit_delay: float = 0  # No delay needed with $5+ credit
    ) -> List[Path]:
        """
        Segment multiple frames with keyframe optimization.
        Only processes every Nth frame, interpolates masks for in-between frames.
        
        Args:
            frame_paths: List of frame paths
            text_prompt: Text description of object
            output_dir: Directory to save masks
            keyframe_interval: Process every Nth frame
            rate_limit_delay: Seconds to wait between API calls (for free tier)
            
        Returns:
            List of mask paths (one per input frame)
        """
        import time
        
        output_dir.mkdir(parents=True, exist_ok=True)
        masks = []
        keyframe_masks = {}
        
        # Calculate how many keyframes we'll process
        keyframes_to_process = [i for i in range(len(frame_paths)) if i % keyframe_interval == 0]
        total_keyframes = len(keyframes_to_process)
        
        logger.info(f"Processing {total_keyframes} keyframes from {len(frame_paths)} frames (interval={keyframe_interval})")
        logger.info(f"Rate limit delay: {rate_limit_delay}s between API calls")
        
        # Process keyframes with rate limiting
        for idx, i in enumerate(keyframes_to_process):
            frame_path = frame_paths[i]
            mask_path = output_dir / f"mask_{i:06d}.png"
            
            # Rate limiting - wait before each API call (except first)
            if idx > 0 and rate_limit_delay > 0:
                logger.info(f"Rate limiting: waiting {rate_limit_delay}s...")
                time.sleep(rate_limit_delay)
            
            # Retry logic for rate limits
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    self.segment_with_text(frame_path, text_prompt, mask_path)
                    keyframe_masks[i] = mask_path
                    logger.info(f"Processed keyframe {idx+1}/{total_keyframes} (frame {i})")
                    break
                except Exception as e:
                    if "429" in str(e) and attempt < max_retries - 1:
                        wait_time = 15 * (attempt + 1)  # Exponential backoff
                        logger.warning(f"Rate limited, waiting {wait_time}s before retry...")
                        time.sleep(wait_time)
                    else:
                        logger.warning(f"Failed to segment frame {i}: {e}")
                        # Use previous mask if available
                        if keyframe_masks:
                            prev_idx = max(k for k in keyframe_masks.keys() if k < i)
                            keyframe_masks[i] = keyframe_masks[prev_idx]
                        break
        
        # Interpolate/copy masks for all frames
        for i in range(len(frame_paths)):
            mask_path = output_dir / f"mask_{i:06d}.png"
            
            if i in keyframe_masks:
                masks.append(keyframe_masks[i])
            else:
                # Find nearest keyframe mask
                prev_key = max((k for k in keyframe_masks.keys() if k <= i), default=0)
                source_mask = keyframe_masks.get(prev_key)
                
                if source_mask and source_mask.exists():
                    # Copy the mask (simple approach - could do morphological interpolation)
                    import shutil
                    shutil.copy(source_mask, mask_path)
                    masks.append(mask_path)
                else:
                    masks.append(None)
        
        return masks
    
    def create_combined_mask(
        self,
        mask_paths: List[Path],
        output_path: Path
    ) -> Path:
        """Combine multiple masks into a single preview mask."""
        if not mask_paths or not any(m and m.exists() for m in mask_paths):
            raise ValueError("No valid masks to combine")
        
        # Use first valid mask as base
        for mask_path in mask_paths:
            if mask_path and mask_path.exists():
                with Image.open(mask_path) as img:
                    combined = np.array(img)
                break
        
        # OR all masks together
        for mask_path in mask_paths[1:]:
            if mask_path and mask_path.exists():
                with Image.open(mask_path) as img:
                    mask_arr = np.array(img)
                    combined = np.maximum(combined, mask_arr)
        
        # Save combined mask
        Image.fromarray(combined).save(output_path)
        return output_path


class VideoSegmentationEngine:
    """
    Video object segmentation using SAM-2 Video via Replicate.
    Processes entire video at once with click-based prompts for efficient tracking.
    """
    
    SAM2_VIDEO_MODEL = "meta/sam-2-video:33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d"
    
    def __init__(self, api_token: str):
        """Initialize with Replicate API token."""
        if not api_token:
            raise ValueError("Replicate API token is required")
        self.client = replicate.Client(api_token=api_token)
    
    def _format_coordinates(self, coordinates: List[Tuple[int, int]]) -> str:
        """Format click coordinates as required by the API."""
        # Format: "[x1,y1],[x2,y2],..."
        return ",".join(f"[{x},{y}]" for x, y in coordinates)
    
    def _format_list(self, items: List) -> str:
        """Format a list of items as comma-separated string."""
        return ",".join(str(item) for item in items)
    
    def segment_video(
        self,
        video_url: str,
        click_coordinates: List[Tuple[int, int]],
        click_frames: Optional[List[int]] = None,
        click_labels: Optional[List[int]] = None,
        object_ids: Optional[List[str]] = None,
        mask_type: str = "highlighted",
        video_fps: int = 25,
        output_format: str = "mp4",
        output_quality: int = 80,
        annotation_type: str = "mask",
        output_frame_interval: int = 1
    ) -> dict:
        """
        Segment objects in video using click-based prompts.
        
        Args:
            video_url: URL to the input video (must be publicly accessible)
            click_coordinates: List of (x, y) pixel coordinates for clicks
            click_frames: Frame indices for each click (default: all frame 0)
            click_labels: Labels for each click (1=foreground, 0=background)
            object_ids: Unique IDs for each object being tracked
            mask_type: "highlighted", "green_screen", "alpha", or "composite"
            video_fps: Output video FPS
            output_format: "mp4", "webp", or "gif"
            output_quality: Output quality (1-100)
            annotation_type: "mask" or "contour"
            output_frame_interval: Frame interval for output
            
        Returns:
            Dict with 'video_url' and optionally 'mask_urls' for each object
        """
        num_clicks = len(click_coordinates)
        
        # Default values if not provided
        if click_frames is None:
            click_frames = [0] * num_clicks  # All clicks on first frame
        if click_labels is None:
            click_labels = [1] * num_clicks  # All foreground clicks
        if object_ids is None:
            object_ids = [f"object_{i+1}" for i in range(num_clicks)]
        
        # Validate input lengths match
        if len(click_frames) != num_clicks or len(click_labels) != num_clicks or len(object_ids) != num_clicks:
            raise ValueError("click_coordinates, click_frames, click_labels, and object_ids must have the same length")
        
        logger.info(f"Segmenting video with {num_clicks} click points")
        logger.info(f"Object IDs: {object_ids}")
        logger.info(f"Mask type: {mask_type}, Format: {output_format}")
        
        try:
            # Build input parameters
            input_params = {
                "input_video": video_url,
                "click_coordinates": self._format_coordinates(click_coordinates),
                "click_frames": self._format_list(click_frames),
                "click_labels": self._format_list(click_labels),
                "click_object_ids": self._format_list(object_ids),
                "mask_type": mask_type,
                "video_fps": video_fps,
                "output_video": True,
                "output_format": output_format,
                "output_quality": output_quality,
                "annotation_type": annotation_type,
                "output_frame_interval": output_frame_interval
            }
            
            logger.info(f"Calling SAM-2 Video API with params: {input_params}")
            
            # Run the model - it streams output
            output = self.client.run(self.SAM2_VIDEO_MODEL, input=input_params)
            
            # Collect all output items
            result = {
                "video_url": None,
                "mask_urls": {}
            }
            
            for item in output:
                logger.info(f"Received output item: {item}")
                # The model outputs video URL and mask URLs
                if isinstance(item, str):
                    if item.endswith(('.mp4', '.webp', '.gif')):
                        result["video_url"] = item
                    else:
                        # Could be a mask URL
                        result["mask_urls"][f"mask_{len(result['mask_urls'])}"] = item
                elif hasattr(item, 'url'):
                    url = item.url
                    if url.endswith(('.mp4', '.webp', '.gif')):
                        result["video_url"] = url
                    else:
                        result["mask_urls"][f"mask_{len(result['mask_urls'])}"] = url
            
            logger.info(f"Video segmentation complete: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Video segmentation failed: {e}")
            raise RuntimeError(f"Video segmentation failed: {e}")
    
    def download_result(self, url: str, output_path: Path) -> Path:
        """Download a result file (video or mask) from URL."""
        response = httpx.get(url, follow_redirects=True, timeout=120.0)
        response.raise_for_status()
        
        with open(output_path, "wb") as f:
            f.write(response.content)
        
        logger.info(f"Downloaded {url} to {output_path}")
        return output_path
