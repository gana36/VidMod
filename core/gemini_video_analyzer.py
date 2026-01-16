"""
Gemini Video Analyzer - Analyze videos for compliance violations using Gemini 2.5 Pro.
Uses native video understanding to detect objects, actions, and violations.
"""

import logging
import os
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# Gemini model for video analysis (native video support)
GEMINI_VIDEO_MODEL = "gemini-3-flash-preview"


# JSON Schema for structured output matching frontend Finding type
VIDEO_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "description": "Type of finding (e.g., 'Brand Identification', 'Restricted Content')"},
                    "category": {"type": "string", "enum": ["alcohol", "logo", "violence", "language", "other"]},
                    "content": {"type": "string", "description": "Brief description of what was detected"},
                    "status": {"type": "string", "enum": ["warning", "critical"]},
                    "confidence": {"type": "string", "enum": ["Low", "Medium", "High"]},
                    "startTime": {"type": "number", "description": "Start time in seconds"},
                    "endTime": {"type": "number", "description": "End time in seconds"},
                    "context": {"type": "string", "description": "Explain what happened and why it matters for compliance"},
                    "suggestedAction": {"type": "string", "description": "Recommended remediation action"},
                    "box": {
                        "type": "object",
                        "properties": {
                            "top": {"type": "number", "description": "Top position as percentage (0-100)"},
                            "left": {"type": "number", "description": "Left position as percentage (0-100)"},
                            "width": {"type": "number", "description": "Width as percentage (0-100)"},
                            "height": {"type": "number", "description": "Height as percentage (0-100)"}
                        },
                        "required": ["top", "left", "width", "height"]
                    }
                },
                "required": ["type", "category", "content", "status", "confidence", "startTime", "endTime", "context", "suggestedAction"]
            }
        },
        "summary": {"type": "string", "description": "Overall summary of the video analysis"},
        "riskLevel": {"type": "string", "enum": ["Low", "Moderate", "High", "Critical"]},
        "predictedAgeRating": {"type": "string", "description": "Predicted age rating (e.g., 'U', '12+', '18+')"}
    },
    "required": ["findings", "summary", "riskLevel", "predictedAgeRating"]
}


ANALYSIS_PROMPT = """You are a video compliance analyzer. Analyze this video to identify content that may require moderation or editing for platform compliance.

## Your Task:
Identify and report any instances of:
1. **Alcohol/Substances**: Beer, wine, liquor, cigarettes, vaping, drugs
2. **Brand Logos**: Unauthorized brand exposure, product placements  
3. **Violence**: Fighting, weapons, aggressive behavior
4. **Language**: Profanity, hate speech, explicit content
5. **Other**: Sensitive content, copyright issues, inappropriate gestures

## IMPORTANT INSTRUCTIONS:
- Focus on ACTIONS not just object presence (e.g., "person drinking beer" vs "beer bottle visible")
- Track WHEN violations occur with precise timestamps
- Estimate bounding box positions (top/left/width/height as percentages)
- Assign appropriate severity: 'critical' for major violations, 'warning' for minor/potential issues
- Provide context explaining WHY this is a compliance concern
- Suggest appropriate remediation actions (blur, mute, cut, replace)

## Response Requirements:
- Return findings sorted by startTime (earliest first)
- Each finding must have precise start/end times
- Include bounding boxes when objects are visually identifiable
- Provide actionable suggested remediation for each finding

If no compliance issues are found, return an empty findings array with an appropriate summary.

Analyze the video now and return structured JSON."""


class GeminiVideoAnalyzer:
    """
    Analyze videos for compliance violations using Gemini 2.5 Pro.
    Uses native video understanding - no frame extraction needed.
    """
    
    def __init__(self, api_key: str = None):
        """
        Initialize Gemini Video Analyzer.
        
        Args:
            api_key: Gemini API key (or uses GEMINI_API_KEY env var)
        """
        from google import genai
        
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set")
        
        self.client = genai.Client(api_key=self.api_key)
        logger.info("Gemini Video Analyzer initialized")
    
    def analyze(self, video_path: str | Path) -> Dict[str, Any]:
        """
        Analyze a video for compliance violations.
        
        Args:
            video_path: Path to the video file
            
        Returns:
            Dict containing findings, summary, riskLevel, predictedAgeRating
        """
        from google.genai import types
        
        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        logger.info(f"Analyzing video with Gemini: {video_path}")
        
        # Upload video to Gemini
        logger.info("Uploading video to Gemini...")
        video_file = self.client.files.upload(file=video_path)
        
        # Wait for video processing
        logger.info(f"Video uploaded: {video_file.name}, waiting for processing...")
        while video_file.state.name == "PROCESSING":
            time.sleep(2)
            video_file = self.client.files.get(name=video_file.name)
        
        if video_file.state.name == "FAILED":
            raise RuntimeError(f"Video processing failed: {video_file.state}")
        
        logger.info(f"Video ready for analysis: {video_file.uri}")
        
        try:
            # Call Gemini API with video and structured output
            response = self.client.models.generate_content(
                model=GEMINI_VIDEO_MODEL,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_uri(
                                file_uri=video_file.uri,
                                mime_type=video_file.mime_type
                            ),
                            types.Part.from_text(text=ANALYSIS_PROMPT)
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=VIDEO_ANALYSIS_SCHEMA
                )
            )
            
            # Parse response
            import json
            if response.text:
                result = json.loads(response.text)
                logger.info(f"Analysis complete: {len(result.get('findings', []))} findings, risk level: {result.get('riskLevel')}")
                return result
            else:
                logger.warning("Empty response from Gemini")
                return self._empty_response()
                
        except Exception as e:
            logger.error(f"Gemini API call failed: {e}")
            raise
        finally:
            # Clean up uploaded file
            try:
                self.client.files.delete(name=video_file.name)
                logger.info(f"Cleaned up uploaded video: {video_file.name}")
            except Exception as e:
                logger.warning(f"Failed to delete uploaded video: {e}")
    
    def _empty_response(self) -> Dict[str, Any]:
        """Return an empty response structure."""
        return {
            "findings": [],
            "summary": "No compliance issues detected.",
            "riskLevel": "Low",
            "predictedAgeRating": "U"
        }


def analyzeVideoWithGemini(
    videoFilePath: str | Path,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Analyze a video for compliance violations using Gemini 2.5 Pro.
    
    This is the main entry point function for video analysis.
    
    Args:
        videoFilePath: Path to the video file to analyze
        api_key: Optional Gemini API key (uses GEMINI_API_KEY env var if not provided)
        
    Returns:
        Dict containing:
        - findings: List of compliance findings with type, category, timing, etc.
        - summary: Overall summary of the analysis
        - riskLevel: Low, Moderate, High, or Critical
        - predictedAgeRating: Suggested age rating (U, 12+, 18+, etc.)
        
    Example:
        >>> result = analyzeVideoWithGemini("/path/to/video.mp4")
        >>> print(f"Risk Level: {result['riskLevel']}")
        >>> for finding in result["findings"]:
        ...     print(f"{finding['startTime']}s: {finding['content']}")
    """
    analyzer = GeminiVideoAnalyzer(api_key=api_key)
    return analyzer.analyze(videoFilePath)
