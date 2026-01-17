"""
Gemini Inpaint Engine - Frame-by-frame image editing using Gemini 2.5 Flash Image.
Uses Nano Banana for object detection and replacement in individual frames.
Now with SAM mask support and optimized prompts.
"""

import logging
import os
import base64
from pathlib import Path
from typing import Optional, List
from PIL import Image
import io

logger = logging.getLogger(__name__)

# Gemini model for image editing (Nano Banana)
GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"

# Optimized prompts for better object replacement
MAIN_PROMPT_TEMPLATE = """Replace the masked object with the {replacement} from the reference image.
Match the lighting, color temperature, and perspective of the scene.
Keep the hand, fingers, shadows, reflections, and background exactly the same.
The {replacement} should appear naturally held in the same position as the original object.
Photorealistic, seamless blending, no artifacts."""

MAIN_PROMPT_NO_REF_TEMPLATE = """Replace the {object} with a {replacement}.
Match the lighting, color temperature, and perspective of the scene.
Keep the hand, fingers, shadows, reflections, and background exactly the same.
The {replacement} should appear naturally in the same position as the original object.
Photorealistic, seamless blending, no artifacts."""

NEGATIVE_PROMPT = """blurry, distorted hand, extra fingers, deformed bottle, wrong scale, 
floating object, changed background, mismatched lighting"""


