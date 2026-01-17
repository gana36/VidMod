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
    
    def apply_blur_with_mask(
        self,
        input_video: Path,
        mask_video: Path,
        output_path: Path,
        blur_strength: int = 30,
        audio_path: Optional[Path] = None
    ) -> Path:
        """
        Apply Gaussian blur to masked region of video.
        
        This is the same approach Meta uses in their Segment Anything demos:
        1. SAM3 creates a mask (white = area to blur)
        2. FFmpeg applies blur only to the masked region
        
        Args:
            input_video: Original video file
            mask_video: Mask video from SAM3 (white = blur region)
            output_path: Where to save the blurred result
            blur_strength: Blur intensity (10-50 recommended)
            audio_path: Optional audio to include
            
        Returns:
            Path to the blurred video
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # FFmpeg filter:
        # 1. Split original -> [original], [toblur]
        # 2. Blur [toblur] -> [blurred]
        # 3. Scale mask (input 1) to match original (input 0) -> [mask_sized]
        # 4. Difference (mask_sized - original) -> [diff]
        # 5. Threshold diff: IF(lum > 20, 255, 0) -> [mask]
        # 6. maskedmerge [original][blurred][mask]
        filter_complex = (
            f"[0:v]split[original][toblur];"
            f"[toblur]boxblur={blur_strength}:1[blurred];"
            f"[1:v][0:v]scale2ref[mask_sized][video_ref];"
            f"[mask_sized][video_ref]blend=all_mode=difference[diff];"
            f"[diff]format=gray,geq=lum='if(gt(lum(X,Y),20),255,0)'[mask];"
            f"[original][blurred][mask]maskedmerge[out]"
        )
        
        cmd = [
            self.ffmpeg_path, "-y",
            "-i", str(input_video),
            "-i", str(mask_video),
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-c:v", "libx264",
            "-crf", "18",
            "-preset", "fast",
            "-pix_fmt", "yuv420p",
        ]
        
        # Add audio if provided
        if audio_path and audio_path.exists():
            cmd.extend(["-i", str(audio_path), "-map", "2:a", "-c:a", "aac", "-shortest"])
        elif input_video.suffix.lower() in ['.mp4', '.mov', '.mkv']:
            # Try to copy audio from original video
            cmd.extend(["-map", "0:a?", "-c:a", "copy"])
        
        cmd.append(str(output_path))
        
        logger.info(f"Applying blur with mask: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Blurred video created: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Blur application failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply blur: {e.stderr}")
    
    def apply_pixelate_with_mask(
        self,
        input_video: Path,
        mask_video: Path,
        output_path: Path,
        pixel_size: int = 16,
        audio_path: Optional[Path] = None
    ) -> Path:
        """
        Apply pixelation effect to masked region.
        
        Similar to blur but creates a mosaic/pixelated effect.
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Pixelate filter: We'll use a different approach - apply pixelate to entire video
        # then use maskedmerge to only show pixelated version in masked areas
        # The key is to use scale2ref to scale back to original size
        filter_complex = (
            f"[0:v]split[original][topix];"
            f"[topix]scale=iw/{pixel_size}:-1:flags=neighbor[small];"
            f"[small][original]scale2ref[pixelated][ref];"
            f"[1:v][0:v]scale2ref[mask_sized][video_ref];"
            f"[mask_sized][video_ref]blend=all_mode=difference[diff];"
            f"[diff]format=gray,geq=lum='if(gt(lum(X,Y),20),255,0)'[mask];"
            f"[ref][pixelated][mask]maskedmerge[out]"
        )
        
        cmd = [
            self.ffmpeg_path, "-y",
            "-i", str(input_video),
            "-i", str(mask_video),
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-c:v", "libx264",
            "-crf", "18",
            "-preset", "fast",
            "-pix_fmt", "yuv420p",
        ]
        
        if audio_path and audio_path.exists():
            cmd.extend(["-i", str(audio_path), "-map", "2:a", "-c:a", "aac", "-shortest"])
        elif input_video.suffix.lower() in ['.mp4', '.mov', '.mkv']:
            cmd.extend(["-map", "0:a?", "-c:a", "copy"])
        
        cmd.append(str(output_path))
        
        logger.info(f"Applying pixelation with mask: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Pixelated video created: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Pixelation failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply pixelation: {e.stderr}")
