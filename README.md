# VidMod

Video object replacement pipeline - mask and replace objects in videos seamlessly.

## Features

- 🎬 **Video Frame Extraction** - FFmpeg-powered frame extraction
- 🎯 **Object Detection** - Text prompts or bounding box selection via SAM
- 🎨 **Inpainting** - Stable Diffusion powered object replacement
- 🔄 **Video Reconstruction** - Seamless video output with original audio

## Quick Start

### Prerequisites

- Python 3.10+
- FFmpeg installed and in PATH
- Replicate API key

### Installation

```bash
# Clone and enter directory
cd VidMod

# Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
copy .env.example .env
# Edit .env with your REPLICATE_API_TOKEN
```

### Run the Server

```bash
uvicorn app.main:app --reload
```

API available at `http://localhost:8000`

Docs at `http://localhost:8000/docs`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload video file |
| `/api/detect` | POST | Detect object with text/bbox |
| `/api/replace` | POST | Replace detected object |
| `/api/status/{job_id}` | GET | Check job status |
| `/api/download/{job_id}` | GET | Download result |

## Architecture

```
Video → Frames → SAM Detection → Mask → SD Inpainting → Frames → Video
```
