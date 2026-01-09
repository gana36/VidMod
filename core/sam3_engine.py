"""
SAM3 Engine - Video segmentation with text prompts using SAM3 via Replicate API.
Uses lucataco/sam3-video on Replicate for cloud-based inference.
Supports both local file uploads and public URLs.
"""

import logging
import os
from pathlib import Path
from typing import List, Optional, Dict, Any, Union
import replicate
import httpx

logger = logging.getLogger(__name__)

# Replicate model for SAM3 Video
SAM3_VIDEO_MODEL = "lucataco/sam3-video:8cbab4c2a3133e679b5b863b80527f6b5c751ec7b33681b7e0b7c79c749df961"


class Sam3VideoEngine:
    """
    Video segmentation with text prompts using SAM3 via Replicate API.
    Supports text prompts like "person", "coffee cup", etc.
    Works with both local files and public URLs.
    """
    
    def __init__(self, api_token: str = None):
        """
        Initialize SAM3 Video engine with Replicate API.
        
        Args:
            api_token: Replicate API token (or uses REPLICATE_API_TOKEN env var)
        """
        self.api_token = api_token or os.getenv("REPLICATE_API_TOKEN")
        if not self.api_token:
            raise ValueError("REPLICATE_API_TOKEN not set")
        
        os.environ["REPLICATE_API_TOKEN"] = self.api_token
        logger.info("SAM3 Video engine initialized with Replicate API")
    
    def segment_video(
        self,
        video_source: Union[str, Path],
        prompt: str,
        mask_only: bool = False,
        mask_color: str = "green",
        mask_opacity: float = 0.5,
        return_zip: bool = False
    ) -> Dict[str, Any]:
        """
        Segment video using text prompt via SAM3.
        
        Args:
            video_source: Local file path OR public URL of the video
            prompt: Text description of object to segment (e.g., "person", "coffee cup")
            mask_only: Return only the mask without overlay
            mask_color: Color for the mask overlay (green, red, blue, etc.)
            mask_opacity: Opacity of the mask overlay (0.0 - 1.0)
            return_zip: Return results as a zip file
            
        Returns:
            Dict with 'output_url' for the segmented video/result
        """
        logger.info(f"Segmenting video with SAM3, prompt: '{prompt}'")
        
        # Determine if it's a local file or URL
        video_input = self._prepare_video_input(video_source)
        
        try:
            output = replicate.run(
                SAM3_VIDEO_MODEL,
                input={
                    "video": video_input,
                    "prompt": prompt,
                    "mask_only": mask_only,
                    "mask_color": mask_color,
                    "return_zip": return_zip,
                    "mask_opacity": mask_opacity
                }
            )
            
            # Get the output URL
            output_url = None
            if hasattr(output, 'url'):
                output_url = output.url
            elif isinstance(output, str):
                output_url = output
            elif isinstance(output, list) and len(output) > 0:
                output_url = output[0] if isinstance(output[0], str) else str(output[0])
            
            logger.info(f"SAM3 segmentation complete, output: {output_url}")
            
            return {
                "output_url": output_url,
                "output": output,
                "prompt": prompt
            }
            
        except Exception as e:
            logger.error(f"SAM3 segmentation failed: {e}")
            raise
    
    def _prepare_video_input(self, video_source: Union[str, Path]):
        """
        Prepare video input for Replicate API.
        If it's a local file, open it for upload.
        If it's a URL, return as-is.
        
        Args:
            video_source: Local file path or URL
            
        Returns:
            File object or URL string
        """
        # Convert to Path if string
        if isinstance(video_source, str):
            # Check if it's a URL
            if video_source.startswith(('http://', 'https://', 'data:')):
                logger.info(f"Using video URL: {video_source}")
                return video_source
            # Otherwise treat as file path
            video_source = Path(video_source)
        
        # It's a local file path
        if isinstance(video_source, Path):
            if not video_source.exists():
                raise ValueError(f"Video file not found: {video_source}")
            
            logger.info(f"Uploading local video file: {video_source}")
            # Return file handle - Replicate will upload it
            return open(video_source, 'rb')
        
        return video_source
    
    def download_result(self, url: str, output_path: Path) -> Path:
        """
        Download the segmented video result.
        
        Args:
            url: URL of the segmented video
            output_path: Path to save the downloaded file
            
        Returns:
            Path to the downloaded file
        """
        logger.info(f"Downloading SAM3 result to {output_path}")
        
        with httpx.Client(timeout=300.0) as client:
            response = client.get(url, follow_redirects=True)
            response.raise_for_status()
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(response.content)
        
        logger.info(f"Downloaded to {output_path}")
        return output_path
