"""
Pika Labs Video Object Replacement Engine.
Uses fal.ai Pika v2 Pikadditions for adding/replacing objects in videos.
"""

import logging
import os
import fal_client
from pathlib import Path
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

# fal.ai Pika model for object addition/replacement
PIKA_MODEL = "fal-ai/pika/v2/pikadditions"


class PikaEngine:
    """
    Video object replacement using Pika Labs Pikadditions.
    Better at shape-changing object replacement than VACE.
    """
    
    def __init__(self, api_key: str = None):
        """
        Initialize Pika engine.
        
        Args:
            api_key: fal.ai API key (or uses FAL_KEY env var)
        """
        self.api_key = api_key or os.getenv("FAL_KEY")
        if not self.api_key:
            raise ValueError("FAL_KEY not set")
        
        os.environ["FAL_KEY"] = self.api_key
        logger.info("Pika engine initialized")
    
    def _upload_file(self, file_path: Path) -> str:
        """Upload a local file to fal.ai and return the URL."""
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        logger.info(f"Uploading file to fal.ai: {file_path}")
        url = fal_client.upload_file(str(file_path))
        logger.info(f"Uploaded: {url}")
        return url
    
    def replace_object(
        self,
        video_path: Path,
        prompt: str,
        reference_image_path: Optional[Path] = None,
        negative_prompt: str = "",
        duration: int = 5,
        aspect_ratio: str = "16:9"
    ) -> dict:
        """
        Replace/add object in video using Pika Pikadditions.
        
        Args:
            video_path: Path to source video
            prompt: Description of object to add (e.g., "Coca-Cola bottle in hand")
            reference_image_path: Optional reference image for the object
            negative_prompt: What to avoid in generation
            duration: Output video duration in seconds (max 10)
            aspect_ratio: Output aspect ratio
            
        Returns:
            Dict with 'video_url' of the result
        """
        logger.info(f"Starting Pika object replacement...")
        logger.info(f"Video: {video_path}")
        logger.info(f"Prompt: {prompt}")
        
        # Upload video
        video_url = self._upload_file(video_path)
        
        # Build request
        request = {
            "video_url": video_url,
            "prompt": prompt,
            "negative_prompt": negative_prompt or "blurry, distorted, low quality",
            "duration": min(duration, 10),
            "aspect_ratio": aspect_ratio,
        }
        
        # Add reference image if provided
        if reference_image_path and Path(reference_image_path).exists():
            logger.info(f"Using reference image: {reference_image_path}")
            ref_url = self._upload_file(reference_image_path)
            request["image_url"] = ref_url
        
        logger.info("Calling Pika API...")
        
        try:
            result = fal_client.subscribe(
                PIKA_MODEL,
                arguments=request,
                with_logs=True
            )
            
            logger.info(f"Pika result: {result}")
            
            # Extract video URL from result
            video_url = None
            if isinstance(result, dict):
                video_url = result.get("video", {}).get("url") or result.get("video_url")
            
            return {
                "video_url": video_url,
                "result": result
            }
            
        except Exception as e:
            logger.error(f"Pika API failed: {e}")
            raise
    
    def replace_and_download(
        self,
        video_path: Path,
        output_path: Path,
        prompt: str,
        reference_image_path: Optional[Path] = None,
        **kwargs
    ) -> Path:
        """
        Replace object and download the result.
        
        Args:
            video_path: Path to source video
            output_path: Where to save the result
            prompt: Object description
            reference_image_path: Optional reference image
            **kwargs: Additional arguments
            
        Returns:
            Path to downloaded video
        """
        result = self.replace_object(
            video_path=video_path,
            prompt=prompt,
            reference_image_path=reference_image_path,
            **kwargs
        )
        
        video_url = result.get("video_url")
        if not video_url:
            raise ValueError("No video URL in Pika response")
        
        # Download the result
        logger.info(f"Downloading result to {output_path}")
        
        with httpx.Client(timeout=300.0) as client:
            response = client.get(video_url, follow_redirects=True)
            response.raise_for_status()
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(response.content)
        
        logger.info(f"Downloaded: {output_path}")
        return output_path
