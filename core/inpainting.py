"""
VidMod Inpainting Module
Object replacement using Stable Diffusion Inpainting via Replicate.
"""

import replicate
import base64
import httpx
from pathlib import Path
from PIL import Image
import io
import logging
from typing import Optional, List
import numpy as np

logger = logging.getLogger(__name__)


class InpaintingEngine:
    """
    Inpainting and object replacement using Stable Diffusion via Replicate.
    Supports both text prompts and reference images.
    """
    
    # Replicate model for inpainting
    SDXL_INPAINT_MODEL = "stability-ai/stable-diffusion-inpainting:95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3"
    SD_INPAINT_MODEL = "andreasjansson/stable-diffusion-inpainting:e490d072a34a94a11e9711ed5a6ba621c3fab884eda1665d9d3a282d65a21571"
    
    def __init__(self, api_token: str):
        """Initialize with Replicate API token."""
        if not api_token:
            raise ValueError("Replicate API token is required")
        self.client = replicate.Client(api_token=api_token)
    
    def _image_to_base64_uri(self, image_path: Path) -> str:
        """Convert image file to base64 data URI."""
        with open(image_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        
        suffix = image_path.suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp"
        }
        mime_type = mime_types.get(suffix, "image/png")
        
        return f"data:{mime_type};base64,{data}"
    
    def _download_image(self, url: str, output_path: Path) -> Path:
        """Download image from URL."""
        response = httpx.get(url, follow_redirects=True)
        response.raise_for_status()
        
        with open(output_path, "wb") as f:
            f.write(response.content)
        
        return output_path
    
    def _prepare_mask(self, mask_path: Path, target_size: tuple) -> Path:
        """
        Prepare mask for inpainting - ensure it's binary and correct size.
        White = inpaint area, Black = keep area.
        """
        with Image.open(mask_path) as mask:
            # Convert to grayscale
            mask = mask.convert("L")
            
            # Resize if needed
            if mask.size != target_size:
                mask = mask.resize(target_size, Image.LANCZOS)
            
            # Ensure binary (threshold at 128)
            mask_arr = np.array(mask)
            mask_arr = (mask_arr > 128).astype(np.uint8) * 255
            
            # Save processed mask
            processed_path = mask_path.parent / f"processed_{mask_path.name}"
            Image.fromarray(mask_arr).save(processed_path)
            
            return processed_path
    
    def inpaint_with_text(
        self,
        image_path: Path,
        mask_path: Path,
        prompt: str,
        output_path: Path,
        negative_prompt: str = "blurry, low quality, distorted, watermark",
        guidance_scale: float = 7.5,
        num_inference_steps: int = 25,
        seed: Optional[int] = None
    ) -> Path:
        """
        Inpaint masked region with text-described content.
        
        Args:
            image_path: Path to original image
            mask_path: Path to mask (white = replace, black = keep)
            prompt: Text description of what to put in masked area
            output_path: Path to save result
            negative_prompt: What to avoid in generation
            guidance_scale: How closely to follow the prompt (1-20)
            num_inference_steps: Number of denoising steps
            seed: Random seed for reproducibility
            
        Returns:
            Path to inpainted image
        """
        logger.info(f"Inpainting with prompt: '{prompt}'")
        
        # Get original image size
        with Image.open(image_path) as img:
            target_size = img.size
        
        # Prepare inputs
        image_uri = self._image_to_base64_uri(image_path)
        processed_mask = self._prepare_mask(mask_path, target_size)
        mask_uri = self._image_to_base64_uri(processed_mask)
        
        input_params = {
            "image": image_uri,
            "mask": mask_uri,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "guidance_scale": guidance_scale,
            "num_inference_steps": num_inference_steps,
        }
        
        if seed is not None:
            input_params["seed"] = seed
        
        try:
            output = self.client.run(
                self.SD_INPAINT_MODEL,
                input=input_params
            )
            
            # Handle output format
            if isinstance(output, list) and len(output) > 0:
                result_url = str(output[0])
            else:
                result_url = str(output)
            
            result_path = self._download_image(result_url, output_path)
            
            # Cleanup processed mask
            if processed_mask.exists():
                processed_mask.unlink()
            
            return result_path
            
        except Exception as e:
            logger.error(f"Inpainting failed: {e}")
            raise RuntimeError(f"Inpainting failed: {e}")
    
    def inpaint_with_reference(
        self,
        image_path: Path,
        mask_path: Path,
        reference_image_base64: str,
        prompt: str,
        output_path: Path,
        guidance_scale: float = 7.5,
        seed: Optional[int] = None
    ) -> Path:
        """
        Inpaint using a reference image for style/content guidance.
        
        Note: This uses the text prompt along with a description of the reference.
        For true image-to-image transfer, a different model might be needed.
        """
        # For now, we enhance the prompt with reference context
        enhanced_prompt = f"{prompt}, matching the style and appearance of the reference"
        
        return self.inpaint_with_text(
            image_path=image_path,
            mask_path=mask_path,
            prompt=enhanced_prompt,
            output_path=output_path,
            guidance_scale=guidance_scale,
            seed=seed
        )
    
    def inpaint_frames(
        self,
        frame_paths: List[Path],
        mask_paths: List[Path],
        prompt: str,
        output_dir: Path,
        seed: int = 42
    ) -> List[Path]:
        """
        Inpaint multiple frames with consistent seed for temporal coherence.
        
        Args:
            frame_paths: List of original frame paths
            mask_paths: List of corresponding mask paths
            prompt: Replacement prompt
            output_dir: Directory to save inpainted frames
            seed: Fixed seed for consistency across frames
            
        Returns:
            List of inpainted frame paths
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        inpainted_frames = []
        
        logger.info(f"Inpainting {len(frame_paths)} frames with prompt: '{prompt}'")
        
        for i, (frame_path, mask_path) in enumerate(zip(frame_paths, mask_paths)):
            output_path = output_dir / f"frame_{i:06d}.png"
            
            if mask_path is None or not mask_path.exists():
                # No mask - copy original frame
                import shutil
                shutil.copy(frame_path, output_path)
                inpainted_frames.append(output_path)
                continue
            
            try:
                self.inpaint_with_text(
                    image_path=frame_path,
                    mask_path=mask_path,
                    prompt=prompt,
                    output_path=output_path,
                    seed=seed  # Same seed for consistency
                )
                inpainted_frames.append(output_path)
                logger.info(f"Inpainted frame {i+1}/{len(frame_paths)}")
                
            except Exception as e:
                logger.warning(f"Failed to inpaint frame {i}: {e}")
                # Fall back to original frame
                import shutil
                shutil.copy(frame_path, output_path)
                inpainted_frames.append(output_path)
        
        return inpainted_frames
