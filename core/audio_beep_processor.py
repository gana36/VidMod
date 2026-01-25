"""
Audio Beep Processor Module
Uses FFmpeg to overlay beep sounds over profanity in videos.
"""

import logging
import subprocess
from pathlib import Path
from typing import List
import tempfile

logger = logging.getLogger(__name__)


class AudioBeepProcessor:
    """
    Processes video to overlay beep sounds over profanity using FFmpeg.
    
    Example:
        processor = AudioBeepProcessor()
        processor.apply_beeps(
            video_path=Path("input.mp4"),
            profanity_matches=[match1, match2],
            output_path=Path("censored.mp4")
        )
    """
    
    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        """
        Initialize beep processor.
        
        Args:
            ffmpeg_path: Path to ffmpeg executable
        """
        self.ffmpeg_path = ffmpeg_path
        logger.info(f"AudioBeepProcessor initialized with FFmpeg: {ffmpeg_path}")
    
    def generate_beep(
        self,
        duration: float,
        output_path: Path,
        frequency: int = 1000,
        volume: float = 0.8
    ) -> Path:
        """
        Generate a beep sound file.
        
        Args:
            duration: Duration in seconds
            output_path: Where to save the beep
            frequency: Beep frequency in Hz (default: 1000Hz)
            volume: Volume level 0.0-1.0 (default: 0.8)
            
        Returns:
            Path to generated beep file
        """
        cmd = [
            self.ffmpeg_path,
            "-y",  # Overwrite output
            "-f", "lavfi",
            "-i", f"sine=frequency={frequency}:duration={duration}",
            "-af", f"volume={volume}",
            str(output_path)
        ]
        
        logger.info(f"Generating {duration}s beep at {frequency}Hz")
        
        try:
            result = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True
            )
            logger.info(f"Beep generated: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to generate beep: {e.stderr}")
            raise
    
    def apply_beeps(
        self,
        video_path: Path,
        profanity_matches: List,  # List[ProfanityMatch]
        output_path: Path,
        beep_frequency: int = 1000,
        beep_volume: float = 0.9
    ) -> Path:
        """
        Apply beep sounds over profanity in video.
        
        This REPLACES the audio during profanity with beep sounds by:
        1. Muting the original audio during profanity timestamps
        2. Overlaying beep sounds at those same timestamps
        
        Args:
            video_path: Input video file
            profanity_matches: List of ProfanityMatch objects
            output_path: Output video path
            beep_frequency: Beep tone frequency (default: 1000Hz)
            beep_volume: Beep volume 0.0-1.0 (default: 0.9)
            
        Returns:
            Path to censored video
            
        Raises:
            FileNotFoundError: If video doesn't exist
            RuntimeError: If FFmpeg processing fails
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        if not profanity_matches:
            logger.warning("No profanity matches provided, copying original video")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Applying {len(profanity_matches)} beeps to video (replacing audio)")
        
        try:
            # Create temporary directory for beep files
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                # Step 1: Build volume filter to MUTE original audio during profanity
                # Use volume filter with enable expression to mute during profanity times
                volume_conditions = []
                for match in profanity_matches:
                    # between(t, start, end) returns 1 if current time is in range
                    volume_conditions.append(f"between(t,{match.start_time},{match.end_time})")
                
                # If any condition is true, volume=0 (mute), else volume=1 (normal)
                # The enable expression: if (condition1 OR condition2 OR ...) then apply volume=0
                volume_filter = f"volume=enable='{'|'.join(volume_conditions)}':volume=0"
                
                # Step 2: Generate beep file for EACH profanity instance
                beep_files = []
                for i, match in enumerate(profanity_matches):
                    duration = match.end_time - match.start_time
                    beep_path = temp_path / f"beep_{i}.wav"
                    self.generate_beep(duration, beep_path, beep_frequency, beep_volume)
                    beep_files.append((beep_path, match.start_time))
                
                # Step 3: Build FFmpeg command to:
                # a) Apply volume filter to mute profanity in original audio
                # b) Overlay beeps at profanity timestamps
                # c) Mix the muted audio with the beeps
                
                filter_parts = []
                
                # Apply volume filter to original audio (mutes profanity)
                filter_parts.append(f"[0:a]{volume_filter}[muted]")
                
                # For each beep, add delay to align with timestamp
                for i, (beep_path, start_time) in enumerate(beep_files):
                    delay_ms = int(start_time * 1000)
                    filter_parts.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[beep{i}]")
                
                # Mix muted audio with all beeps
                inputs_to_mix = ["muted"] + [f"beep{i}" for i in range(len(beep_files))]
                mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
                filter_parts.append(
                    f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0[out]"
                )
                
                filter_complex = ";".join(filter_parts)
                
                # Build FFmpeg command
                cmd = [
                    self.ffmpeg_path,
                    "-y",
                    "-i", str(video_path)
                ]
                
                # Add beep files as inputs
                for beep_path, _ in beep_files:
                    cmd.extend(["-i", str(beep_path)])
                
                # Add filter and output
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "0:v",  # Copy video stream
                    "-map", "[out]",  # Use processed audio
                    "-c:v", "copy",  # Don't re-encode video
                    "-c:a", "aac",  # Encode audio as AAC
                    "-b:a", "192k",  # Audio bitrate
                    str(output_path)
                ])
                
                logger.info(f"Running FFmpeg to mute profanity and overlay {len(beep_files)} beeps")
                logger.debug(f"Volume filter: {volume_filter}")
                logger.debug(f"FFmpeg command: {' '.join(cmd)}")
                
                result = subprocess.run(
                    cmd,
                    check=True,
                    capture_output=True,
                    text=True
                )
                
                logger.info(f"✅ Profanity replaced with beeps successfully: {output_path}")
                return output_path
                
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg beep processing failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply beeps: {e.stderr}")
        except Exception as e:
            logger.error(f"Beep processing error: {e}")
            raise

    
    def apply_simple_mute(
        self,
        video_path: Path,
        profanity_matches: List,  # List[ProfanityMatch]
        output_path: Path
    ) -> Path:
        """
        Mute audio during profanity (simpler alternative to beeping).
        
        Args:
            video_path: Input video file
            profanity_matches: List of ProfanityMatch objects
            output_path: Output video path
            
        Returns:
            Path to censored video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        if not profanity_matches:
            logger.warning("No profanity matches, copying original video")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Muting {len(profanity_matches)} segments")
        
        try:
            # Build volume filter to mute specific time ranges
            # Use volume=0 during profanity, volume=1 otherwise
            volume_filter = "volume=enable='"
            
            conditions = []
            for match in profanity_matches:
                # between(t, start, end) returns 1 if current time is in range
                conditions.append(f"between(t,{match.start_time},{match.end_time})")
            
            # If any condition is true, volume=0, else volume=1
            volume_filter += "+".join(conditions) + "':volume=0"
            
            cmd = [
                self.ffmpeg_path,
                "-y",
                "-i", str(video_path),
                "-af", volume_filter,
                "-c:v", "copy",  # Don't re-encode video
                "-c:a", "aac",  # Encode audio
                str(output_path)
            ]
            
            logger.info(f"Applying mute filter")
            logger.debug(f"FFmpeg command: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True
            )
            
            logger.info(f"✅ Audio muted successfully: {output_path}")
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg mute processing failed: {e.stderr}")
            raise RuntimeError(f"Failed to mute audio: {e.stderr}")
