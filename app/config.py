"""
VidMod Configuration Module
Handles environment variables and application settings.
"""

import os
import glob
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache


def find_ffmpeg_path() -> str:
    """Auto-detect FFmpeg path, especially for Windows winget installation."""
    # First check if ffmpeg is in PATH
    import shutil
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    
    # Windows: Check winget installation location
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        # Search for ffmpeg in winget packages
        for ffmpeg_exe in winget_path.rglob("ffmpeg.exe"):
            return str(ffmpeg_exe)
    
    # Fallback common Windows locations
    common_paths = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
    ]
    for path in common_paths:
        if Path(path).exists():
            return path
    
    # Return default and hope for the best
    return "ffmpeg"


def find_ffprobe_path() -> str:
    """Auto-detect FFprobe path."""
    import shutil
    
    # First check if ffprobe is in PATH
    if shutil.which("ffprobe"):
        return "ffprobe"
    
    # Windows: Check winget installation location
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        # Search for ffprobe in winget packages
        for ffprobe_exe in winget_path.rglob("ffprobe.exe"):
            return str(ffprobe_exe)
    
    # Get ffmpeg path and look for ffprobe in same directory
    ffmpeg_path = find_ffmpeg_path()
    if ffmpeg_path != "ffmpeg":
        ffmpeg_dir = Path(ffmpeg_path).parent
        ffprobe_path = ffmpeg_dir / "ffprobe.exe"
        if ffprobe_path.exists():
            return str(ffprobe_path)
    
    return "ffprobe"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # API Keys
    replicate_api_token: str = ""
    hf_token: str = ""  # HuggingFace token for SAM3
    gemini_api_key: str = ""  # Gemini API key for Nano Banana image editing
    fal_key: str = ""  # fal.ai API key for VACE video inpainting
    runway_api_key: str = ""  # Runway API key for direct Gen-4 API
    elevenlabs_api_key: str = ""  # ElevenLabs API key for voice dubbing
    
    # CORS Configuration (comma-separated list of allowed origins)
    allowed_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,https://vidmod-2026.web.app,https://vidmod-2026.firebaseapp.com"
    
    # Google Cloud Storage Configuration
    gcs_bucket_name: str = ""
    gcs_project_id: str = "vidmod-2025"  # Default project ID, can be overridden by env var
    
    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    
    # FFmpeg paths (auto-detected if not set)
    ffmpeg_path: str = ""
    ffprobe_path: str = ""
    
    # Processing Configuration
    frames_per_second: int = 30
    keyframe_interval: int = 5  # Process every Nth frame for detection
    max_video_duration_seconds: int = 30
    
    # Storage paths
    upload_dir: str = "storage/uploads"
    frames_dir: str = "storage/frames"
    output_dir: str = "storage/output"
    
    # Base directory (project root)
    base_dir: Path = Path(__file__).parent.parent
    
    def get_ffmpeg_path(self) -> str:
        """Get FFmpeg path, auto-detecting if not configured."""
        if self.ffmpeg_path:
            return self.ffmpeg_path
        return find_ffmpeg_path()
    
    def get_ffprobe_path(self) -> str:
        """Get FFprobe path, auto-detecting if not configured."""
        if self.ffprobe_path:
            return self.ffprobe_path
        return find_ffprobe_path()
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    @property
    def upload_path(self) -> Path:
        path = self.base_dir / self.upload_dir
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    @property
    def frames_path(self) -> Path:
        path = self.base_dir / self.frames_dir
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    @property
    def output_path(self) -> Path:
        path = self.base_dir / self.output_dir
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
