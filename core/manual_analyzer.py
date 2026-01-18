"""
Gemini Manual Analyzer - Analyze specific regions of a video frame for identification and remediation suggestions.
"""

import logging
import os
import json
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

# Gemini model for image analysis
GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp"

MANUAL_ANALYSIS_PROMPT = """You are an object detection assistant. Identify the primary object or subject within the provided image crop.

## Your Task:
1. Precisely identify WHAT is the main object in this image (e.g., "Coca-Cola bottle", "Apple logo", "Man's face", "Television").
2. Suggest the most appropriate remediation actions for this item in a video context (blur, replace, or mute).

## Response Requirements:
Return a JSON object with:
- "item_name": Short, descriptive name of the object.
- "reasoning": A single sentence description of the object.
- "confidence": "High", "Medium", or "Low".
- "suggested_actions": A list of potential actions for this object. Use these IDs and types consistently:
    - {"id": "blur_action", "type": "blur", "label": "Blur [Item Name]", "description": "Obscure the [Item Name] using a blur effect."}
    - {"id": "replace_action", "type": "replace", "label": "Replace [Item Name]", "description": "Replace the [Item Name] with AI generated content."}
    - {"id": "mute_action", "type": "mute", "label": "Mute [Item Name]", "description": "Silence audio associated with this item."}

Return ONLY the JSON."""

class ManualAnalyzer:
    """Analyze patches of a video frame using Gemini."""
    
    def __init__(self, api_key: str = None):
        from google import genai
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set")
        self.client = genai.Client(api_key=self.api_key)
        logger.info("Manual Analyzer initialized")

    def analyze_region(self, frame_path: Path, box: Dict[str, float]) -> Dict[str, Any]:
        """
        Analyze a specific box in a frame by cropping it first.
        """
        from google.genai import types
        import PIL.Image

        if not frame_path.exists():
            raise FileNotFoundError(f"Frame not found: {frame_path}")

        image = PIL.Image.open(frame_path)
        width, height = image.size

        # Convert normalized coordinates to pixel coordinates
        left = box['x1'] * width
        top = box['y1'] * height
        right = box['x2'] * width
        bottom = box['y2'] * height

        # Ensure valid crop boundaries
        left = max(0, min(left, width - 1))
        top = max(0, min(top, height - 1))
        right = max(left + 1, min(right, width))
        bottom = max(top + 1, min(bottom, height))

        # Crop the image to focus Gemini on exactly what the user selected
        cropped_image = image.crop((left, top, right, bottom))
        
        # Save a temporary crop for debugging (optional but helpful)
        # cropped_image.save(frame_path.parent / f"crop_{os.path.basename(frame_path)}")

        try:
            response = self.client.models.generate_content(
                model=GEMINI_IMAGE_MODEL,
                contents=[
                    MANUAL_ANALYSIS_PROMPT,
                    cropped_image
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            
            if response.text:
                # Clean the response text if it has markdown blocks
                text = response.text.strip()
                if text.startswith("```json"):
                    text = text[7:-3].strip()
                elif text.startswith("```"):
                    text = text[3:-3].strip()
                
                result = json.loads(text)
                return result
            else:
                raise ValueError("Empty response from Gemini")

        except Exception as e:
            logger.error(f"Gemini manual analysis failed: {e}")
            raise