class GeminiInpaintEngine:
    """
    Frame-by-frame image editing using Gemini 2.5 Flash Image (Nano Banana).
    Supports SAM masks, reference images, and optimized prompts.
    """
    
    def __init__(self, api_key: str = None):
        """
        Initialize Gemini Inpaint engine.
        
        Args:
            api_key: Gemini API key (or uses GEMINI_API_KEY env var)
        """
        from google import genai
        
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set")
        
        self.client = genai.Client(api_key=self.api_key)
        logger.info("Gemini Inpaint engine initialized")
    
    def _create_composite_image(
        self,
        frame: Image.Image,
        mask: Optional[Image.Image],
        reference: Optional[Image.Image]
    ) -> Image.Image:
        """
        Create a composite image with frame, mask, and reference side by side.
        Use this if model only supports single image input.
        
        Layout: [frame | mask | reference]
        """
        images = [frame]
        if mask:
            # Convert mask to RGB if needed
            if mask.mode != 'RGB':
                mask = mask.convert('RGB')
            images.append(mask)
        if reference:
            if reference.mode != 'RGB':
                reference = reference.convert('RGB')
            images.append(reference)
        
        # Calculate total width
        widths = [img.width for img in images]
        max_height = max(img.height for img in images)
        total_width = sum(widths)
        
        # Create composite
        composite = Image.new('RGB', (total_width, max_height))
        x_offset = 0
        for img in images:
            # Resize to match height if needed
            if img.height != max_height:
                ratio = max_height / img.height
                new_width = int(img.width * ratio)
                img = img.resize((new_width, max_height), Image.LANCZOS)
            composite.paste(img, (x_offset, 0))
            x_offset += img.width
        
        return composite
    
    def edit_frame_with_mask(
        self,
        frame_path: Path,
        mask_path: Optional[Path] = None,
        reference_path: Optional[Path] = None,
        object_prompt: str = "object",
        replacement_prompt: str = "replacement object",
        use_composite: bool = False
    ) -> Image.Image:
        """
        Edit a single frame with mask and reference image support.
        
        Args:
            frame_path: Path to the original frame
            mask_path: Path to the SAM mask (white = replace, black = keep)
            reference_path: Path to reference image of replacement object
            object_prompt: What object is being replaced
            replacement_prompt: What to replace it with
            use_composite: If True, stack images side-by-side for single-image models
            
        Returns:
            Edited PIL Image
        """
        from google.genai import types
        
        logger.info(f"Editing frame: {frame_path}")
        
        # Load images
        frame = Image.open(frame_path)
        mask = Image.open(mask_path) if mask_path and Path(mask_path).exists() else None
        reference = Image.open(reference_path) if reference_path and Path(reference_path).exists() else None
        
        # Build prompt
        if reference:
            prompt = MAIN_PROMPT_TEMPLATE.format(replacement=replacement_prompt)
        else:
            prompt = MAIN_PROMPT_NO_REF_TEMPLATE.format(
                object=object_prompt,
                replacement=replacement_prompt
            )
        
        logger.info(f"Prompt: {prompt[:100]}...")
        
        # Build content based on mode
        if use_composite:
            # Single image mode with composite
            composite = self._create_composite_image(frame, mask, reference)
            composite_prompt = f"""The image shows three parts side by side:
1. Left: the original frame to edit
2. Middle: the mask (white area = region to replace)
3. Right: the reference image of the replacement object

{prompt}

Edit ONLY the left frame. Use the middle mask to know what to replace.
Use the right image as reference for the replacement object."""
            
            contents = [composite_prompt, composite]
        else:
            # Multi-image mode
            contents = [prompt, frame]
            
            if mask:
                contents.append(mask)
                contents[0] = f"The second image is a mask where white indicates the region to replace. {contents[0]}"
            
            if reference:
                contents.append(reference)
                contents[0] = f"{contents[0]} Use the reference image to match the appearance of the replacement object."
        
        try:
            # Call Gemini API
            response = self.client.models.generate_content(
                model=GEMINI_IMAGE_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"]
                )
            )
            
            # Check response
            if not response.candidates:
                logger.warning("No candidates in response, returning original")
                return frame
            
            candidate = response.candidates[0]
            if not candidate.content or not candidate.content.parts:
                logger.warning("No parts in response, returning original")
                return frame
            
            # Extract generated image
            for part in candidate.content.parts:
                if hasattr(part, 'inline_data') and part.inline_data is not None:
                    image_data = part.inline_data.data
                    image_bytes = base64.b64decode(image_data) if isinstance(image_data, str) else image_data
                    return Image.open(io.BytesIO(image_bytes))
            
            logger.warning("No image in response, returning original")
            return frame
            
        except Exception as e:
            logger.error(f"Gemini image editing failed: {e}")
            raise
    
    def edit_frame(
        self,
        image_path: Path,
        edit_prompt: str,
        reference_image_path: Optional[Path] = None
    ) -> Image.Image:
        """
        Legacy method for backward compatibility.
        """
        return self.edit_frame_with_mask(
            frame_path=image_path,
            reference_path=reference_image_path,
            replacement_prompt=edit_prompt
        )
    
    def process_frames_with_masks(
        self,
        frame_paths: List[Path],
        mask_paths: List[Path],
        reference_image_path: Path,
        object_prompt: str = "object",
        replacement_prompt: str = "bottle",
        frame_interval: int = 1,
        output_dir: Optional[Path] = None,
        use_composite: bool = False,
        progress_callback=None
    ) -> List[Path]:
        """
        Process multiple frames with corresponding masks and a reference image.
        
        Args:
            frame_paths: List of paths to original frames
            mask_paths: List of paths to SAM masks (same order as frames)
            reference_image_path: Path to reference image for replacement
            object_prompt: What object is being replaced
            replacement_prompt: What to replace it with
            frame_interval: Process every Nth frame
            output_dir: Directory to save edited frames
            use_composite: Use composite image mode
            progress_callback: Progress callback function
            
        Returns:
            List of paths to edited frames
        """
        if output_dir is None:
            output_dir = frame_paths[0].parent / "edited_frames_v2"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        total_frames = len(frame_paths)
        keyframe_indices = list(range(0, total_frames, frame_interval))
        
        logger.info(f"Processing {len(keyframe_indices)} keyframes with masks")
        
        edited_frames = {}
        output_paths = []
        
        # Process keyframes
        for i, idx in enumerate(keyframe_indices):
            frame_path = frame_paths[idx]
            mask_path = mask_paths[idx] if idx < len(mask_paths) else None
            output_path = output_dir / f"frame_{idx:06d}.png"
            
            try:
                edited_image = self.edit_frame_with_mask(
                    frame_path=frame_path,
                    mask_path=mask_path,
                    reference_path=reference_image_path,
                    object_prompt=object_prompt,
                    replacement_prompt=replacement_prompt,
                    use_composite=use_composite
                )
                
                edited_image.save(output_path)
                edited_frames[idx] = output_path
                
                logger.info(f"Edited keyframe {i+1}/{len(keyframe_indices)}")
                
            except Exception as e:
                logger.warning(f"Failed to edit frame {idx}: {e}, copying original")
                Image.open(frame_path).save(output_path)
                edited_frames[idx] = output_path
            
            if progress_callback:
                progress = (i + 1) / len(keyframe_indices) * 100
                progress_callback(progress, f"Editing frame {i+1}/{len(keyframe_indices)}")
        
        # Fill in non-keyframes
        for idx in range(total_frames):
            output_path = output_dir / f"frame_{idx:06d}.png"
            
            if idx in edited_frames:
                output_paths.append(edited_frames[idx])
            else:
                nearest_keyframe = min(keyframe_indices, key=lambda k: abs(k - idx))
                nearest_path = edited_frames[nearest_keyframe]
                Image.open(nearest_path).save(output_path)
                output_paths.append(output_path)
        
        logger.info(f"Processed {total_frames} frames ({len(keyframe_indices)} edited)")
        return output_paths
    
    def process_frames(
        self,
        frame_paths: List[Path],
        object_prompt: str,
        replacement_prompt: str,
        reference_image_path: Optional[Path] = None,
        frame_interval: int = 1,
        output_dir: Optional[Path] = None,
        progress_callback=None
    ) -> List[Path]:
        """
        Legacy method - process multiple frames with object replacement.
        """
        if output_dir is None:
            output_dir = frame_paths[0].parent / "edited_frames"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        total_frames = len(frame_paths)
        keyframe_indices = list(range(0, total_frames, frame_interval))
        
        logger.info(f"Processing {len(keyframe_indices)} keyframes out of {total_frames} total")
        
        # Build the edit prompt with optimized template
        if reference_image_path:
            edit_prompt = MAIN_PROMPT_TEMPLATE.format(replacement=replacement_prompt)
        else:
            edit_prompt = MAIN_PROMPT_NO_REF_TEMPLATE.format(
                object=object_prompt,
                replacement=replacement_prompt
            )
        
        edited_frames = {}
        output_paths = []
        
        # Process keyframes
        for i, idx in enumerate(keyframe_indices):
            frame_path = frame_paths[idx]
            output_path = output_dir / f"frame_{idx:06d}.png"
            
            try:
                edited_image = self.edit_frame(
                    image_path=frame_path,
                    edit_prompt=edit_prompt,
                    reference_image_path=reference_image_path
                )
                
                edited_image.save(output_path)
                edited_frames[idx] = output_path
                
                logger.info(f"Edited keyframe {i+1}/{len(keyframe_indices)}: {output_path}")
                
            except Exception as e:
                logger.warning(f"Failed to edit frame {idx}: {e}, copying original")
                Image.open(frame_path).save(output_path)
                edited_frames[idx] = output_path
            
            if progress_callback:
                progress = (i + 1) / len(keyframe_indices) * 100
                progress_callback(progress, f"Editing frame {i+1}/{len(keyframe_indices)}")
        
        # Fill in non-keyframes by copying from nearest keyframe
        for idx in range(total_frames):
            output_path = output_dir / f"frame_{idx:06d}.png"
            
            if idx in edited_frames:
                output_paths.append(edited_frames[idx])
            else:
                nearest_keyframe = min(keyframe_indices, key=lambda k: abs(k - idx))
                nearest_path = edited_frames[nearest_keyframe]
                Image.open(nearest_path).save(output_path)
                output_paths.append(output_path)
        
        logger.info(f"Processed {total_frames} frames ({len(keyframe_indices)} edited)")
        return output_paths
