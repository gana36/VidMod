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
            # Use the correct ElevenLabs SDK method for instant voice cloning
            # The client.clone() method does NOT exist - use voices.ivc.create()
            with open(str(audio_sample_path), "rb") as audio_file:
                voice = self.client.voices.ivc.create(
                    name=voice_name,
                    files=[audio_file],
                    description="Auto-generated voice clone for video dubbing"
                )
            
            voice_id = voice.voice_id
            self._cloned_voice_ids.append(voice_id)
            
            logger.info(f"✅ Voice clone created: {voice_name} (ID: {voice_id})")
            return voice_id
            
        except Exception as e:
            logger.error(f"Voice cloning failed: {e}")
            raise RuntimeError(f"Failed to create voice clone: {e}")

    def cluster_matches(self, matches: list, threshold: float = 1.0) -> list:
        """
        Group adjacent word matches into continuous dubbing regions.
        Clusters matches from the same speaker if the gap is < threshold.
        """
        if not matches:
            return []
        
        # Sort by start time just in case
        sorted_matches = sorted(matches, key=lambda m: m.start_time)
        
        clusters = []
        if not sorted_matches:
            return []
            
        current_cluster = {
            'speaker_id': sorted_matches[0].speaker_id,
            'start_time': sorted_matches[0].start_time,
            'end_time': sorted_matches[0].end_time,
            'original_words': [sorted_matches[0].word],
            'replacement_words': [sorted_matches[0].replacement]
        }
        
        for m in sorted_matches[1:]:
            # Conditions for clustering:
            # 1. Same speaker
            # 2. Gap is small (< threshold)
            gap = m.start_time - current_cluster['end_time']
            if m.speaker_id == current_cluster['speaker_id'] and gap < threshold:
                # Extend current cluster
                current_cluster['end_time'] = m.end_time
                current_cluster['original_words'].append(m.word)
                current_cluster['replacement_words'].append(m.replacement)
            else:
                # Close current and start new
                clusters.append(current_cluster)
                current_cluster = {
                    'speaker_id': m.speaker_id,
                    'start_time': m.start_time,
                    'end_time': m.end_time,
                    'original_words': [m.word],
                    'replacement_words': [m.replacement]
                }
        
        clusters.append(current_cluster)
        
        # Format phrases
        formatted_clusters = []
        for c in clusters:
            formatted_clusters.append({
                'speaker_id': c['speaker_id'],
                'start_time': c['start_time'],
                'end_time': c['end_time'],
                'phrase': " ".join(c['replacement_words'])
            })
            
        logger.info(f"Clustered {len(matches)} words into {len(formatted_clusters)} dubbing phrases")
        return formatted_clusters
    
    def get_audio_duration(self, audio_path: Path) -> float:
        """Get precise duration of audio file in seconds using ffprobe."""
        try:
            cmd = [
                self.ffmpeg_path.replace("ffmpeg", "ffprobe"),
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path)
            ]
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            duration = float(result.stdout.strip())
            logger.debug(f"Audio duration: {audio_path.name} = {duration:.3f}s")
            return duration
        except Exception as e:
            logger.error(f"Failed to get audio duration: {e}")
            return 0.0

    def trim_audio_silence(self, input_path: Path, output_path: Path) -> Path:
        """
        Trim leading and trailing silence from audio file.
        Essential for precise timing in dubbing.
        """
        logger.info(f"Trimming silence: {input_path.name}")
        
        # silenceremove filter:
        # stop_periods=-1: trim at end
        # stop_duration=0.1: silence duration
        # stop_threshold=-50dB: what counts as silence
        cmd = [
            self.ffmpeg_path, "-y",
            "-i", str(input_path),
            "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB:stop_periods=-1:stop_duration=0.05:stop_threshold=-50dB",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Silence trimming failed: {e.stderr}")
            import shutil
            shutil.copy(input_path, output_path)
            return output_path
    
    def time_stretch_audio(
        self, 
        input_path: Path, 
        output_path: Path, 
        target_duration: float
    ) -> Path:
        """
        Time-stretch audio to EXACTLY match target duration.
        Trims silence first for perfect pacing.
        """
        # Step 1: Trim leading/trailing silence to get "actual" speech duration
        temp_trimmed = input_path.parent / f"trimmed_{uuid.uuid4().hex[:8]}.mp3"
        self.trim_audio_silence(input_path, temp_trimmed)
        
        source_duration = self.get_audio_duration(temp_trimmed)
        
        if source_duration <= 0:
            logger.warning(f"Could not get source duration, copying as-is")
            import shutil
            shutil.copy(input_path, output_path)
            if temp_trimmed.exists(): temp_trimmed.unlink()
            return output_path
        
        # Calculate tempo ratio (source/target)
        tempo_ratio = source_duration / target_duration
        logger.info(f"Time-stretch (trimmed): {source_duration:.3f}s → {target_duration:.3f}s (ratio={tempo_ratio:.3f})")
        
        # Build chained atempo filters
        atempo_filters = []
        remaining = tempo_ratio
        
        while remaining > 2.0:
            atempo_filters.append("atempo=2.0")
            remaining /= 2.0
        while remaining < 0.5:
            atempo_filters.append("atempo=0.5")
            remaining /= 0.5
        
        if 0.5 <= remaining <= 2.0 and abs(remaining - 1.0) > 0.001:
            atempo_filters.append(f"atempo={remaining:.6f}")
        
        tempo_chain = ",".join(atempo_filters) if atempo_filters else "anull"
        
        # Add micro-fades (10ms) to prevent clicks
        fade_dur = 0.01
        mute_start = max(0, target_duration - fade_dur)
        
        filter_complex = (
            f"[0:a]{tempo_chain},"
            f"atrim=0:{target_duration:.6f},"
            f"afade=t=in:d={fade_dur},"
            f"afade=t=out:st={mute_start:.6f}:d={fade_dur}"
            f"[out]"
        )
        
        cmd = [
            self.ffmpeg_path, "-y",
            "-i", str(temp_trimmed),
            "-filter_complex", filter_complex,
            "-map", "[out]",
            "-ac", "2", "-ar", "44100", "-acodec", "libmp3lame", "-q:a", "2",
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            if temp_trimmed.exists(): temp_trimmed.unlink()
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Time-stretch failed: {e.stderr}")
            if temp_trimmed.exists(): temp_trimmed.unlink()
            return output_path
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            
            # Verify output duration
            actual_duration = self.get_audio_duration(output_path)
            diff = abs(actual_duration - target_duration)
            
            if diff > 0.05:  # More than 50ms off
                logger.warning(f"Duration mismatch: target={target_duration:.3f}s, actual={actual_duration:.3f}s")
            else:
                logger.info(f"✅ Stretched audio: {actual_duration:.3f}s (target: {target_duration:.3f}s)")
            
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Time-stretch failed: {e.stderr}")
            # Fallback: simple pad/trim without tempo change
            fallback_cmd = [
                self.ffmpeg_path, "-y",
                "-i", str(input_path),
                "-filter_complex", f"[0:a]apad,atrim=0:{target_duration:.6f}[out]",
                "-map", "[out]",
                str(output_path)
            ]
            subprocess.run(fallback_cmd, check=True, capture_output=True, text=True)
            return output_path
    
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
    
    def patch_audio_seamless(
        self,
        video_path: Path,
        dub_segments: list,
        output_path: Path
    ) -> Path:
        """
        Seamlessly patch dubbed audio segments onto video.
        
        This method:
        1. Mutes original audio at precise timestamps
        2. Overlays dubbed audio with crossfade blending
        3. Mixes all tracks for seamless result
        
        Args:
            video_path: Input video file
            dub_segments: List of tuples (audio_path, start_time, end_time)
            output_path: Output video file
            
        Returns:
            Path to output video
        """
        if not dub_segments:
            logger.warning("No dub segments provided, copying original")
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        logger.info(f"Patching {len(dub_segments)} audio segments onto video...")
        
        # Step 1: Mute original audio at word timestamps
        # Increased padding to 0.05s to ensure total removal of original words
        volume_conditions = []
        for _, start_time, end_time in dub_segments:
            padding = 0.1
            start_p = max(0, start_time - padding)
            end_p = end_time + padding
            volume_conditions.append(f"between(t,{start_p:.6f},{end_p:.6f})")
        
        mute_expr = "|".join(volume_conditions)
        filter_parts = []
        filter_parts.append(f"[0:a]volume=enable='{mute_expr}':volume=0[muted]")
        
        # Step 2: Process each dubbed segment with refined crossfades (25ms)
        for i, (dub_path, start_time, end_time) in enumerate(dub_segments):
            delay_ms = int(start_time * 1000)
            duration = end_time - start_time
            fade_dur = 0.05
            fade_out_st = max(0, duration - fade_dur)
            
            fade_filter = f"afade=t=in:d={fade_dur},afade=t=out:st={fade_out_st:.6f}:d={fade_dur}"
            filter_parts.append(f"[{i+1}:a]{fade_filter},adelay={delay_ms}|{delay_ms}[dub{i}]")
        
        # Step 3: Mix all tracks together
        inputs_to_mix = ["muted"] + [f"dub{i}" for i in range(len(dub_segments))]
        mix_inputs = "".join(f"[{inp}]" for inp in inputs_to_mix)
        
        # amix with:
        # - duration=first: use first input's duration (the video)
        # - dropout_transition=0: no gradual dropout
        # - normalize=0: don't normalize (preserve volumes)
        filter_parts.append(
            f"{mix_inputs}amix=inputs={len(inputs_to_mix)}:duration=first:dropout_transition=0:normalize=0[out]"
        )
        
        filter_complex = ";".join(filter_parts)
        
        logger.info(f"FFmpeg filter: {filter_complex[:200]}...")
        
        # Build FFmpeg command
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i", str(video_path)
        ]
        
        # Add each dub segment as input
        for dub_path, _, _ in dub_segments:
            cmd.extend(["-i", str(dub_path)])
        
        cmd.extend([
            "-filter_complex", filter_complex,
            "-map", "0:v",      # Video from original
            "-map", "[out]",    # Audio from our mix
            "-c:v", "copy",     # Copy video (no re-encode)
            "-c:a", "aac",      # AAC audio codec
            "-b:a", "192k",     # High quality audio bitrate
            str(output_path)
        ])
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"✅ Audio patched successfully: {output_path}")
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Audio patching failed: {e.stderr}")
            raise RuntimeError(f"Failed to patch audio: {e.stderr}")
    
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
            
            # Step 2: Cluster words into phrases for seamless dubbing
            clusters = self.cluster_matches(matches)
            
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                dub_segments = []
                for i, c in enumerate(clusters):
                    # Generate speech for the ENTIRE phrase
                    raw_dub = temp_path / f"phrase_raw_{i}.mp3"
                    self.generate_speech(
                        text=c['phrase'],
                        voice_type=voice_type,
                        output_path=raw_dub
                    )
                    
                    # Total duration of the cluster region
                    target_duration = c['end_time'] - c['start_time']
                    stretched_dub = temp_path / f"phrase_stretched_{i}.mp3"
                    
                    self.time_stretch_audio(
                        input_path=raw_dub,
                        output_path=stretched_dub,
                        target_duration=target_duration
                    )
                    
                    dub_segments.append((stretched_dub, c['start_time'], c['end_time']))
                
                # Step 3: Patch audio using clustered segments
                self.patch_audio_seamless(
                    video_path=video_path,
                    dub_segments=dub_segments,
                    output_path=output_path
                )
                
                logger.info(f"✅ Voice dubbing complete (clustered): {output_path}")
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
                
                # Step 1: Cluster matches into phrases
                clusters = self.cluster_matches(profanity_matches)
                
                dub_segments = []
                for i, c in enumerate(clusters):
                    # Generate speech for the ENTIRE phrase
                    raw_dub = temp_path / f"phrase_raw_{i}.mp3"
                    self.generate_speech(
                        text=c['phrase'],
                        voice_type=voice_type,
                        output_path=raw_dub
                    )
                    
                    # Total duration of the cluster region
                    target_duration = c['end_time'] - c['start_time']
                    stretched_dub = temp_path / f"phrase_stretched_{i}.mp3"
                    
                    self.time_stretch_audio(
                        input_path=raw_dub,
                        output_path=stretched_dub,
                        target_duration=target_duration
                    )
                    
                    dub_segments.append((stretched_dub, c['start_time'], c['end_time']))
                
                # Seamlessly patch dubbed audio onto video
                self.patch_audio_seamless(
                    video_path=video_path,
                    dub_segments=dub_segments,
                    output_path=output_path
                )
                
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
        voice_sample_end: float,
        profanity_matches: Optional[list] = None
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
            
            # Step 1: Get profanity matches (re-analyze only if not provided)
            if profanity_matches:
                logger.info(f"Step 1: Using {len(profanity_matches)} provided matches (no re-analysis)")
                matches = profanity_matches
            else:
                from core.audio_analyzer import AudioAnalyzer
                from app.config import get_settings
                
                settings = get_settings()
                analyzer = AudioAnalyzer(api_key=settings.gemini_api_key)
                
                custom_words = list(word_replacements.keys())
                logger.info(f"Detecting instances of: {custom_words}")
                
                # Detect all instances of these words
                matches = analyzer.analyze_profanity(
                    video_path,
                    custom_words=custom_words
                )
            
            # Apply custom replacements if provided
            for match in matches:
                if word_replacements and match.word in word_replacements:
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
                
                # Step 1: Cluster matches into phrases for cloned voice
                clusters = self.cluster_matches(matches)
                
                dub_segments = []
                for i, c in enumerate(clusters):
                    # Generate with cloned voice
                    raw_dub = temp_path / f"phrase_raw_{i}.mp3"
                    self.generate_speech_with_clone(
                        text=c['phrase'],
                        voice_id=cloned_voice_id,
                        output_path=raw_dub
                    )
                    
                    # Total duration of the cluster region
                    target_duration = c['end_time'] - c['start_time']
                    stretched_dub = temp_path / f"phrase_stretched_{i}.mp3"
                    
                    self.time_stretch_audio(
                        input_path=raw_dub,
                        output_path=stretched_dub,
                        target_duration=target_duration
                    )
                    
                    dub_segments.append((stretched_dub, c['start_time'], c['end_time']))
                
                # Seamlessly patch dubbed audio onto video
                self.patch_audio_seamless(
                    video_path=video_path,
                    dub_segments=dub_segments,
                    output_path=output_path
                )
                
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
        custom_replacements: Optional[Dict[str, str]] = None,
        profanity_matches: Optional[list] = None
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
            
            # Step 2: Get profanity matches (re-analyze only if not provided)
            logger.info("Step 2: Getting profanity matches...")
            if profanity_matches:
                logger.info(f"  Using {len(profanity_matches)} provided matches (no re-analysis)")
                matches = profanity_matches
            else:
                logger.info("  Analyzing audio for profanity with speaker identification...")
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
                
                # Cluster matches into phrases per speaker
                clusters = self.cluster_matches(matches)
                
                dub_segments = []
                for i, c in enumerate(clusters):
                    # Get the right voice clone for this speaker
                    voice_id = cloned_voices.get(c['speaker_id'])
                    if not voice_id:
                        # Fallback to first available voice
                        voice_id = list(cloned_voices.values())[0]
                        logger.warning(f"No clone for {c['speaker_id']}, using fallback")
                    
                    raw_dub = temp_path / f"phrase_raw_{i}.mp3"
                    self.generate_speech_with_clone(
                        text=c['phrase'],
                        voice_id=voice_id,
                        output_path=raw_dub
                    )
                    
                    # Total duration of the cluster region
                    target_duration = c['end_time'] - c['start_time']
                    stretched_dub = temp_path / f"phrase_stretched_{i}.mp3"
                    
                    self.time_stretch_audio(
                        input_path=raw_dub,
                        output_path=stretched_dub,
                        target_duration=target_duration
                    )
                    
                    dub_segments.append((stretched_dub, c['start_time'], c['end_time']))
                
                # Step 4: Seamlessly patch dubbed audio onto video
                logger.info("Step 4: Patching dubbed audio with phrase-based crossfade blending...")
                
                self.patch_audio_seamless(
                    video_path=video_path,
                    dub_segments=dub_segments,
                    output_path=output_path
                )
                
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


