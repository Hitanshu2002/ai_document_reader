# AI Document Reader Backend

An intelligent document Q&A API powered by Groq + LangChain RAG.

## Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure API Key

```bash
# Copy the example env file
copy .env.example .env

# Edit .env and add your Groq API key
# Get a FREE key at: https://console.groq.com
```

### 3. Run the Server

```bash
# From the backend/ directory
uvicorn app.main:app --reload --port 8000
```

The API will be available at: `http://localhost:8000`

API docs (Swagger UI): `http://localhost:8000/docs`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/upload` | Upload PDF/DOCX and create AI session |
| POST | `/chat` | Ask a question about the document |
| GET | `/session/{id}` | Get session info |
| DELETE | `/session/{id}` | Delete session |

## Features

- 📄 Supports PDF and DOCX files (up to 50MB)
- 🌍 Multilingual: Hindi + English + Sanskrit
- 🧮 LaTeX math formatting in responses
- 📚 Smart document type detection (research papers, exam papers, books, religious texts)
- 🔍 FAISS vector search with MMR for diverse retrieval
- 💬 Conversation memory (remembers last 10 exchanges)
