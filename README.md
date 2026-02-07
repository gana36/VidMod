# VidMod

<div align="center">

![VidMod Banner](https://img.shields.io/badge/VIDMOD-AI%20Video%20Modification-7c3aed?style=for-the-badge&logoColor=white)

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

[![Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![Runway](https://img.shields.io/badge/RunwayML-Gen--4-000000?style=for-the-badge&logo=runway&logoColor=white)](https://runwayml.com/)
[![Replicate](https://img.shields.io/badge/Replicate-API-black?style=for-the-badge&logo=replicate&logoColor=white)](https://replicate.com/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

<br />

**Automated Video Compliance & Object Replacement Pipeline**

</div>

---

**VidMod** is an enterprise-grade video processing platform designed to automate the detection and remediation of compliance violations in video content. By orchestrating a suite of state-of-the-art AI models, VidMod allows users to seamlessly identify, track, and modify objects (e.g., brand logos, PII, unauthorized items) with frame-perfect accuracy.

Whether you need to blur a face, pixelate a license plate, or completely replace a coffee cup with a soda can using Generative AI, VidMod provides a unified, visual workflow to get the job done.

## 🌟 Key Features

### 🔍 Intelligent Analysis
- **Gemini 1.5 Pro Integration**: Utilizes Google's multimodal LLM to analyze video frames for complex compliance violations based on context, not just simple object detection.
- **Context-Aware Detection**: Can identify specific brands ("Starbucks cup"), behaviors, or safety violations.
- **Precise Timestamps**: Maps violations to exact start and end times in the video timeline.

### 🛠️ Advanced Modification Suite
- **Generative Replacement (Runway Gen-4)**:
  - Leverages RunwayML's Gen-4 model for high-fidelity **video-to-video** replacement.
  - **Smart Clipping**: Automatically detects short clips (<1s) and expands them to meet API requirements, ensuring valid generations every time.
  - **Text-Driven**: Simply describe what you want ("a blue ceramic mug"), and the AI generates it in place, preserving lighting and motion.
- **Reference-Based Replacement (Pika/VACE)**: Upload a reference image to guide the replacement style.
- **Standard Redaction**: classic **Blur** and **Pixelate** filters for privacy protection (Gaussian blur, mosaic).

### 🖥️ Modern Visual Interface
- **Batch Processing Dashboard**: Review all findings in a single list. Select multiple items, configure their actions (Blur, Pixelate, Replace), and process them all in one click.
- **Interactive Timeline**: Fine-tune the `Start Time` and `End Time` for every action.
- **Visual Feedback**: Real-time status updates, success notifications, and error handling.

---

## 🚀 How It Works

1.  **Ingest**:
    - User uploads a video file.
    - **Smart Upload**: Large files (>32MB) are uploaded directly to **Google Cloud Storage (GCS)** via Signed URLs, bypassing server limits.
    - System uses **FFmpeg** to extract representative frames at 1fps.

2.  **Analyze**:
    - Extracted frames are sent to **Gemini 1.5 Pro**.
    - Gemini analyzes frames against compliance rules and returns a structured JSON report identifying violations (object name, time range, confidence, reasoning).

3.  **Review & Plan**:
    - The **React UI** displays the "Remediation Plan".
    - User reviews findings. For each finding, the user can:
        - ✅ Accept it.
        - ✏️ Edit the prompt or timestamps.
        - 🗑️ Ignore it.
        - 🛠️ Choose an action: **Blur**, **Pixelate**, or **Runway Replace**.

4.  **Execute (Batch Processing)**:
    - User clicks **"PROCESS ALL FINDINGS"**.
    - The backend orchestrates the jobs:
        - **Local Operations**: Blurring/Pixelating uses local FFmpeg filters.
        - **Remote Operations**: Clips are cut, sent to Runway/Replicate APIs, processed, and downloaded.

5.  **Reconstruct**:
    - All modified segments are stitched back into the original video timeline.
    - Final video is re-encoded with the original audio track.

---

## ⚡ Performance Optimizations

VidMod includes several optimizations to reduce API costs and processing time:

### 🧠 Smart Caching
| Cache | What It Does | Savings |
|-------|--------------|---------|
| **Policy Cache** | Caches formatted compliance policies | Avoids re-parsing JSON on each analysis |
| **Prompt Simplification Cache** | Remembers simplified prompts (`"tobacco use"` → `"cigarette"`) | 1 Gemini API call per unique prompt |
| **Profanity Analysis Cache** | Stores audio analysis results in job state | Skips re-analysis when processing audio |

### 🔧 Singleton Engines
Engines are initialized once and reused across requests:
- `Sam3VideoEngine` - SAM3 video segmentation
- `AudioAnalyzer` - Gemini-powered audio analysis  
- `PromptSimplifier` - Gemini-powered prompt optimization
- `GeminiInpaintEngine` - Image/video inpainting

### 🧹 Automatic Cleanup
When uploading a new video, **all previous job files are automatically deleted** to save disk space:
- Extracted frames
- Generated masks
- Processed clips
- Intermediate outputs

> 💡 This keeps the `storage/jobs/` folder lean, especially when processing large videos.

## ⚡ Quick Start

### Prerequisites
*   **Python 3.10+**
*   **Node.js 18+** & npm
*   **FFmpeg**: Must be installed and available in your system's `PATH`.
    *   *Verify with `ffmpeg -version` in your terminal.*
*   **API Keys**:
    *   **Google AI Studio**: `GEMINI_API_KEY`
    *   **RunwayML**: `RUNWAY_API_KEY`
    *   **Replicate**: `REPLICATE_API_TOKEN`
    *   **ElevenLabs**: `ELEVENLABS_API_KEY`
*   **Google Cloud**:
    *   Service Account with `Service Account Token Creator` role (for Signed URLs)
    *   GCS Bucket for storage

### 1. Backend Setup
```bash
# Clone the repository
git clone https://github.com/gana36/VidMod.git
cd VidMod

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# ⚠️ Open .env and populate your API keys!
```

### 2. Frontend Setup
```bash
# Open a new terminal window
cd frontend

# Install Node dependencies
npm install

# Start the development server
npm run dev
```

### 3. Access the App
- Open your browser to `http://localhost:5173`.
- The backend API docs are available at `http://localhost:8000/docs`.

---

## ⚙️ Configuration (.env)

| Variable | Description | Required |
|----------|-------------|:--------:|

| `GEMINI_API_KEY` | Key for Google Gemini 1.5 Pro analysis | ✅ |
| `RUNWAY_API_KEY` | Key for RunwayML video generation | ✅ |
| `REPLICATE_API_TOKEN` | Key for Replicate (Pika/Flux/VACE) | ✅ |
| `FAL_KEY` | Key for fal.ai (Video Inpainting) | ✅ |
| `ELEVENLABS_API_KEY` | Key for ElevenLabs (Voice Dubbing) | ✅ |
| `HF_TOKEN` | HuggingFace Token (for SAM3) | ✅ |
| `GCS_BUCKET_NAME` | Google Cloud Storage Bucket Name | ✅ |
| `GCS_PROJECT_ID` | Google Cloud Project ID | ✅ |
| `UPLOAD_DIR` | Local directory for temp uploads (default: `./uploads`) | ❌ |

---

## 📂 Project Structure

```
VidMod/
├── app/
│   ├── main.py              # FastAPI entry point
│   ├── config.py            # Settings & Env handling
│   ├── routers/
│   │   └── video.py         # Main video processing endpoints
│   ├── services/
│   │   ├── analysis.py      # Gemini analysis logic
│   │   └── processing.py    # FFmpeg & Pipeline orchestration
│   └── utils/               # Helpers for S3, file handling
├── core/
│   ├── runway_engine.py     # Runway Gen-4 API wrapper
│   └── gcs_uploader.py      # Google Cloud Storage handler
├── frontend/
│   ├── src/
│   │   ├── components/      # React components (EditPlanPanel, ActionModal)
│   │   ├── services/        # API client
│   │   └── App.tsx          # Main UI layout
│   └── vite.config.ts
├── uploads/                 # Temporary storage for processing
├── requirements.txt         # Python dependencies
└── README.md
```

---

## 🔧 Troubleshooting

**"Asset duration must be at least 1 seconds" (Runway Error)**
> VidMod has **Smart Clipping** built-in. If your selected violation is less than 1 second (e.g., 0.5s), the backend automatically expands the clip range to meet the 1-second minimum requirement before sending it to Runway.

**FFmpeg not found**
> Ensure FFmpeg is added to your system environment variables. You should be able to type `ffmpeg` in any command prompt window.

**CORS Errors**
> If the frontend cannot talk to the backend, ensure the backend is running (`uvicorn app.main:app`) and that `CORSMiddleware` in `main.py` is configured to allow `localhost:5173`.

---

## 🤝 Contributing

Contributions are welcome! Please fork the repository and submit a Pull Request.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request
