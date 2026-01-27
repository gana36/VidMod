"""
ElevenLabs Voice Dubber Module  
Uses ElevenLabs API with pre-built voices for audio replacement.
"""

import logging
from pathlib import Path
from typing import Dict
import tempfile
import subprocess

logger = logging.getLogger(__name__)

# Pre-built ElevenLabs voice IDs (these are free tier voices)
VOICE_PRESETS = {
    "female": "21m00Tcm4TlvDq8ikWAM",  # Rachel - natural female voice
    "male": "pNInz6obpgDQGcFmaJgB"      # Adam - natural male voice
}


class ElevenLabsDubber:
    """
    Uses ElevenLabs pre-built voices to dub clean replacements over profanity.
    
    Example:
        dubber = ElevenLabsDubber(api_key="your_key")
        dubber.apply_dubs(video_path, word_replacements, output_path, voice_type="female")
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
            from elevenlabs.client import ElevenLabs
            self.client = ElevenLabs(api_key=api_key)
            logger.info("ElevenLabsDubber initialized with pre-built voices")
        except ImportError:
            raise ImportError("elevenlabs package not installed. Run: pip install elevenlabs")
        except Exception as e:
            logger.error(f"Failed to initialize ElevenLabs: {e}")
            raise
    
    def generate_speech(
        self,
        text: str,
        voice_type: str = "female",
        output_path: Path = None
    ) -> Path:
        """
        Generate speech audio using pre-built ElevenLabs voice.
        
        Args:
            text: Text to speak
            voice_type: "male" or "female"
            output_path: Where to save audio
            
        Returns:
            Path to generated audio file
        """
        voice_id = VOICE_PRESETS.get(voice_type, VOICE_PRESETS["female"])
        logger.info(f"Generating speech with {voice_type} voice: '{text}'")
        
        try:
            # Generate audio using text_to_speech
            audio = self.client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id="eleven_multilingual_v2"
            )
            
            # Save audio - audio is an iterator of bytes
            with open(output_path, 'wb') as f:
                for chunk in audio:
                    f.write(chunk)
            
            logger.info(f"Speech generated: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Speech generation failed: {e}")
            raise
    
    def apply_dubs(
        self,
        video_path: Path,
        word_replacements: Dict[str, str],
        output_path: Path,
        voice_type: str = "female"
    ) -> Path:
        """
        Replace words with dubbed clean audio in video.
        Detects ALL instances of target words and replaces them.
        
        Args:
            video_path: Input video file
            word_replacements: Dictionary mapping words to their replacements
            output_path: Output video path
            voice_type: "male" or "female" voice
            
        Returns:
            Path to dubbed video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        if not word_replacements:
            logger.warning("No words to replace, copying original video")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Dubbing {len(word_replacements)} word replacements with {voice_type} voice")
        
        try:
            # Step 1: Analyze audio to find word occurrences
            from core.audio_analyzer import AudioAnalyzer
            from app.config import get_settings
            
            settings = get_settings()
            analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
            
            # Build custom words list from user's input
            custom_words = list(word_replacements.keys())
            logger.info(f"Detecting instances of: {custom_words}")
            
            # Detect all instances of these words
            matches = analyzer.analyze_profanity(
                video_path,
                custom_words=custom_words
            )
            
            # Override replacements with user's custom replacements
            for match in matches:
                if match.word in word_replacements:
                    match.replacement = word_replacements[match.word]
            
            if not matches:
                logger.warning("No instances of target words found in video")
                import shutil
                shutil.copy(video_path, output_path)
                return output_path
            
            logger.info(f"Found {len(matches)} instances to replace")
            
            # Step 2: Generate dubbed audio for each instance and match duration
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                dub_files = []
                for i, match in enumerate(matches):
                    # Generate raw ElevenLabs audio
                    raw_dub = temp_path / f"dub_raw_{i}.mp3"
                    self.generate_speech(
                        text=match.replacement,
                        voice_type=voice_type,
                        output_path=raw_dub
                    )
                    
                    # Calculate exact duration needed to replace original word
                    word_duration = match.end_time - match.start_time
                    
                    # Stretch/compress the ElevenLabs audio to match exact duration
                    # This ensures seamless replacement with no gaps
                    stretched_dub = temp_path / f"dub_stretched_{i}.mp3"
                    
                    # Use atempo filter to adjust speed while maintaining pitch
                    # If duration doesn't match, we use asetrate+atempo for precise control
                    stretch_cmd = [
                        self.ffmpeg_path,
                        "-y",
                        "-i", str(raw_dub),
                        "-filter_complex",
                        f"[0:a]apad,atrim=0:{word_duration}[out]",  # Pad or trim to exact duration
                        "-map", "[out]",
                        str(stretched_dub)
                    ]
                    
                    logger.info(f"Stretching replacement audio to match {word_duration:.2f}s")
                    subprocess.run(stretch_cmd, check=True, capture_output=True, text=True)
                    
                    dub_files.append((stretched_dub, match.start_time, match.end_time))
                
                # Step 3: Mute original audio during word occurrences and overlay dubs
                # Build volume filter to COMPLETELY MUTE original audio at exact timestamps
                # Use very aggressive muting with fade to ensure no bleed-through
                volume_conditions = []
                for match in matches:
                    # Add small padding before/after to ensure complete coverage
                    padding = 0.05  # 50ms padding on each side
                    start_padded = max(0, match.start_time - padding)
                    end_padded = match.end_time + padding
                    volume_conditions.append(f"between(t,{start_padded},{end_padded})")
                
                # Complete muting with volume=0 (absolute silence)
                volume_filter = f"volume=enable='{'|'.join(volume_conditions)}':volume=0"
                
                filter_parts = []
                
                # Apply volume filter to completely mute words in original audio
                filter_parts.append(f"[0:a]{volume_filter}[muted]")
                
                # For each dub, add delay to align with exact timestamp
                # Also normalize volume to ensure dubs are clearly audible
                for i, (dub_path, start_time, _) in enumerate(dub_files):
                    delay_ms = int(start_time * 1000)
                    # Normalize and slightly boost dub volume for clarity
                    filter_parts.append(f"[{i+1}:a]volume=1.5,adelay={delay_ms}|{delay_ms}[dub{i}]")
                
                # Mix muted audio with all dubs
                # Use amix with normalize=0 to prevent volume reduction
                inputs_to_mix = ["muted"] + [f"dub{i}" for i in range(len(dub_files))]
                mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
                filter_parts.append(
                    f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0:normalize=0[out]"
                )
                
                filter_complex = ";".join(filter_parts)
                
                # Build FFmpeg command
                cmd = [
                    self.ffmpeg_path,
                    "-y",
                    "-i", str(video_path)
                ]
                
                # Add stretched dub files as inputs
                for dub_path, _, _ in dub_files:
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
                
                logger.info(f"Replacing {len(dub_files)} word instances with seamless ElevenLabs audio")
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
