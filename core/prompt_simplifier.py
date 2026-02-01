"""
Gemini Prompt Simplification Helper
Extracts concrete object names from vague descriptions for SAM3 segmentation.
"""

import logging
import google.generativeai as genai
from typing import Optional

logger = logging.getLogger(__name__)


class PromptSimplifier:
    """
    Uses Gemini to simplify complex violation descriptions into concrete object names.
    
    Example:
        "Depiction of tobacco use" → "cigarette"
        "Character is seen with a cigarette in mouth and subsequently lighting it" → "cigarette"
        "Large scale building explosion in the background" → "building, explosion"
    """
    
    def __init__(self, api_key: str):
        """Initialize with Gemini API key."""
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash')
        logger.info("PromptSimplifier initialized with Gemini")
    
    def simplify(self, complex_prompt: str) -> str:
        """
        Extract concrete, visible objects from a complex description.
        
        Args:
            complex_prompt: Complex description (e.g., "Depiction of tobacco use")
            
        Returns:
            Simplified prompt with concrete objects (e.g., "cigarette")
        """
        system_instruction = """You are an expert at extracting concrete, visible objects from descriptions.

Your task: Given a description, extract ONLY the physical objects that are visible in a video.

Rules:
1. Return ONLY nouns representing physical objects
2. Use simple, common words (not technical terms)
3. Separate multiple objects with commas
4. Do NOT include actions, concepts, or abstract ideas
5. Maximum 3-5 words

Examples:
Input: "Depiction of tobacco use"
Output: "cigarette"

Input: "Character is seen with a cigarette in mouth and subsequently lighting it"
Output: "cigarette"

Input: "Large scale building explosion in the background"
Output: "building, explosion"

Input: "Graphic shooting with blood and violence"
Output: "gun, blood"

Input: "Active gunfight between multiple characters"
Output: "gun, person"

Input: "A woman is shot at close range"
Output: "gun, woman"

Now extract the concrete objects:"""

        try:
            prompt = f"{system_instruction}\n\nInput: \"{complex_prompt}\"\nOutput:"
            
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.1,  # Low temperature for consistent results
                    max_output_tokens=50
                )
            )
            
            simplified = response.text.strip().strip('"').strip()
            
            logger.info(f"Prompt simplified: '{complex_prompt}' → '{simplified}'")
            return simplified
            
        except Exception as e:
            logger.error(f"Prompt simplification failed: {e}")
            # Fallback: return original prompt
            return complex_prompt
    
    def simplify_batch(self, prompts: list[str]) -> list[str]:
        """
        Simplify multiple prompts in batch.
        
        Args:
            prompts: List of complex prompts
            
        Returns:
            List of simplified prompts
        """
        return [self.simplify(prompt) for prompt in prompts]
