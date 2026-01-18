"""
AWS S3 Uploader Service
Handles video uploads to S3 and URL generation for Replicate processing.
"""

import boto3
from pathlib import Path
from typing import Optional, Dict, List
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


class S3Uploader:
    """
    Service for uploading videos to AWS S3 and managing video library.
    
    Example:
        uploader = S3Uploader(bucket_name="vidmod-videos", region="us-east-1")
        url = uploader.upload_video(Path("video.mp4"), key="jobs/123/input.mp4")
        videos = uploader.list_videos()
    """
    
    def __init__(
        self,
        bucket_name: str,
        region: str = 'us-east-1',
        aws_access_key_id: Optional[str] = None,
        aws_secret_access_key: Optional[str] = None
    ):
        """
        Initialize S3 uploader.
        
        Args:
            bucket_name: S3 bucket name
            region: AWS region
            aws_access_key_id: AWS access key (optional, can use env vars)
            aws_secret_access_key: AWS secret key (optional, can use env vars)
        """
        self.bucket_name = bucket_name
        self.region = region
        
        # Initialize S3 client
        client_kwargs = {'region_name': region}
        if aws_access_key_id and aws_secret_access_key:
            client_kwargs['aws_access_key_id'] = aws_access_key_id
            client_kwargs['aws_secret_access_key'] = aws_secret_access_key
        
        self.s3_client = boto3.client('s3', **client_kwargs)
        logger.info(f"S3Uploader initialized for bucket: {bucket_name} in region: {region}")
    
    def upload_video(
        self,
        video_path: Path,
        key: Optional[str] = None,
        make_public: bool = True
    ) -> str:
        """
        Upload video to S3 and return public URL.
        
        Args:
            video_path: Local path to video file
            key: S3 object key (path in bucket). If None, auto-generates from filename
            make_public: If True, makes object publicly readable (needed for Replicate)
            
        Returns:
            Public HTTPS URL to the uploaded video
            
        Raises:
            FileNotFoundError: If video_path doesn't exist
            Exception: If upload fails
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        # Auto-generate key if not provided
        if not key:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            key = f"videos/{timestamp}_{video_path.name}"
        
        logger.info(f"Uploading {video_path.name} to S3 as {key}...")
        
        try:
            # Prepare upload arguments
            extra_args = {
                'ContentType': 'video/mp4',
                'ContentDisposition': 'inline'
            }
            
            # Note: ACL removed - use bucket policy for public access instead
            # Modern S3 buckets have ACLs disabled by default
            
            # Upload file
            self.s3_client.upload_file(
                str(video_path),
                self.bucket_name,
                key,
                ExtraArgs=extra_args
            )
            
            # Generate public URL
            url = f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{key}"
            logger.info(f"✅ Video uploaded successfully: {url}")
            
            return url
            
        except Exception as e:
            logger.error(f"Failed to upload to S3: {e}")
            raise
    
    def list_videos(self, prefix: str = "videos/", max_results: int = 100) -> List[Dict]:
        """
        List all videos in S3 bucket.
        
        Args:
            prefix: S3 key prefix to filter results
            max_results: Maximum number of results to return
            
        Returns:
            List of video metadata dictionaries with keys:
            - key: S3 object key
            - filename: Original filename
            - size: File size in bytes
            - size_mb: File size in MB
            - last_modified: ISO timestamp
            - url: Public HTTPS URL
        """
        logger.info(f"Listing videos from S3 bucket: {self.bucket_name}")
        
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_results
            )
            
            videos = []
            for obj in response.get('Contents', []):
                # Skip directories (keys ending with /)
                if obj['Key'].endswith('/'):
                    continue
                
                videos.append({
                    'key': obj['Key'],
                    'filename': obj['Key'].split('/')[-1],
                    'size': obj['Size'],
                    'size_mb': round(obj['Size'] / (1024 * 1024), 2),
                    'last_modified': obj['LastModified'].isoformat(),
                    'url': f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{obj['Key']}"
                })
            
            logger.info(f"Found {len(videos)} videos in S3")
            return videos
            
        except Exception as e:
            logger.error(f"Failed to list S3 videos: {e}")
            return []
    
    def delete_video(self, key: str):
        """
        Delete video from S3.
        
        Args:
            key: S3 object key to delete
        """
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info(f"✅ Deleted from S3: {key}")
        except Exception as e:
            logger.error(f"Failed to delete from S3: {e}")
            raise
    
    def get_video_url(self, key: str) -> str:
        """
        Get public URL for an existing S3 object.
        
        Args:
            key: S3 object key
            
        Returns:
            Public HTTPS URL
        """
        return f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{key}"
    
    def video_exists(self, key: str) -> bool:
        """
        Check if a video exists in S3.
        
        Args:
            key: S3 object key
            
        Returns:
            True if video exists, False otherwise
        """
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except:
            return False
