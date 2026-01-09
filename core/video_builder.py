"""
VidMod Video Builder Module
Reconstructs video from frames using FFmpeg.
"""

import subprocess
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class VideoBuilder:
    """Reconstruct video from processed frames using FFmpeg."""
    
    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        self.ffmpeg_path = ffmpeg_path
    
    def build_video(
        self,
        frames_dir: Path,
        output_path: Path,
        fps: float = 30,
        audio_path: Optional[Path] = None,
        frame_pattern: str = "frame_%06d.png",
        codec: str = "libx264",
        crf: int = 18,
        preset: str = "medium"
    ) -> Path:
        """
        Reconstruct video from frames.
        
        Args:
            frames_dir: Directory containing frames
            output_path: Output video path
            fps: Frames per second
            audio_path: Optional path to audio file to merge
            frame_pattern: Pattern for frame filenames
            codec: Video codec (default: libx264)
            crf: Constant Rate Factor (quality, lower = better, 18-28 typical)
            preset: Encoding preset (ultrafast, fast, medium, slow, veryslow)
            
        Returns:
            Path to output video
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Build base command
        cmd = [
            self.ffmpeg_path, "-y",
            "-framerate", str(fps),
            "-i", str(frames_dir / frame_pattern),
        ]
        
        # Add audio if provided
        if audio_path and audio_path.exists():
            cmd.extend(["-i", str(audio_path)])
        
        # Video encoding options
        cmd.extend([
            "-c:v", codec,
            "-crf", str(crf),
            "-preset", preset,
            "-pix_fmt", "yuv420p",  # Compatibility
        ])
        
        # Audio options
        if audio_path and audio_path.exists():
            cmd.extend([
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest"  # Match shortest stream
            ])
        
        cmd.append(str(output_path))
        
        logger.info(f"Building video: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Video built successfully: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Video build failed: {e.stderr}")
            raise RuntimeError(f"Failed to build video: {e.stderr}")
    
    def build_video_from_list(
        self,
        frame_paths: list[Path],
        output_path: Path,
        fps: float = 30,
        audio_path: Optional[Path] = None
    ) -> Path:
        """
        Build video from a list of frame paths (useful when frames aren't sequential).
        Uses a concat demuxer with a file list.
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create file list
        list_file = output_path.parent / "frames_list.txt"
        with open(list_file, "w") as f:
            for frame in frame_paths:
                # FFmpeg concat requires specific format
                f.write(f"file '{frame.absolute()}'\n")
                f.write(f"duration {1/fps}\n")
        
        # Build command
        cmd = [
            self.ffmpeg_path, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
        ]
        
        if audio_path and audio_path.exists():
            cmd.extend(["-i", str(audio_path)])
        
        cmd.extend([
            "-c:v", "libx264",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-vsync", "vfr"
        ])
        
        if audio_path and audio_path.exists():
            cmd.extend(["-c:a", "aac", "-shortest"])
        
        cmd.append(str(output_path))
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            # Cleanup list file
            list_file.unlink()
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Video build failed: {e.stderr}")
            raise RuntimeError(f"Failed to build video: {e.stderr}")
    
    def create_preview_gif(
        self,
        frames_dir: Path,
        output_path: Path,
        fps: int = 10,
        scale: int = 320,
        duration: float = 3
    ) -> Path:
        """Create a preview GIF from frames."""
        max_frames = int(fps * duration)
        
        cmd = [
            self.ffmpeg_path, "-y",
            "-framerate", str(fps),
            "-i", str(frames_dir / "frame_%06d.png"),
            "-vframes", str(max_frames),
            "-vf", f"scale={scale}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"GIF creation failed: {e.stderr}")
            raise RuntimeError(f"Failed to create GIF: {e.stderr}")
