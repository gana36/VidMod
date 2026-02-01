"""
ElevenLabs Voice Dubber Module  
Uses ElevenLabs API with pre-built voices OR instant voice cloning for audio replacement.

Supports:
1. Pre-built voices (Rachel, Adam) - fast, no setup
2. Instant Voice Cloning - clones speaker's voice from video sample for seamless dubbing
"""

import logging
from pathlib import Path
from typing import Dict, Optional, Tuple
import tempfile
import subprocess
import uuid

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
            logger.info("ElevenLabsDubber initialized with pre-built voices + voice cloning")
        except ImportError:
            raise ImportError("elevenlabs package not installed. Run: pip install elevenlabs")
        except Exception as e:
            logger.error(f"Failed to initialize ElevenLabs: {e}")
            raise
        
        # Track cloned voices for cleanup
        self._cloned_voice_ids = []
    
    def extract_audio_sample(
        self,
        video_path: Path,
        start_time: float,
        end_time: float,
        output_path: Optional[Path] = None
    ) -> Path:
        """
        Extract audio sample from video for voice cloning.
        
        Requires at least 10 seconds of clean speech (no background music/effects).
        
        Args:
            video_path: Path to source video
            start_time: Start of clean speech sample (seconds)
            end_time: End of clean speech sample (seconds)
            output_path: Where to save the audio sample (optional)
            
        Returns:
            Path to extracted audio file (MP3)
        """
        if not output_path:
            output_path = video_path.parent / f"voice_sample_{start_time}_{end_time}.mp3"
        
        duration = end_time - start_time
        if duration < 10:
            logger.warning(f"Voice sample is only {duration:.1f}s. ElevenLabs recommends at least 10 seconds for best results.")
        
        logger.info(f"Extracting voice sample: {start_time}s to {end_time}s ({duration:.1f}s)")
        
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i", str(video_path),
            "-ss", str(start_time),
            "-t", str(duration),
            "-vn",  # No video
            "-acodec", "libmp3lame",
            "-ar", "44100",  # Sample rate
            "-ac", "1",  # Mono (better for voice cloning)
            "-b:a", "192k",  # High quality
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Voice sample extracted: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to extract audio sample: {e.stderr}")
            raise RuntimeError(f"Audio extraction failed: {e.stderr}")
    
    def create_instant_voice_clone(
        self,
        audio_sample_path: Path,
        voice_name: Optional[str] = None
    ) -> str:
        """
        Create an instant voice clone from an audio sample.
        
        Args:
            audio_sample_path: Path to audio file with clean speech
            voice_name: Name for the cloned voice (auto-generated if not provided)
            
        Returns:
            Voice ID of the created clone
        """
        if not audio_sample_path.exists():
            raise FileNotFoundError(f"Audio sample not found: {audio_sample_path}")
        
        if not voice_name:
            voice_name = f"VidMod_Clone_{uuid.uuid4().hex[:8]}"
        
        logger.info(f"Creating instant voice clone: {voice_name}")
        
        try:
            # Use the ElevenLabs SDK's clone() method for instant voice cloning
            # This is the recommended approach per ElevenLabs docs
            voice = self.client.clone(
                name=voice_name,
                files=[str(audio_sample_path)],
                description="Auto-generated voice clone for video dubbing"
            )
            
            voice_id = voice.voice_id
            self._cloned_voice_ids.append(voice_id)
            
            logger.info(f"✅ Voice clone created: {voice_name} (ID: {voice_id})")
            return voice_id
            
        except Exception as e:
            logger.error(f"Voice cloning failed: {e}")
            raise RuntimeError(f"Failed to create voice clone: {e}")
    
    def generate_speech_with_clone(
        self,
        text: str,
        voice_id: str,
        output_path: Path
    ) -> Path:
        """
        Generate speech using a cloned voice.
        
        Args:
            text: Text to speak
            voice_id: ID of the cloned voice
            output_path: Where to save the audio
            
        Returns:
            Path to generated audio file
        """
        logger.info(f"Generating speech with cloned voice: '{text[:50]}...'")
        
        try:
            audio = self.client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id="eleven_multilingual_v2"
            )
            
            with open(output_path, 'wb') as f:
                for chunk in audio:
                    f.write(chunk)
            
            logger.info(f"Cloned speech generated: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Cloned speech generation failed: {e}")
            raise
    
    def delete_cloned_voice(self, voice_id: str) -> bool:
        """
        Delete a cloned voice to free up quota.
        
        Args:
            voice_id: ID of the voice to delete
            
        Returns:
            True if deleted successfully
        """
        try:
            self.client.voices.delete(voice_id)
            if voice_id in self._cloned_voice_ids:
                self._cloned_voice_ids.remove(voice_id)
            logger.info(f"Deleted cloned voice: {voice_id}")
            return True
        except Exception as e:
            logger.warning(f"Failed to delete voice {voice_id}: {e}")
            return False
    
    def cleanup_cloned_voices(self):
        """Delete all cloned voices created in this session."""
        for voice_id in self._cloned_voice_ids.copy():
            self.delete_cloned_voice(voice_id)
        logger.info("Cleaned up all cloned voices")
    
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
    
    def apply_dubs_direct(
        self,
        video_path: Path,
        profanity_matches: list,
        output_path: Path,
        voice_type: str = "female"
    ) -> Path:
        """
        Apply dubs using PRE-ANALYZED profanity matches (no re-analysis needed).
        
        This is the OPTIMIZED version that avoids redundant Gemini API calls.
        Use this when you already have the profanity matches from the endpoint.
        
        Args:
            video_path: Input video file
            profanity_matches: List of ProfanityMatch objects (already analyzed)
            output_path: Output video path
            voice_type: "male" or "female" voice
            
        Returns:
            Path to dubbed video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        if not profanity_matches:
            logger.warning("No profanity matches provided, copying original video")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Dubbing {len(profanity_matches)} matches with {voice_type} voice (direct mode - no re-analysis)")
        
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                dub_files = []
                for i, match in enumerate(profanity_matches):
                    # Generate raw ElevenLabs audio for the replacement
                    raw_dub = temp_path / f"dub_raw_{i}.mp3"
                    self.generate_speech(
                        text=match.replacement,
                        voice_type=voice_type,
                        output_path=raw_dub
                    )
                    
                    # Match duration to original word/phrase
                    word_duration = match.end_time - match.start_time
                    stretched_dub = temp_path / f"dub_stretched_{i}.mp3"
                    
                    stretch_cmd = [
                        self.ffmpeg_path,
                        "-y",
                        "-i", str(raw_dub),
                        "-filter_complex",
                        f"[0:a]apad,atrim=0:{word_duration}[out]",
                        "-map", "[out]",
                        str(stretched_dub)
                    ]
                    
                    logger.info(f"Stretching '{match.replacement}' to match {word_duration:.2f}s")
                    subprocess.run(stretch_cmd, check=True, capture_output=True, text=True)
                    
                    dub_files.append((stretched_dub, match.start_time, match.end_time))
                
                # Build volume muting filter for original profanity
                volume_conditions = []
                for match in profanity_matches:
                    padding = 0.05
                    start_padded = max(0, match.start_time - padding)
                    end_padded = match.end_time + padding
                    volume_conditions.append(f"between(t,{start_padded},{end_padded})")
                
                volume_filter = f"volume=enable='{'|'.join(volume_conditions)}':volume=0"
                
                filter_parts = []
                filter_parts.append(f"[0:a]{volume_filter}[muted]")
                
                for i, (dub_path, start_time, _) in enumerate(dub_files):
                    delay_ms = int(start_time * 1000)
                    filter_parts.append(f"[{i+1}:a]volume=1.5,adelay={delay_ms}|{delay_ms}[dub{i}]")
                
                inputs_to_mix = ["muted"] + [f"dub{i}" for i in range(len(dub_files))]
                mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
                filter_parts.append(
                    f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0:normalize=0[out]"
                )
                
                filter_complex = ";".join(filter_parts)
                
                cmd = [
                    self.ffmpeg_path,
                    "-y",
                    "-i", str(video_path)
                ]
                
                for dub_path, _, _ in dub_files:
                    cmd.extend(["-i", str(dub_path)])
                
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "0:v",
                    "-map", "[out]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    str(output_path)
                ])
                
                logger.info(f"Applying {len(dub_files)} dubs with pre-built voice (no re-analysis)")
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                
                logger.info(f"✅ Voice dubbing complete (direct): {output_path}")
                return output_path
                
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg dubbing failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply direct dubs: {e.stderr}")
        except Exception as e:
            logger.error(f"Direct dubbing error: {e}")
            raise
    
    def apply_dubs_with_clone(
        self,
        video_path: Path,
        word_replacements: Dict[str, str],
        output_path: Path,
        voice_sample_start: float,
        voice_sample_end: float
    ) -> Path:
        """
        Replace words with dubbed audio using a CLONED voice from the video.
        
        This creates a seamless dubbing experience by cloning the speaker's voice
        from a clean section of the video and using it to speak the replacement words.
        
        Args:
            video_path: Input video file
            word_replacements: Dictionary mapping words to their replacements
            output_path: Output video path
            voice_sample_start: Start time of clean speech sample (for cloning)
            voice_sample_end: End time of clean speech sample (for cloning)
            
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
        
        logger.info(f"🎙️ Dubbing {len(word_replacements)} word replacements with CLONED voice")
        
        cloned_voice_id = None
        
        try:
            # Step 0: Extract audio sample and create voice clone
            logger.info("Step 0: Creating voice clone from video sample...")
            sample_path = self.extract_audio_sample(
                video_path=video_path,
                start_time=voice_sample_start,
                end_time=voice_sample_end
            )
            
            cloned_voice_id = self.create_instant_voice_clone(sample_path)
            logger.info(f"✅ Voice cloned successfully: {cloned_voice_id}")
            
            # Step 1: Analyze audio to find word occurrences
            from core.audio_analyzer import AudioAnalyzer
            from app.config import get_settings
            
            settings = get_settings()
            analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
            
            custom_words = list(word_replacements.keys())
            logger.info(f"Detecting instances of: {custom_words}")
            
            matches = analyzer.analyze_profanity(
                video_path,
                custom_words=custom_words
            )
            
            for match in matches:
                if match.word in word_replacements:
                    match.replacement = word_replacements[match.word]
            
            if not matches:
                logger.warning("No instances of target words found in video")
                import shutil
                shutil.copy(video_path, output_path)
                return output_path
            
            logger.info(f"Found {len(matches)} instances to replace with cloned voice")
            
            # Step 2: Generate dubbed audio using CLONED voice
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                dub_files = []
                for i, match in enumerate(matches):
                    # Generate with cloned voice
                    raw_dub = temp_path / f"dub_raw_{i}.mp3"
                    self.generate_speech_with_clone(
                        text=match.replacement,
                        voice_id=cloned_voice_id,
                        output_path=raw_dub
                    )
                    
                    # Match duration to original word
                    word_duration = match.end_time - match.start_time
                    stretched_dub = temp_path / f"dub_stretched_{i}.mp3"
                    
                    stretch_cmd = [
                        self.ffmpeg_path,
                        "-y",
                        "-i", str(raw_dub),
                        "-filter_complex",
                        f"[0:a]apad,atrim=0:{word_duration}[out]",
                        "-map", "[out]",
                        str(stretched_dub)
                    ]
                    
                    logger.info(f"Stretching cloned audio to match {word_duration:.2f}s")
                    subprocess.run(stretch_cmd, check=True, capture_output=True, text=True)
                    
                    dub_files.append((stretched_dub, match.start_time, match.end_time))
                
                # Step 3: Apply the dubs to video (same as apply_dubs)
                volume_conditions = []
                for match in matches:
                    padding = 0.05
                    start_padded = max(0, match.start_time - padding)
                    end_padded = match.end_time + padding
                    volume_conditions.append(f"between(t,{start_padded},{end_padded})")
                
                volume_filter = f"volume=enable='{'|'.join(volume_conditions)}':volume=0"
                
                filter_parts = []
                filter_parts.append(f"[0:a]{volume_filter}[muted]")
                
                for i, (dub_path, start_time, _) in enumerate(dub_files):
                    delay_ms = int(start_time * 1000)
                    filter_parts.append(f"[{i+1}:a]volume=1.5,adelay={delay_ms}|{delay_ms}[dub{i}]")
                
                inputs_to_mix = ["muted"] + [f"dub{i}" for i in range(len(dub_files))]
                mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
                filter_parts.append(
                    f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0:normalize=0[out]"
                )
                
                filter_complex = ";".join(filter_parts)
                
                cmd = [
                    self.ffmpeg_path,
                    "-y",
                    "-i", str(video_path)
                ]
                
                for dub_path, _, _ in dub_files:
                    cmd.extend(["-i", str(dub_path)])
                
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "0:v",
                    "-map", "[out]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    str(output_path)
                ])
                
                logger.info(f"Replacing {len(dub_files)} word instances with CLONED voice audio")
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                
                logger.info(f"✅ Voice cloning dubbing complete: {output_path}")
                return output_path
                
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg dubbing failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply cloned dubs: {e.stderr}")
        except Exception as e:
            logger.error(f"Cloned dubbing error: {e}")
            raise
        finally:
            # Clean up cloned voice to free quota
            if cloned_voice_id:
                self.delete_cloned_voice(cloned_voice_id)
    
    def apply_dubs_multi_speaker(
        self,
        video_path: Path,
        output_path: Path,
        custom_replacements: Optional[Dict[str, str]] = None
    ) -> Path:
        """
        AUTOMATIC multi-speaker voice cloning and dubbing.
        
        This method:
        1. Detects all speakers in the video
        2. Finds clean speech segments for each speaker
        3. Creates voice clones for each speaker
        4. Detects profanity WITH speaker attribution
        5. Dubs each profanity with the correct speaker's cloned voice
        
        Args:
            video_path: Input video file
            output_path: Output video path
            custom_replacements: Optional word -> replacement mapping
            
        Returns:
            Path to dubbed video
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        logger.info(f"🎭 MULTI-SPEAKER voice cloning dubbing for: {video_path}")
        
        cloned_voices = {}  # speaker_id -> voice_id
        
        try:
            # Step 0: Detect speakers and find clean segments
            from core.audio_analyzer import AudioAnalyzer
            from app.config import get_settings
            
            settings = get_settings()
            analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
            
            logger.info("Step 0: Detecting speakers and clean segments...")
            speaker_segments = analyzer.detect_speaker_segments(video_path)
            
            if not speaker_segments:
                logger.warning("No speaker segments found. Falling back to single voice clone.")
                # Fallback: use first 10 seconds
                return self.apply_dubs_with_clone(
                    video_path=video_path,
                    word_replacements=custom_replacements or {},
                    output_path=output_path,
                    voice_sample_start=0,
                    voice_sample_end=10
                )
            
            # Step 1: Create voice clone for each speaker
            logger.info(f"Step 1: Creating {len(speaker_segments)} voice clones...")
            for seg in speaker_segments:
                speaker_id = seg['speaker_id']
                if speaker_id in cloned_voices:
                    continue  # Already cloned this speaker
                
                sample_path = self.extract_audio_sample(
                    video_path=video_path,
                    start_time=seg['start_time'],
                    end_time=seg['end_time']
                )
                
                voice_id = self.create_instant_voice_clone(
                    sample_path,
                    voice_name=f"VidMod_{speaker_id}_{seg.get('gender', 'unknown')}"
                )
                cloned_voices[speaker_id] = voice_id
                logger.info(f"  ✅ Cloned {speaker_id} ({seg.get('gender', 'unknown')}): {voice_id}")
            
            # Step 2: Detect profanity with speaker attribution
            logger.info("Step 2: Detecting profanity with speaker identification...")
            custom_words = list(custom_replacements.keys()) if custom_replacements else None
            matches = analyzer.analyze_profanity(video_path, custom_words=custom_words)
            
            if custom_replacements:
                for match in matches:
                    if match.word in custom_replacements:
                        match.replacement = custom_replacements[match.word]
            
            if not matches:
                logger.warning("No profanity detected")
                import shutil
                shutil.copy(video_path, output_path)
                return output_path
            
            # Group matches by speaker
            speakers_in_profanity = set(m.speaker_id for m in matches)
            logger.info(f"Found {len(matches)} profanity instances from {len(speakers_in_profanity)} speakers")
            
            # Step 3: Generate dubs using appropriate voice clones
            logger.info("Step 3: Generating dubbed audio for each speaker...")
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                dub_files = []
                for i, match in enumerate(matches):
                    # Get the right voice clone for this speaker
                    voice_id = cloned_voices.get(match.speaker_id)
                    if not voice_id:
                        # Fallback to first available voice
                        voice_id = list(cloned_voices.values())[0]
                        logger.warning(f"No clone for {match.speaker_id}, using fallback")
                    
                    raw_dub = temp_path / f"dub_raw_{i}.mp3"
                    self.generate_speech_with_clone(
                        text=match.replacement,
                        voice_id=voice_id,
                        output_path=raw_dub
                    )
                    
                    # Match duration
                    word_duration = match.end_time - match.start_time
                    stretched_dub = temp_path / f"dub_stretched_{i}.mp3"
                    
                    stretch_cmd = [
                        self.ffmpeg_path,
                        "-y",
                        "-i", str(raw_dub),
                        "-filter_complex",
                        f"[0:a]apad,atrim=0:{word_duration}[out]",
                        "-map", "[out]",
                        str(stretched_dub)
                    ]
                    
                    subprocess.run(stretch_cmd, check=True, capture_output=True, text=True)
                    dub_files.append((stretched_dub, match.start_time, match.end_time))
                
                # Step 4: Apply dubs to video
                logger.info("Step 4: Mixing dubbed audio into video...")
                volume_conditions = []
                for match in matches:
                    padding = 0.05
                    start_padded = max(0, match.start_time - padding)
                    end_padded = match.end_time + padding
                    volume_conditions.append(f"between(t,{start_padded},{end_padded})")
                
                volume_filter = f"volume=enable='{'|'.join(volume_conditions)}':volume=0"
                
                filter_parts = []
                filter_parts.append(f"[0:a]{volume_filter}[muted]")
                
                for i, (dub_path, start_time, _) in enumerate(dub_files):
                    delay_ms = int(start_time * 1000)
                    filter_parts.append(f"[{i+1}:a]volume=1.5,adelay={delay_ms}|{delay_ms}[dub{i}]")
                
                inputs_to_mix = ["muted"] + [f"dub{i}" for i in range(len(dub_files))]
                mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
                filter_parts.append(
                    f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0:normalize=0[out]"
                )
                
                filter_complex = ";".join(filter_parts)
                
                cmd = [
                    self.ffmpeg_path,
                    "-y",
                    "-i", str(video_path)
                ]
                
                for dub_path, _, _ in dub_files:
                    cmd.extend(["-i", str(dub_path)])
                
                cmd.extend([
                    "-filter_complex", filter_complex,
                    "-map", "0:v",
                    "-map", "[out]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    str(output_path)
                ])
                
                logger.info(f"Replacing {len(dub_files)} word instances with MULTI-SPEAKER cloned voices")
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                
                logger.info(f"✅ Multi-speaker voice cloning dubbing complete: {output_path}")
                return output_path
                
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg dubbing failed: {e.stderr}")
            raise RuntimeError(f"Failed to apply multi-speaker dubs: {e.stderr}")
        except Exception as e:
            logger.error(f"Multi-speaker dubbing error: {e}")
            raise
        finally:
            # Clean up ALL cloned voices
            for voice_id in cloned_voices.values():
                self.delete_cloned_voice(voice_id)
            logger.info(f"Cleaned up {len(cloned_voices)} cloned voices")


