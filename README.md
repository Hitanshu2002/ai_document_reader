# AI Document Reader — Groq API Setup Guide

## Getting Your Free Groq API Key

1. Visit **https://console.groq.com/**
2. Sign up for a free account
3. Go to **API Keys** section
4. Click **Create API Key**
5. Copy the key

## Setting Up the Backend

```bash
# Navigate to backend directory
cd backend

# Copy environment template
copy .env.example .env

# Edit .env file and paste your Groq API key:
# GROQ_API_KEY=gsk_...your_key_here...
```

## Running the Application

### Option 1: Run Both (Recommended)

Open two terminal windows:

**Terminal 1 — Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Then open: **http://localhost:5173**

### Verify Backend is Running

Open: **http://localhost:8000/health**

You should see:
```json
{
  "status": "healthy",
  "groq_key_configured": true,
  ...
}
```

## First Use

1. Open **http://localhost:5173**
2. Upload a PDF or DOCX file (drag & drop or click)
3. Wait for processing (30-60 seconds for first run — embedding model downloads)
4. Click **"Ask DocMind"** button
5. Ask any question about your document!

## Voice Features

- **Voice Input**: Click the microphone 🎤 button and speak your question
- **Language**: Toggle **EN/हि** to switch between English and Hindi
- **Voice Output**: Click the **Speak** button on any AI response to hear it

> **Note**: Voice features work best in **Google Chrome** or Chromium-based browsers.

## Supported Document Types

| Type | Examples | AI Capabilities |
|------|---------|-----------------|
| Research Papers | Academic PDFs, arXiv papers | Extract citations, explain methods, cite accuracy |
| Exam Papers | Math, Physics question papers | Solve step-by-step, explain topics, alternative methods |
| Books | Novels, textbooks | Chapter summaries, concept explanations |
| Religious Texts | Bhagavad Gita, Upanishads | Sanskrit transliteration, shloka explanation |
| Theory Docs | Notes, reports | Summarize, explain, Q&A |

## Troubleshooting

**"Groq API key not configured"**: Add your key to `backend/.env`

**"Could not extract text"**: Your PDF might be a scanned image. Use a text-based PDF.

**Voice not working**: Use Chrome browser. Allow microphone access when prompted.

**First upload is slow**: The embedding model (`paraphrase-multilingual-MiniLM-L12-v2`) downloads on first run (~120MB). Subsequent uploads are fast.
