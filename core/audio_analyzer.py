"""
Audio Analyzer Module
Uses Gemini 2.0 Flash to detect profanity in video/audio with precise timestamps.
"""

import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import google.generativeai as genai
import json

logger = logging.getLogger(__name__)


@dataclass
class ProfanityMatch:
    """Represents a detected profanity instance."""
    word: str
    start_time: float
    end_time: float
    replacement: str
    confidence: str = "high"
    context: str = ""


class AudioAnalyzer:
    """
    Analyzes video/audio for profanity using Gemini 2.0 Flash.
    
    Example:
        analyzer = AudioAnalyzer(api_key="your_key")
        matches = analyzer.analyze_profanity(video_path)
        for match in matches:
            print(f"{match.word} at {match.start_time}s -> {match.replacement}")
    """
    
    def __init__(self, api_key: str):
        """
        Initialize audio analyzer.
        
        Args:
            api_key: Gemini API key
        """
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
        logger.info("AudioAnalyzer initialized with Gemini 2.0 Flash")
    
    def analyze_profanity(
        self,
        video_path: Path,
        custom_words: Optional[List[str]] = None
    ) -> List[ProfanityMatch]:
        """
        Detect profanity in video/audio with timestamps.
        
        Args:
            video_path: Path to video file
            custom_words: Optional list of custom words to detect (in addition to standard profanity)
            
        Returns:
            List of ProfanityMatch objects with word, timestamps, and replacement suggestions
            
        Raises:
            FileNotFoundError: If video file doesn't exist
            ValueError: If Gemini API fails
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")
        
        logger.info(f"Analyzing audio for profanity: {video_path}")
        
        try:
            # Upload video to Gemini
            logger.info("Uploading video to Gemini...")
            video_file = genai.upload_file(path=str(video_path))
            
            # Wait for processing
            import time
            while video_file.state.name == "PROCESSING":
                time.sleep(1)
                video_file = genai.get_file(video_file.name)
            
            if video_file.state.name == "FAILED":
                raise ValueError("Gemini video processing failed")
            
            logger.info(f"Video uploaded: {video_file.uri}")
            
            # Build prompt
            custom_instruction = ""
            if custom_words:
                custom_instruction = f"\nAlso detect these custom words: {', '.join(custom_words)}"
            
            prompt = f"""
Analyze this video's audio track and detect ALL instances of profanity, cuss words, and inappropriate language.

{custom_instruction}

CRITICAL INSTRUCTIONS:
1. Detect COMPLETE profane phrases, not individual words
   - Example: "piece of shit" should be ONE detection with timestamps covering the ENTIRE phrase
   - Example: "what the fuck" should be ONE detection, not three separate words
   - Example: "holy shit" should be ONE detection covering both words

2. For EACH profane phrase detected, provide:
   - The exact COMPLETE phrase spoken (all words together)
   - Start timestamp: When the FIRST word of the phrase begins (precise to 0.1s)
   - End timestamp: When the LAST word of the phrase ends (precise to 0.1s)
   - A clean, contextually appropriate replacement for the ENTIRE phrase
   - Your confidence level (high/medium/low)
   - Brief context (what was being said)

3. Ensure timestamps cover the ENTIRE duration of the profane phrase
   - Include any connecting words like "of", "the", "a" that are part of the phrase
   - Make sure end_time is AFTER all words in the phrase have been spoken

Return ONLY a valid JSON array with this structure:
[
  {{
    "word": "complete profane phrase spoken",
    "start_time": 12.5,
    "end_time": 13.8,
    "replacement": "clean alternative for entire phrase",
    "confidence": "high",
    "context": "Speaker was expressing frustration"
  }}
]

If NO profanity is detected, return an empty array: []

EXAMPLES:
- If speaker says "piece of shit" at 5.2s-6.1s, return ONE entry with word="piece of shit", start_time=5.2, end_time=6.1
- If speaker says "damn" at 10.5s-10.9s, return ONE entry with word="damn", start_time=10.5, end_time=10.9
- If speaker says "what the hell" at 15.0s-15.8s, return ONE entry with word="what the hell", start_time=15.0, end_time=15.8

