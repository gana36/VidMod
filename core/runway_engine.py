"""
Runway Gen-4 Aleph Video Object Replacement Engine.
Uses Runway's direct API for video-to-video editing.
"""

import logging
import os
import httpx
import time
import base64
import mimetypes
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
    Supports reference images for grounded object replacement.
    """
    
    def __init__(self, api_key: str = None, gcs_uploader=None):
        """
        Initialize Runway engine.
        
        Args:
            api_key: Runway API key (from RUNWAY_API_KEY env var)
            gcs_uploader: Optional GCSUploader instance for reference image uploads
        """
        self.api_key = api_key or os.getenv("RUNWAY_API_KEY")
        if not self.api_key:
            raise ValueError("RUNWAY_API_KEY not set")
        
        self.gcs_uploader = gcs_uploader
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Runway-Version": RUNWAY_API_VERSION
        }
        
        logger.info("Runway Gen-4 engine initialized (direct API)")
    
    def _encode_image_to_data_uri(self, image_path: Path) -> str:
        """
        Encode a local image to base64 data URI format.
        
        Args:
            image_path: Path to the image file
            
        Returns:
            Data URI string (e.g., "data:image/jpeg;base64,...")
        """
        image_path = Path(image_path)
        
        # Determine MIME type
        mime_type, _ = mimetypes.guess_type(str(image_path))
        if not mime_type:
            mime_type = 'image/jpeg'  # Default fallback
        
        # Read and encode
        with open(image_path, 'rb') as f:
            image_data = f.read()
        
        # Check size (Runway limit: ~3.3MB before encoding)
        if len(image_data) > 3_300_000:
            logger.warning(f"Image is {len(image_data)/1_000_000:.1f}MB - may exceed Runway's 5MB data URI limit")
        
        encoded = base64.b64encode(image_data).decode('utf-8')
        data_uri = f"data:{mime_type};base64,{encoded}"
        
        logger.info(f"Encoded image to data URI ({len(data_uri)/1000:.1f}KB)")
        return data_uri
    
    def _get_image_url(self, image_path: Path, job_id: str = None) -> str:
        """
        Get a URL for the reference image, using GCS if available, else base64.
        
        Args:
            image_path: Path to the local image
            job_id: Optional job ID for organizing GCS uploads
            
        Returns:
            HTTPS URL or data URI for the image
        """
        image_path = Path(image_path)
        
        logger.info(f"🖼️ Processing reference image for Runway: {image_path}")
        logger.info(f"   - File exists: {image_path.exists()}")
        if image_path.exists():
            logger.info(f"   - File size: {image_path.stat().st_size / 1024:.1f} KB")
        
        # Prefer GCS upload if uploader is available
        if self.gcs_uploader:
            try:
                key = f"reference_images/{job_id or 'temp'}_{image_path.name}" if job_id else None
                logger.info(f"📤 Uploading reference image to GCS with key: {key}")
                # Use public URL from GCS
                url = self.gcs_uploader.upload_video(image_path, key=key) # reusing upload_video which handles general file upload
                logger.info(f"✅ Reference image uploaded to GCS: {url}")
                return url
            except Exception as e:
                logger.warning(f"⚠️ GCS upload failed, falling back to base64: {e}")
        else:
            logger.warning("⚠️ GCS uploader not available, using base64 encoding")
        
        # Fallback to base64 data URI
        return self._encode_image_to_data_uri(image_path)
    
    def replace_object(
        self,
        video_path: Path,
        prompt: str,
        reference_image_path: Optional[Path] = None,
        reference_image_url: Optional[str] = None,
        aspect_ratio: str = "16:9",
        duration: int = 5,
        seconds: int = None,
        video_url: Optional[str] = None,
        job_id: Optional[str] = None,
        structure_transformation: float = 0.5
    ) -> dict:
        """
        Replace/edit object in video using Runway Gen-4.
        Uses Runway's direct video_to_video API with optional reference image.
        
        Args:
            video_path: Path to source video (not used if video_url provided)
            prompt: Text description of desired edit
            reference_image_path: Optional local path to reference image
            reference_image_url: Optional URL to reference image (takes precedence over path)
            aspect_ratio: Output aspect ratio (e.g., "16:9", "1280:720")
            duration: Output duration in seconds
            video_url: Required - publicly accessible video URL
            job_id: Optional job ID for GCS organization
            structure_transformation: 0.0-1.0, lower = more structural consistency
            
        Returns:
            Dict with 'video_url' of the result
        """
        logger.info(f"Starting Runway Gen-4 editing...")
        logger.info(f"Prompt: {prompt}")
        
        if not video_url:
            raise ValueError("video_url is required for Runway API. Video must be publicly accessible with proper Content-Type headers.")
            
        if seconds is not None:
            duration = seconds
        
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
            "ratio": ratio,
            "seconds": duration
        }
        
        # Add reference image if provided (grounded object replacement!)
        image_url = None
        if reference_image_url:
            image_url = reference_image_url
            logger.info(f"Using provided reference image URL: {image_url}")
        elif reference_image_path and Path(reference_image_path).exists():
            image_url = self._get_image_url(Path(reference_image_path), job_id)
            logger.info(f"Reference image ready: {image_url[:100]}...")
        
        if image_url:
            payload["promptImage"] = {
                "uri": image_url,
                "position": "first"  # Use as first frame reference
            }
            logger.info("✅ promptImage added to payload for grounded replacement")
        
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
