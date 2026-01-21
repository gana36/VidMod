"""
Runway Gen-4 Aleph Video Object Replacement Engine.
Uses Runway's direct API for video-to-video editing.
"""

import logging
import os
import httpx
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Runway API endpoints
RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1"
RUNWAY_API_VERSION = "2024-11-06"


class RunwayEngine:
    """
    Video object replacement using Runway Gen-4 Aleph.
    Uses Runway's direct API instead of Replicate.
    """
    
    def __init__(self, api_key: str = None):
        """
        Initialize Runway engine.
        
        Args:
            api_key: Runway API key (from RUNWAY_API_KEY env var)
        """
        self.api_key = api_key or os.getenv("RUNWAY_API_KEY")
        if not self.api_key:
            raise ValueError("RUNWAY_API_KEY not set")
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Runway-Version": RUNWAY_API_VERSION
        }
        
        logger.info("Runway Gen-4 engine initialized (direct API)")
    
    def replace_object(
        self,
        video_path: Path,
        prompt: str,
        reference_image_path: Optional[Path] = None,
        aspect_ratio: str = "16:9",
        duration: int = 5,
        video_url: Optional[str] = None
    ) -> dict:
        """
        Replace/edit object in video using Runway Gen-4.
        Uses Runway's direct video_to_video API.
        
        Args:
            video_path: Path to source video (not used if video_url provided)
            prompt: Text description of desired edit
            reference_image_path: Optional reference image
            aspect_ratio: Output aspect ratio (e.g., "16:9", "1280:720")
            duration: Output duration in seconds
            video_url: Required - publicly accessible video URL with proper Content-Type
            
        Returns:
            Dict with 'video_url' of the result
        """
        logger.info(f"Starting Runway Gen-4 editing...")
        logger.info(f"Prompt: {prompt}")
        
        if not video_url:
            raise ValueError("video_url is required for Runway API. Video must be publicly accessible with proper Content-Type headers.")
        
        logger.info(f"Video URL: {video_url}")
        
        # Convert aspect ratio to Runway format (e.g., "16:9" -> "1280:720")
        ratio_map = {
            "16:9": "1280:720",
            "9:16": "720:1280",
            "1:1": "1024:1024",
            "4:3": "1024:768"
        }
        ratio = ratio_map.get(aspect_ratio, "1280:720")
        
        # Build request payload
        payload = {
            "videoUri": video_url,
            "promptText": prompt,
            "model": "gen4_aleph",
            "ratio": ratio
        }
        
        # Add reference image if provided (need to upload it first)
        if reference_image_path and Path(reference_image_path).exists():
            logger.info(f"Reference image: {reference_image_path}")
            # TODO: Upload reference image to get URL
            logger.warning("Reference image upload not yet implemented for direct Runway API")
        
        logger.info("Calling Runway API...")
        
        try:
            with httpx.Client(timeout=300.0) as client:
                # Create video-to-video task
                response = client.post(
                    f"{RUNWAY_API_BASE}/video_to_video",
                    headers=self.headers,
                    json=payload
                )
                
                response.raise_for_status()
                result = response.json()
                
                logger.info(f"Runway task created: {result}")
                
                # Get task ID
                task_id = result.get("id")
                if not task_id:
                    raise ValueError("No task ID in Runway response")
                
                # Poll for completion
                logger.info(f"Polling task {task_id}...")
                video_url = self._poll_task(client, task_id)
                
                return {
                    "video_url": video_url,
                    "result": result
                }
                
        except httpx.HTTPStatusError as e:
            logger.error(f"Runway API HTTP error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Runway API failed: {e}")
            raise
    
    def _poll_task(self, client: httpx.Client, task_id: str, max_wait: int = 300) -> str:
        """
        Poll Runway task until completion.
        
        Args:
            client: HTTP client
            task_id: Runway task ID
            max_wait: Maximum wait time in seconds
            
        Returns:
            URL to the generated video
        """
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            response = client.get(
                f"{RUNWAY_API_BASE}/tasks/{task_id}",
                headers=self.headers
            )
            
            response.raise_for_status()
            task = response.json()
            
            status = task.get("status")
            logger.info(f"Task status: {status}")
            
            if status == "SUCCEEDED":
                # Extract video URL from output
                output = task.get("output")
                if isinstance(output, list) and len(output) > 0:
                    video_url = output[0]
                elif isinstance(output, str):
                    video_url = output
                else:
                    video_url = task.get("outputUri") or task.get("videoUri")
                
                if not video_url:
                    raise ValueError(f"No video URL in completed task: {task}")
                
                logger.info(f"✅ Task completed: {video_url}")
                return video_url
            
            elif status == "FAILED":
                error = task.get("error") or task.get("failure")
                raise RuntimeError(f"Runway task failed: {error}")
            
            # Still processing, wait and retry
            time.sleep(5)
        
        raise TimeoutError(f"Runway task {task_id} did not complete within {max_wait}s")
    
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
        """
        video_url = kwargs.get('video_url')
        
        result = self.replace_object(
            video_path=video_path,
            prompt=prompt,
            reference_image_path=reference_image_path,
            video_url=video_url,
            **{k: v for k, v in kwargs.items() if k != 'video_url'}
        )
        
        result_url = result.get("video_url")
        if not result_url:
            raise ValueError("No video URL in Runway response")
        
        # Download the result
        logger.info(f"Downloading result to {output_path}")
        
        with httpx.Client(timeout=300.0) as client:
            response = client.get(result_url, follow_redirects=True)
            response.raise_for_status()
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(response.content)
        
        logger.info(f"Downloaded: {output_path}")
        return output_path
