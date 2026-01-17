"""Test script to reproduce the blur error"""
import sys
sys.path.insert(0, r'C:\Users\saiga\OneDrive\Documents\Hackathons\VidMod')

from pathlib import Path
from core.frame_extractor import FrameExtractor

# Test if extract_clip method exists and works
extractor = FrameExtractor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe")

print("FrameExtractor created successfully")
print(f"Has extract_clip method: {hasattr(extractor, 'extract_clip')}")

# Check method signature
if hasattr(extractor, 'extract_clip'):
    import inspect
    sig = inspect.signature(extractor.extract_clip)
    print(f"extract_clip signature: {sig}")
