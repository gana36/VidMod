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
        
        # FFmpeg filter (PURE BLACK/WHITE MASK from SAM3):
        # SAM3 with mask_only=True gives us: white pixels = blur, black pixels = keep original
        # Use modern scale filter to match mask dimensions to original video
        filter_complex = (
            # Split original into two streams
            f"[0:v]split[original][toblur];"
            # Blur one stream
            f"[toblur]boxblur={blur_strength}:1[blurred];"
            # Scale mask to match original video dimensions (both inputs must be same size for maskedmerge)
            # IMPORTANT: Negate mask to invert it (SAM3 seems to give inverted mask)
            f"[1:v]format=gray,scale=iw:ih-8,negate[mask_scaled];"
            # Blend: where mask is white, show blurred; where black, show original
            f"[blurred][original][mask_scaled]maskedmerge[out]"
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
        
        # Pixelate filter: Scale down and up to create pixelation
        # Then use mask to merge (maskedmerge)
        # Using the same robust mask logic as blur (scale mask + negate)
        filter_complex = (
            f"[0:v]split[original][topix];"
            # Pixelate effect: scale down, then scale back up to original size using modern syntax
            f"[topix]scale=iw/{pixel_size}:ih/{pixel_size}:flags=neighbor[small];"
            # Use setsar to ensure correct aspect ratio, then scale to original dimensions
            f"[small]setsar=1,scale=1920:1080:flags=neighbor[pixelated];"
            # Scale mask to match video dimensions (handling 1088p vs 1080p issue)
            f"[1:v]scale=iw:ih-8[mask_scaled];"
            # Invert mask (SAM3 mask is white=include, maskedmerge uses white=second_input i.e. original)
            f"[mask_scaled]negate[mask_inverted];"
            f"[pixelated][original][mask_inverted]maskedmerge[out]"
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
    
    def insert_segment(
        self,
        original_video: Path,
        processed_segment: Path,
        output_path: Path,
        start_time: float,
        end_time: float,
        buffer_seconds: float = 1.0
    ) -> Path:
        """
        Replace a segment of the original video with a processed segment.
        
        This uses FFmpeg's concat demuxer for seamless stitching.
        
        Args:
            original_video: Path to the original full video
            processed_segment: Path to the processed clip
            output_path: Path to save the final video
            start_time: Original start time of the incident
            end_time: Original end time of the incident
            buffer_seconds: Buffer used during extraction
            
        Returns:
            Path to the stitched video
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Calculate actual clip boundaries (with buffer)
        buffered_start = max(0, start_time - buffer_seconds)
        buffered_end = end_time + buffer_seconds
        
        # Create temporary clips: before, processed, after
        temp_dir = output_path.parent / "temp_segments"
        temp_dir.mkdir(exist_ok=True)
        
        before_clip = temp_dir / "before.mp4"
        after_clip = temp_dir / "after.mp4"
        concat_list = temp_dir / "concat_list.txt"
        
        try:
            # Extract "before" segment (0 to buffered_start)
            if buffered_start > 0:
                cmd_before = [
                    self.ffmpeg_path, "-y",
                    "-i", str(original_video),
                    "-t", str(buffered_start),
                    "-c", "copy",
                    str(before_clip)
                ]
                subprocess.run(cmd_before, capture_output=True, text=True, check=True)
                logger.info(f"Extracted 'before' segment: 0s to {buffered_start:.2f}s")
            
            # Extract "after" segment (buffered_end to end)
            cmd_after = [
                self.ffmpeg_path, "-y",
                "-ss", str(buffered_end),
                "-i", str(original_video),
                "-c", "copy",
                str(after_clip)
            ]
            result = subprocess.run(cmd_after, capture_output=True, text=True, check=False)
            has_after = after_clip.exists() and after_clip.stat().st_size > 1000
            if has_after:
                logger.info(f"Extracted 'after' segment: {buffered_end:.2f}s to end")
            
            # Create concat list
            with open(concat_list, 'w') as f:
                if buffered_start > 0:
                    f.write(f"file '{before_clip.absolute()}'\n")
                f.write(f"file '{processed_segment.absolute()}'\n")
                if has_after:
                    f.write(f"file '{after_clip.absolute()}'\n")
            
            # Concatenate all segments
            cmd_concat = [
                self.ffmpeg_path, "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list),
                "-c", "copy",
                str(output_path)
            ]
            
            subprocess.run(cmd_concat, capture_output=True, text=True, check=True)
            logger.info(f"Stitched video created: {output_path}")
            
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Video stitching failed: {e.stderr}")
            raise RuntimeError(f"Failed to stitch video segments: {e.stderr}")
        finally:
            # Cleanup temporary files
            import shutil
            if temp_dir.exists():
                shutil.rmtree(temp_dir)

