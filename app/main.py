"""
VidMod FastAPI Application
Main entry point for the video modification API.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import video

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    logger.info("Starting VidMod API...")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"FFmpeg path: {settings.get_ffmpeg_path()}")
    logger.info(f"FFprobe path: {settings.get_ffprobe_path()}")
    
    # Ensure storage directories exist
    settings.upload_path
    settings.frames_path
    settings.output_path
    
    yield
    
    logger.info("Shutting down VidMod API...")


# Create FastAPI app
app = FastAPI(
    title="VidMod API",
    description="Video Object Replacement Pipeline - Mask and replace objects in videos seamlessly",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware (allow frontend origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Include routers
app.include_router(video.router)


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "VidMod API",
        "version": "1.0.0",
        "description": "Video Object Replacement Pipeline",
        "docs": "/docs",
        "endpoints": {
            "upload": "POST /api/upload",
            "detect": "POST /api/detect",
            "replace": "POST /api/replace",
            "segment_video": "POST /api/segment-video (coordinates)",
            "segment_video_text": "POST /api/segment-video-text (Replicate)",
            "segment_video_sam3": "POST /api/segment-video-sam3 (SAM3 text→mask)",
            "replace_object": "POST /api/replace-object (Wan 2.1 inpainting) ⭐",
            "status": "GET /api/status/{job_id}",
            "download": "GET /api/download/{job_id}",
            "download_segmented": "GET /api/download-segmented/{job_id}"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    ffmpeg_path = settings.get_ffmpeg_path()
    import os
    return {
        "status": "healthy",
        "replicate_configured": bool(settings.replicate_api_token),
        "gemini_configured": bool(settings.gemini_api_key),
        "ffmpeg_path": ffmpeg_path,
        "ffmpeg_exists": os.path.exists(ffmpeg_path) if ffmpeg_path != "ffmpeg" else "in PATH"
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
