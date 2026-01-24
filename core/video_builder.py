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
        Uses scale2ref to ensure mask matches input dimensions.
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # FFmpeg filter Explanation:
        # 1. Split input into [original] and [toblur]
        # 2. Blur [toblur] to create [blurred]
        # 3. Scale mask [1:v] to match [original] dimensions using scale2ref.
        #    This outputs [mask_scaled] and [original_ref].
        #    IMPORTANT: We MUST use [original_ref] later, otherwise FFmpeg errors with "unconnected output"
        # 4. Negate mask (if needed based on SAM3 output)
        # 5. Merge [blurred] and [original_ref] using [mask_inverted]
        
        filter_complex = (
            f"[0:v]split[toscale][toblur];"
            f"[toblur]boxblur={blur_strength}:1[blurred];"
            f"[1:v][toscale]scale2ref[mask_scaled][original_ref];"
            f"[mask_scaled]format=gray,negate[mask_inverted];"
            f"[blurred][original_ref][mask_inverted]maskedmerge[out]"
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
            subprocess.run(cmd, capture_output=True, text=True, check=True)
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
        Fixed to avoid unconnected output errors and hardcoded scaling.
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        filter_complex = (
            f"[0:v]split[toscale][topix];"
            # Pixelate: Scale down by pixel_size, then scale back up to input dimensions (iw*pixel_size)
            # We use scale2ref style logic implicitly by just multiplying back, but exact iw/ih is safer.
            # actually better: scale=iw/N:-1, then scale=iw:ih.
            f"[topix]scale=iw/{pixel_size}:ih/{pixel_size}:flags=neighbor[small];"
            f"[small]scale=iw*{pixel_size}:ih*{pixel_size}:flags=neighbor[pixelated_raw];"
            # Ensure pixelated stream matches original size exactly (rounding errors might occur with simple math)
            f"[pixelated_raw][0:v]scale2ref[pixelated][unused_ref];"
            # Now handle mask scaling
            f"[1:v][toscale]scale2ref[mask_scaled][original_ref];"
            f"[mask_scaled]negate[mask_inverted];"
            f"[pixelated][original_ref][mask_inverted]maskedmerge[out]"
        )
        # Simplified Pixelation without extra scale2ref check if we trust math, but let's be safe:
        # Actually simplest valid graph:
        # Pixelate filter logic:
        # 1. Resize mask [1:v] to match original [0:v]. This outputs [mask_scaled] and [original_ref].
        # 2. Split [original_ref] so we have a base for merging and a source for pixelating.
        # 3. Downscale [toscale] to create the low-res mosaic blocks.
        # 4. Upscale [small] BACK to [base] dimensions. IMPORTANT: We use scale2ref again here
        #    to guarantee the upscaled version matches the base EXACTLY (avoiding odd-pixel rounding errors).
        # 5. Negate mask and merge.
        
        filter_complex = (
            f"[1:v][0:v]scale2ref[mask_scaled][original_ref];"
            f"[original_ref]split[base][toscale];"
            f"[toscale]scale=iw/{pixel_size}:ih/{pixel_size}:flags=neighbor[small];"
            f"[small][base]scale2ref=flags=neighbor[pixelated][base_ready];"
            f"[mask_scaled]negate[mask_inverted];"
            f"[pixelated][base_ready][mask_inverted]maskedmerge[out]"
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
            subprocess.run(cmd, capture_output=True, text=True, check=True)
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

