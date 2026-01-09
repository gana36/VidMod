"""
VidMod Frame Extractor Module
Extracts frames from video using FFmpeg.
"""

import subprocess
import json
from pathlib import Path
from typing import Tuple, Optional
import logging

logger = logging.getLogger(__name__)


class FrameExtractor:
    """Extract frames from video files using FFmpeg."""
    
    def __init__(self, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe"):
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
    
    def get_video_info(self, video_path: Path) -> dict:
        """Get video metadata using ffprobe."""
        cmd = [
            self.ffprobe_path,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path)
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            
            # Find video stream
            video_stream = None
            audio_stream = None
            for stream in data.get("streams", []):
                if stream.get("codec_type") == "video" and not video_stream:
                    video_stream = stream
                elif stream.get("codec_type") == "audio" and not audio_stream:
                    audio_stream = stream
            
            if not video_stream:
                raise ValueError("No video stream found")
            
            # Parse frame rate
            fps_str = video_stream.get("r_frame_rate", "30/1")
            fps_parts = fps_str.split("/")
            fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else float(fps_parts[0])
            
            return {
                "width": int(video_stream.get("width", 0)),
                "height": int(video_stream.get("height", 0)),
                "fps": fps,
                "duration": float(data.get("format", {}).get("duration", 0)),
                "total_frames": int(float(data.get("format", {}).get("duration", 0)) * fps),
                "codec": video_stream.get("codec_name", "unknown"),
                "has_audio": audio_stream is not None,
                "audio_codec": audio_stream.get("codec_name") if audio_stream else None
            }
        except subprocess.CalledProcessError as e:
            logger.error(f"FFprobe error: {e.stderr}")
            raise RuntimeError(f"Failed to get video info: {e.stderr}")
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            raise RuntimeError("Failed to parse video metadata")
    
    def extract_frames(
        self,
        video_path: Path,
        output_dir: Path,
        fps: Optional[float] = None,
        start_time: float = 0,
        duration: Optional[float] = None
    ) -> Tuple[list[Path], dict]:
        """
        Extract frames from video.
        
        Args:
            video_path: Path to input video
            output_dir: Directory to save frames
            fps: Frames per second to extract (None = use video fps)
            start_time: Start time in seconds
            duration: Duration to extract in seconds (None = full video)
            
        Returns:
            Tuple of (list of frame paths, video info dict)
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Get video info first
        video_info = self.get_video_info(video_path)
        target_fps = fps or video_info["fps"]
        
        # Build FFmpeg command
        cmd = [self.ffmpeg_path, "-y"]
        
        # Input options
        if start_time > 0:
            cmd.extend(["-ss", str(start_time)])
        
        cmd.extend(["-i", str(video_path)])
        
        if duration:
            cmd.extend(["-t", str(duration)])
        
        # Output options
        cmd.extend([
            "-vf", f"fps={target_fps}",
            "-frame_pts", "1",
            str(output_dir / "frame_%06d.png")
        ])
        
        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg error: {e.stderr}")
            raise RuntimeError(f"Frame extraction failed: {e.stderr}")
        
        # Collect extracted frames
        frames = sorted(output_dir.glob("frame_*.png"))
        logger.info(f"Extracted {len(frames)} frames")
        
        video_info["extracted_fps"] = target_fps
        video_info["extracted_frames"] = len(frames)
        
        return frames, video_info
    
    def extract_audio(self, video_path: Path, output_path: Path) -> Optional[Path]:
        """Extract audio track from video."""
        video_info = self.get_video_info(video_path)
        
        if not video_info.get("has_audio"):
            logger.info("No audio track found")
            return None
        
        cmd = [
            self.ffmpeg_path, "-y",
            "-i", str(video_path),
            "-vn",  # No video
            "-acodec", "copy",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Extracted audio to {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Audio extraction failed: {e.stderr}")
            return None
    
    def extract_single_frame(
        self,
        video_path: Path,
        output_path: Path,
        timestamp: float = 0
    ) -> Path:
        """Extract a single frame at specified timestamp."""
        cmd = [
            self.ffmpeg_path, "-y",
            "-ss", str(timestamp),
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Frame extraction failed: {e.stderr}")
            raise RuntimeError(f"Failed to extract frame: {e.stderr}")
