"""
ElevenLabs Voice Dubber Module
Uses ElevenLabs API for voice cloning and seamless profanity replacement.
"""

import logging
from pathlib import Path
from typing import List, Optional
import tempfile
import subprocess

logger = logging.getLogger(__name__)


class ElevenLabsDubber:
    """
    Uses ElevenLabs to clone voices and dub clean replacements over profanity.
    
    Example:
        dubber = ElevenLabsDubber(api_key="your_key")
        voice_id = dubber.clone_voice_from_video(video_path, start=5.0, end=15.0)
        dubber.apply_dubs(video_path, profanity_matches, voice_id, output_path)
    """
    
    def __init__(self, api_key: str, ffmpeg_path: str = "ffmpeg"):
        """
        Initialize ElevenLabs dubber.
        
        Args:
            api_key: ElevenLabs API key
            ffmpeg_path: Path to ffmpeg executable
        """
        self.api_key = api_key
        self.ffmpeg_path = ffmpeg_path
        
        # Configure ElevenLabs client
        try:
            from elevenlabs import ElevenLabs
            self.client = ElevenLabs(api_key=api_key)
            logger.info("ElevenLabsDubber initialized")
        except ImportError:
            raise ImportError("elevenlabs package not installed. Run: pip install elevenlabs")
        except Exception as e:
            logger.error(f"Failed to initialize ElevenLabs: {e}")
            raise
    
    def extract_audio_sample(
        self,
        video_path: Path,
        output_path: Path,
        start_time: float,
        end_time: float
    ) -> Path:
        """
        Extract audio segment from video for voice cloning.
        
        Args:
            video_path: Input video
            output_path: Where to save audio sample
            start_time: Start time in seconds
            end_time: End time in seconds
            
        Returns:
            Path to extracted audio sample
        """
        duration = end_time - start_time
        
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i", str(video_path),
            "-ss", str(start_time),
            "-t", str(duration),
            "-vn",  # No video
            "-acodec", "libmp3lame",  # MP3 format (supported by ElevenLabs)
            "-ar", "22050",  # Sample rate
            "-ac", "1",  # Mono
            str(output_path)
        ]
        
        logger.info(f"Extracting audio sample: {start_time}s - {end_time}s")
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Audio sample extracted: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to extract audio: {e.stderr}")
            raise
    
    def clone_voice_from_video(
        self,
        video_path: Path,
        start_time: float = 0.0,
        end_time: Optional[float] = None,
        voice_name: Optional[str] = None
    ) -> str:
        """
        Clone voice from video audio.
        
        Args:
            video_path: Video file to extract voice from
            start_time: Start of clean speech sample (no profanity!)
            end_time: End of sample (if None, uses start + 10 seconds)
            voice_name: Name for the cloned voice
            
        Returns:
            Voice ID for use in generation
        """
        if end_time is None:
            end_time = start_time + 10.0
        
        if voice_name is None:
            voice_name = f"Voice_{video_path.stem}"
        
        logger.info(f"Cloning voice from {video_path}")
        
        try:
            # Extract audio sample
            with tempfile.TemporaryDirectory() as temp_dir:
                sample_path = Path(temp_dir) / "voice_sample.mp3"
                self.extract_audio_sample(video_path, sample_path, start_time, end_time)
                
                # Clone voice using ElevenLabs
                logger.info(f"Uploading to ElevenLabs for cloning...")
                
                voice = self.client.clone(
                    name=voice_name,
                    description=f"Cloned from {video_path.name}",
                    files=[str(sample_path)]
                )
                
                voice_id = voice.voice_id
                logger.info(f"✅ Voice cloned successfully: {voice_id}")
                return voice_id
                
        except Exception as e:
            logger.error(f"Voice cloning failed: {e}")
            raise
    
    def generate_speech(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        stability: float = 0.5,
        similarity_boost: float = 0.75
    ) -> Path:
        """
        Generate speech audio using cloned voice.
        
        Args:
            text: Text to speak
            voice_id: ElevenLabs voice ID
            output_path: Where to save audio
            stability: Voice stability (0-1)
            similarity_boost: How much to match voice (0-1)
            
        Returns:
            Path to generated audio file
        """
        logger.info(f"Generating speech: '{text}'")
        
        try:
            audio_generator = self.client.generate(
                text=text,
                voice=voice_id,
                model="eleven_multilingual_v2",
                voice_settings={
                    "stability": stability,
                    "similarity_boost": similarity_boost
                }
            )
            
            # Save audio
            with open(output_path, 'wb') as f:
                for chunk in audio_generator:
                    f.write(chunk)
            
            logger.info(f"Speech generated: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Speech generation failed: {e}")
            raise
    
    def apply_dubs(
        self,
        video_path: Path,
        profanity_matches: List,  # List[ProfanityMatch]
        voice_id: str,
        output_path: Path,
        stability: float = 0.5,
        similarity_boost: float = 0.75
    ) -> Path:
        """
        Replace profanity with dubbed clean audio in video.
        
        Args:
            video_path: Input video file
            profanity_matches: List of ProfanityMatch objects
            voice_id: ElevenLabs voice ID for dubbing
            output_path: Output video path
            stability: Voice stability
            similarity_boost: Voice similarity
            
        Returns:
            Path to dubbed video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        if not profanity_matches:
            logger.warning("No profanity to dub, copying original video")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Dubbing {len(profanity_matches)} segments with voice {voice_id}")
        
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                # Generate dubbed audio for each profanity
                dub_files = []
                for i, match in enumerate(profanity_matches):
                    dub_audio = temp_path / f"dub_{i}.mp3"
                    self.generate_speech(
                        text=match.replacement,
                        voice_id=voice_id,
                        output_path=dub_audio,
                        stability=stability,
                        similarity_boost=similarity_boost
                    )
                    dub_files.append((dub_audio, match.start_time))
                
                # Build FFmpeg filter to overlay dubs
                filter_parts = []
                
                # Split original audio
                filter_parts.append("[0:a]asplit=1[original]")
                
                # For each dub, add delay
                for i, (dub_path, start_time) in enumerate(dub_files):
                    delay_ms = int(start_time * 1000)
                    filter_parts.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[dub{i}]")
                
                # Mix all dubs with original audio
                inputs_to_mix = ["original"] + [f"dub{i}" for i in range(len(dub_files))]
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
                
                # Add dub files as inputs
                for dub_path, _ in dub_files:
                    cmd.extend(["-i", str(dub_path)])
                
                # Add filter and output
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "0:v",  # Copy video
                    "-map", "[out]",  # Use mixed audio
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    str(output_path)
                ])
                
                logger.info(f"Mixing {len(dub_files)} dubbed segments")
                logger.debug(f"FFmpeg command: {' '.join(cmd)}")
                
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                
                logger.info(f"✅ Voice dubbing complete: {output_path}")
                return output_path
                
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg dubbing failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply dubs: {e.stderr}")
        except Exception as e:
            logger.error(f"Dubbing error: {e}")
            raise
    
    def delete_voice(self, voice_id: str):
        """
        Delete a cloned voice from ElevenLabs.
        
        Args:
            voice_id: Voice ID to delete
        """
        try:
            self.client.voices.delete(voice_id)
            logger.info(f"Deleted voice: {voice_id}")
        except Exception as e:
            logger.warning(f"Failed to delete voice {voice_id}: {e}")
