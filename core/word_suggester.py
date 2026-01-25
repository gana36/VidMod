"""
Word Suggester Module
Uses Gemini to suggest contextually similar alternative words that match speaking duration.
"""

import logging
from pathlib import Path
from typing import List, Dict, Optional
import google.generativeai as genai
import json

logger = logging.getLogger(__name__)


class WordSuggester:
    """
    Suggests alternative words using Gemini that match duration and context.
    
    Example:
        suggester = WordSuggester(api_key="your_key")
        suggestions = suggester.suggest_alternatives("damn", duration=0.5)
        # Returns: ["darn", "dang", "drat"]
    """
    
    def __init__(self, api_key: str):
        """
        Initialize word suggester.
        
        Args:
            api_key: Gemini API key
        """
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
        logger.info("WordSuggester initialized with Gemini 2.0 Flash")
    
    def suggest_alternatives(
        self,
        word: str,
        duration: float = 0.5,
        num_suggestions: int = 5
    ) -> List[str]:
        """
        Generate alternative words that sound similar and match duration.
        
        Args:
            word: Original word to replace
            duration: Speaking duration in seconds
            num_suggestions: Number of alternatives to generate (default: 5)
            
        Returns:
            List of suggested alternative words
        """
        logger.info(f"Generating {num_suggestions} alternatives for '{word}' (duration: {duration:.2f}s)")
        
        # Estimate syllable count from duration (rough heuristic: 0.2-0.3s per syllable)
        estimated_syllables = max(1, round(duration / 0.25))
        
        prompt = f"""
Generate {num_suggestions} alternative words or short phrases to replace the word "{word}".

CRITICAL REQUIREMENTS:
1. Alternatives should be contextually appropriate and clean/family-friendly
2. Alternatives should have approximately {estimated_syllables} syllable(s) to match the speaking duration of {duration:.2f} seconds
3. Alternatives should sound natural when spoken
4. Alternatives should NOT be profane or offensive
5. Prioritize common, easy-to-pronounce words

EXAMPLES:
- "damn" → ["darn", "dang", "drat", "shoot", "blast"]
- "shit" → ["shoot", "sugar", "shucks", "crud", "crap"]
- "hell" → ["heck", "hades", "heaven", "Halifax", "hay"]
- "piece of shit" → ["piece of junk", "trash heap", "lot of work", "real mess", "bad thing"]

Return ONLY a valid JSON array of {num_suggestions} alternative words/phrases:
["alternative1", "alternative2", "alternative3", ...]

No explanations, no markdown, just the JSON array.
"""
        
        try:
            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Extract JSON from markdown code blocks if present
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
            
            # Parse JSON
            suggestions = json.loads(response_text)
            
            if not isinstance(suggestions, list):
                logger.warning(f"Gemini returned non-list response: {suggestions}")
                return self._fallback_suggestions(word)
            
            # Ensure we have the requested number
            suggestions = suggestions[:num_suggestions]
            
            logger.info(f"✅ Generated {len(suggestions)} alternatives: {suggestions}")
            return suggestions
            
        except Exception as e:
            logger.error(f"Failed to generate suggestions: {e}")
            return self._fallback_suggestions(word)
    
    def suggest_bulk(
        self,
        words: List[str],
        durations: Optional[List[float]] = None,
        num_suggestions: int = 5
    ) -> Dict[str, List[str]]:
        """
        Generate alternatives for multiple words at once.
        
        Args:
            words: List of words to replace
            durations: Optional list of durations (one per word)
            num_suggestions: Number of alternatives per word
            
        Returns:
            Dictionary mapping each word to its alternatives
        """
        if durations is None:
            durations = [0.5] * len(words)
        
        if len(words) != len(durations):
            logger.warning("Words and durations length mismatch, using default duration")
            durations = [0.5] * len(words)
        
        results = {}
        for word, duration in zip(words, durations):
            results[word] = self.suggest_alternatives(word, duration, num_suggestions)
        
        return results
    
    def _fallback_suggestions(self, word: str) -> List[str]:
        """
        Provide basic fallback suggestions if Gemini fails.
        
        Args:
            word: Word to replace
            
        Returns:
            List of hardcoded common alternatives
        """
        # Common profanity mappings (fallback only)
        fallbacks = {
            "damn": ["darn", "dang", "drat", "shoot", "blast"],
            "shit": ["shoot", "sugar", "shucks", "crud", "crap"],
            "hell": ["heck", "hades", "heaven", "Halifax", "hay"],
            "fuck": ["frick", "freak", "flip", "fudge", "forget"],
            "ass": ["butt", "rear", "behind", "backside", "donkey"],
            "bitch": ["witch", "jerk", "mean person", "meanie", "grump"],
            "crap": ["crud", "junk", "trash", "stuff", "nonsense"],
            "piss": ["tick", "upset", "annoy", "anger", "bother"]
        }
        
        # Return fallback or generic alternatives
        return fallbacks.get(word.lower(), ["alternative", "replacement", "substitute", "other word", "better choice"])
