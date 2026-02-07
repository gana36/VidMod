# VidMod Deployment Guide

Deploy VidMod with **Cloud Run** (backend) + **Firebase Hosting** (frontend).

## Prerequisites

1. [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed
2. Firebase CLI: `npm install -g firebase-tools`
3. A GCP project with billing enabled

## Step 1: Deploy Backend to Cloud Run

```bash
# Login and set project
gcloud init
gcloud auth login

# Deploy from project root (builds Docker image automatically)
gcloud run deploy vidmod-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars \
    REPLICATE_API_TOKEN="your-replicate-token",\
    GEMINI_API_KEY="your-gemini-key",\
    RUNWAY_API_KEY="your-runway-key",\
    ELEVENLABS_API_KEY="your-elevenlabs-key",\
    FAL_KEY="your-fal-key",\
    ALLOWED_ORIGINS="https://YOUR-PROJECT.web.app,https://YOUR-PROJECT.firebaseapp.com,http://localhost:5173"
```

**Note your backend URL:** `https://vidmod-backend-xxx-uc.a.run.app`

## Step 2: Deploy Frontend to Firebase Hosting

```bash
# Login to Firebase
firebase login

# Initialize Firebase (from project root)
firebase init hosting
```

When prompted:
- **Public directory:** `frontend/dist`
- **Single-page app:** Yes
- **Automatic builds:** No
- **Overwrite index.html:** No

```bash
# Create production environment file
cd frontend
echo "VITE_API_URL=https://vidmod-backend-xxx-uc.a.run.app" > .env.production

# Build and deploy
npm run build
cd ..
firebase deploy --only hosting
```

**Frontend URL:** `https://YOUR-PROJECT.web.app`

## Step 3: Update CORS (if needed)

Redeploy backend with updated `ALLOWED_ORIGINS`:

```bash
gcloud run deploy vidmod-backend \
  --source . \
  --region us-central1 \
  --update-env-vars ALLOWED_ORIGINS="https://YOUR-PROJECT.web.app,https://YOUR-PROJECT.firebaseapp.com"
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `REPLICATE_API_TOKEN` | Yes | Replicate API key |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `RUNWAY_API_KEY` | Yes | Runway Gen-4 API key |
| `ELEVENLABS_API_KEY` | No | ElevenLabs voice dub |
| `FAL_KEY` | No | fal.ai API key |
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend URLs |

## Local Development

Backend:
```bash
uvicorn app.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm run dev
```
