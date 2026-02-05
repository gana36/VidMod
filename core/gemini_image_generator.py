"""
Gemini Image Generator for Reference Images.
Uses Gemini 3 (gemini-3-pro-image-preview) for high-quality image generation.
"""

import logging
import os
import base64
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class GeminiImageGenerator:
    """
    Generate reference images using Gemini 3's native image generation.
    Used for creating reference images for Runway video replacement.
    """
    
    def __init__(self, api_key: str = None):
        """
        Initialize Gemini Image Generator.
        
        Args:
            api_key: Gemini API key (from GEMINI_API_KEY env var)
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set")
        
        # Initialize the GenAI SDK
        try:
            from google import genai
            from google.genai import types
            
            self.client = genai.Client(api_key=self.api_key)
            self.types = types
            logger.info("Gemini Image Generator initialized (Gemini 3)")
        except ImportError:
            raise ImportError("google-genai package not installed. Run: pip install google-genai")
    
    def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        negative_prompt: Optional[str] = None
    ) -> bytes:
        """
        Generate an image from a text prompt using Gemini 2.0 Flash.
        
        Args:
            prompt: Description of the image to generate
            aspect_ratio: Image aspect ratio (currently ignored, model decides)
            negative_prompt: Optional description of what to avoid
            
        Returns:
            Image data as bytes
        """
        logger.info(f"Generating image: {prompt}")
        
        # Enhance the prompt for better reference images
        enhanced_prompt = self._enhance_prompt(prompt, negative_prompt)
        
        try:
            # Use Gemini 2.0 Flash with native image generation
            response = self.client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=enhanced_prompt,
                config=self.types.GenerateContentConfig(
                    response_modalities=['IMAGE', 'TEXT']
                )
            )
            
            # Extract image from response parts
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    image_bytes = part.inline_data.data
                    logger.info(f"✅ Image generated successfully ({len(image_bytes)/1024:.1f}KB)")
                    return image_bytes
            
            raise ValueError("No image generated in response")
                
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise
    
    def _enhance_prompt(self, prompt: str, negative_prompt: Optional[str] = None) -> str:
        """
        Enhance the prompt for better reference image generation.
        
        Args:
            prompt: Original user prompt
            negative_prompt: What to avoid
            
        Returns:
            Enhanced prompt optimized for product/object reference images
        """
        # Add context for better reference images
        enhanced = f"""High-quality product photography of {prompt}.
        
Style: Professional, clean background, studio lighting, high resolution.
View: Front-facing, centered, well-lit.
Quality: Sharp focus, detailed, photorealistic."""
        
        if negative_prompt:
            enhanced += f"\n\nAvoid: {negative_prompt}"
        
        return enhanced
    
    def save_image(
        self,
        image_bytes: bytes,
        output_path: Path,
        format: str = "png"
    ) -> Path:
        """
        Save generated image bytes to a file.
        
        Args:
            image_bytes: Raw image data
            output_path: Where to save the image
            format: Image format (png, jpg, webp)
            
        Returns:
            Path to saved image
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Ensure correct extension
        if not output_path.suffix:
            output_path = output_path.with_suffix(f".{format}")
        
        with open(output_path, 'wb') as f:
            f.write(image_bytes)
        
        logger.info(f"✅ Image saved: {output_path}")
        return output_path
    
    def generate_and_save(
        self,
        prompt: str,
        output_path: Path,
        aspect_ratio: str = "1:1",
        negative_prompt: Optional[str] = None
    ) -> Path:
        """
        Generate an image and save it to disk.
        
        Args:
            prompt: Description of the image to generate
            output_path: Where to save the image
            aspect_ratio: Image aspect ratio
            negative_prompt: What to avoid
            
        Returns:
            Path to saved image
        """
        image_bytes = self.generate_image(
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt
        )
        
        return self.save_image(image_bytes, output_path)