Be thorough - check the entire audio track. Detect complete phrases, not fragmented words.
"""
            
            # Generate analysis
            logger.info("Analyzing with Gemini...")
            response = self.model.generate_content([video_file, prompt])
            
            # Parse response
            response_text = response.text.strip()
            
            # Extract JSON from markdown code blocks if present
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
            
            logger.info(f"Raw Gemini response: {response_text[:200]}...")
            
            # Parse JSON
            try:
                profanity_data = json.loads(response_text)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Gemini response as JSON: {e}")
                logger.error(f"Response text: {response_text}")
                raise ValueError(f"Gemini returned invalid JSON: {e}")
            
            # Convert to ProfanityMatch objects
            matches = []
            for item in profanity_data:
                try:
                    match = ProfanityMatch(
                        word=item.get("word", ""),
                        start_time=float(item.get("start_time", 0)),
                        end_time=float(item.get("end_time", 0)),
                        replacement=item.get("replacement", "[censored]"),
                        confidence=item.get("confidence", "medium"),
                        context=item.get("context", "")
                    )
                    matches.append(match)
                except (KeyError, ValueError, TypeError) as e:
                    logger.warning(f"Skipping invalid profanity match: {item} - {e}")
                    continue
            
            # Post-processing: Merge adjacent/overlapping detections
            # This catches cases where Gemini still splits phrases
            matches = self._merge_adjacent_matches(matches)
            
            logger.info(f"✅ Detected {len(matches)} instances of profanity")
            
            # Clean up uploaded file
            try:
                genai.delete_file(video_file.name)
            except:
                pass
            
            return matches
            
        except Exception as e:
            logger.error(f"Audio analysis failed: {e}")
            raise
    
    def _merge_adjacent_matches(
        self,
        matches: List[ProfanityMatch],
        merge_threshold: float = 0.5
    ) -> List[ProfanityMatch]:
        """
        Merge profanity matches that are close together (likely parts of same phrase).
        
        Args:
            matches: List of profanity matches
            merge_threshold: Maximum gap in seconds to merge (default: 0.5s)
            
        Returns:
            List of merged matches
        """
        if len(matches) <= 1:
            return matches
        
        # Sort by start time
        sorted_matches = sorted(matches, key=lambda m: m.start_time)
        
        merged = []
        current = sorted_matches[0]
        
        for next_match in sorted_matches[1:]:
            # Check if next match is within threshold of current match end
            gap = next_match.start_time - current.end_time
            
            if gap <= merge_threshold:
                # Merge: extend current match to include next match
                logger.info(f"Merging adjacent profanity: '{current.word}' + '{next_match.word}' (gap: {gap:.2f}s)")
                current = ProfanityMatch(
                    word=f"{current.word} {next_match.word}",
                    start_time=current.start_time,
                    end_time=next_match.end_time,
                    replacement=f"{current.replacement} {next_match.replacement}",
                    confidence=current.confidence,
                    context=current.context
                )
            else:
                # No merge needed, save current and move to next
                merged.append(current)
                current = next_match
        
        # Don't forget the last match
        merged.append(current)
        
        if len(merged) < len(sorted_matches):
            logger.info(f"Merged {len(sorted_matches)} detections into {len(merged)} continuous phrases")
        
        return merged
            
    
    def get_profanity_summary(self, matches: List[ProfanityMatch]) -> Dict[str, Any]:
        """
        Generate a summary of detected profanity.
        
        Args:
            matches: List of ProfanityMatch objects
            
        Returns:
            Dictionary with summary statistics
        """
        if not matches:
            return {
                "total_count": 0,
                "unique_words": [],
                "duration_affected": 0.0,
                "severity": "none"
            }
        
        unique_words = list(set(m.word for m in matches))
        total_duration = sum(m.end_time - m.start_time for m in matches)
        
        # Simple severity assessment
        severity = "low" if len(matches) <= 3 else "medium" if len(matches) <= 10 else "high"
        
        return {
            "total_count": len(matches),
            "unique_words": unique_words,
            "duration_affected": round(total_duration, 2),
            "severity": severity,
            "high_confidence_count": sum(1 for m in matches if m.confidence == "high")
        }
