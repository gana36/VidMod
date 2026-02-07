"""
Google Cloud Storage Uploader Service
Handles video uploads to GCS and URL generation.
"""

from google.cloud import storage
from pathlib import Path
from typing import Optional, Dict, List
import logging
import os
from datetime import datetime, timedelta
import json

logger = logging.getLogger(__name__)

# Fallback imports for IAM signing on Cloud Run
try:
    from google.auth import default, impersonated_credentials
    from google.auth.transport.requests import Request
except ImportError:
    pass


class GCSUploader:
    """
    Service for uploading videos to Google Cloud Storage and managing video library.
    
    Example:
        uploader = GCSUploader(bucket_name="vidmod-videos")
        url = uploader.upload_video(Path("video.mp4"), key="jobs/123/input.mp4")
        videos = uploader.list_videos()
    """
    
    def __init__(self, bucket_name: str, project_id: Optional[str] = None):
        """
        Initialize GCS uploader.
        
        Args:
            bucket_name: GCS bucket name
            project_id: Optional Google Cloud Project ID
        """
        self.bucket_name = bucket_name
        self.project_id = project_id
        
        # Initialize GCS client (uses Google Application Credentials implicitly)
        try:
            if project_id:
                logger.info(f"Initializing GCS client with project ID: {project_id}")
                self.storage_client = storage.Client(project=project_id)
            else:
                logger.info("Initializing GCS client with implied project from environment")
                self.storage_client = storage.Client()
                
            self.bucket = self.storage_client.bucket(bucket_name)
            logger.info(f"GCSUploader initialized for bucket: {bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GCS client: {e}")
            raise
    
    def upload_video(
        self,
        video_path: Path,
        key: Optional[str] = None,
        make_public: bool = True
    ) -> str:
        """
        Upload video to GCS and return public URL.
        
        Args:
            video_path: Local path to video file
            key: GCS object key (path in bucket). If None, auto-generates from filename
            make_public: If True, makes object publicly readable (needed for Replicate)
            
        Returns:
            Public HTTPS URL to the uploaded video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        # Auto-generate key if not provided
        if not key:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            key = f"videos/{timestamp}_{video_path.name}"
        
        logger.info(f"Uploading {video_path.name} to GCS as {key}...")
        
        try:
            blob = self.bucket.blob(key)
            
            # Upload file
            blob.upload_from_filename(
                str(video_path),
                content_type='video/mp4'
            )
            
            # Make public if requested (Legacy ACL or IAM based)
            # Note: For Uniform Bucket-Level Access, individual ACLs strictly don't work.
            # We assume the bucket is configured properly or we use signed URLs if strictly private.
            # For simplicity/Replicate, we assume public read or specific service account access.
            if make_public:
                try:
                   blob.make_public()
                except Exception as e:
                    logger.warning(f"Could not make blob public (might be uniform bucket access): {e}")

            # Generate public URL
            url = blob.public_url
            logger.info(f"✅ Video uploaded successfully: {url}")
            
            return url
            
        except Exception as e:
            logger.error(f"Failed to upload to GCS: {e}")
            raise
    
    def generate_upload_url(
        self,
        key: str,
        content_type: str = "video/mp4",
        expiration_minutes: int = 15
    ) -> str:
        """Generate a signed URL for uploading a file."""
        blob = self.bucket.blob(key)
        
        # Try standard generation first (works locally with key file)
        try:
            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=expiration_minutes),
                method="PUT",
                content_type=content_type
            )
            return url
        except Exception as e:
            # Check for missing private key error (common on Cloud Run/GCE)
            if "private key" in str(e).lower() or "signing" in str(e).lower():
                logger.info("Private key not found. Attempting IAM signing fallback...")
                try:
                    # Get default credentials
                    creds, _ = default()
                    
                    # Determine Service Account Email
                    # 1. Try from credentials
                    service_account_email = getattr(creds, "service_account_email", None)
                    
                    # 2. Try generic compute default if not found
                    if not service_account_email or service_account_email == "default":
                        # This is a safe fallback for the default compute SA
                        # But better to check env if set
                        service_account_email = os.getenv("GCS_SERVICE_ACCOUNT_EMAIL")
                        
                    if not service_account_email:
                        logger.warning("Could not determine service account email for IAM signing. Using 'default'.")
                        service_account_email = "default" 

                    logger.info(f"Using IAM signing with account: {service_account_email}")

                    # Create impersonated credentials to sign as self
                    # This enables the use of the IAM API signBlob endpoint
                    target_creds = impersonated_credentials.Credentials(
                        source_credentials=creds,
                        target_principal=service_account_email,
                        target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
                        lifetime=3600
                    )
                    
                    # Force refresh to initialize
                    request = Request()
                    target_creds.refresh(request)
                    
                    # Generate URL using the impersonated credentials
                    url = blob.generate_signed_url(
                        version="v4",
                        expiration=timedelta(minutes=expiration_minutes),
                        method="PUT",
                        content_type=content_type,
                        credentials=target_creds
                    )
                    return url
                    
                except Exception as iam_error:
                    logger.error(f"IAM signing fallback failed: {iam_error}")
                    raise e  # Raise original error if fallback fails
            
            raise e

    def upload_image(
        self,
        image_path: Path,
        key: Optional[str] = None,
        make_public: bool = True
    ) -> str:
        """
        Upload image to GCS and return public URL.
        Used for reference images.
        """
        image_path = Path(image_path)
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")
        
        if not key:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            key = f"images/{timestamp}_{image_path.name}"
        
        # Determine content type
        content_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
        }
        ext = image_path.suffix.lower()
        content_type = content_types.get(ext, 'image/jpeg')
        
        logger.info(f"Uploading image {image_path.name} to GCS as {key}...")
        
        try:
            blob = self.bucket.blob(key)
            blob.upload_from_filename(
                str(image_path),
                content_type=content_type
            )
            
            if make_public:
                try:
                    blob.make_public()
                except:
                    pass
            
            url = blob.public_url
            logger.info(f"✅ Image uploaded successfully: {url}")
            return url
            
        except Exception as e:
            logger.error(f"Failed to upload image to GCS: {e}")
            raise

    def upload_json(self, data: Dict, key: str) -> str:
        """
        Upload JSON data to GCS.
        Useful for persisting job state.
        """
        try:
            blob = self.bucket.blob(key)
            blob.upload_from_string(
                json.dumps(data),
                content_type='application/json'
            )
            return blob.public_url
        except Exception as e:
            logger.error(f"Failed to upload JSON to GCS: {e}")
            raise

    def download_json(self, key: str) -> Optional[Dict]:
        """
        Download JSON data from GCS.
        Useful for recovering job state.
        """
        try:
            blob = self.bucket.blob(key)
            if not blob.exists():
                return None
                
            content = blob.download_as_text()
            return json.loads(content)
        except Exception as e:
            logger.error(f"Failed to download JSON from GCS: {e}")
            return None
            
    def video_exists(self, key: str) -> bool:
        """Check if a video exists in GCS."""
        try:
            blob = self.bucket.blob(key)
            return blob.exists()
        except:
            return False
