"""
AI Document Reader — FastAPI Backend
Main application entry point with all API endpoints including collaborative rooms.
"""
import asyncio
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from app.config import settings
from app.document_parser import parse_document
from app.rag_engine import ask_question, create_session, delete_session, get_session_info, clean_error_message
from app.rooms import room_manager, generate_username

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


def clean_error_message(err: str) -> str:
    """Convert raw API error strings into short user-friendly messages."""
    if "rate_limit" in err or "Rate limit" in err or "429" in err:
        wait_match = re.search(r'try again in ([\d]+m[\d.]+s|[\d.]+s|[\d]+ minute)', err)
        wait_str = f" Try again in {wait_match.group(1)}" if wait_match else ""
        return f"⏱️ Rate limit reached.{wait_str}"
    if "model_decommissioned" in err:
        return "❌ AI model unavailable. Contact support."
    if "authentication" in err or "401" in err or "403" in err:
        return "❌ API authentication failed. Check GROQ_API_KEY."
    if "Session" in err and "not found" in err:
        return "🔄 Session expired. Please re-upload your document."
    return "❌ Something went wrong. Please try again."


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    logger.info("🚀 AI Document Reader Backend starting...")
    if not settings.GROQ_API_KEY:
        logger.warning(
            "⚠️  GROQ_API_KEY is not set! "
            "Please create backend/.env with your Groq API key. "
            "Get one free at https://console.groq.com"
        )
    else:
        logger.info("✅ Groq API key detected.")

    # Pre-load embedding model to avoid first-request timeout/errors
    try:
        logger.info("📥 Pre-loading embedding model...")
        from app.rag_engine import get_embedding_model
        get_embedding_model()
        logger.info("✅ Embedding model pre-loaded successfully.")
    except Exception as e:
        logger.error(f"❌ Failed to pre-load embedding model: {e}", exc_info=True)

    yield
    logger.info("🛑 AI Document Reader Backend shutting down...")


app = FastAPI(
    title="AI Document Reader API",
    description="Intelligent document Q&A powered by Groq + LangChain",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex="https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ──────────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: str
    question: str
    language: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list
    session_id: str
    processing_time_ms: float


class UploadResponse(BaseModel):
    session_id: str
    filename: str
    file_type: str
    page_count: int
    word_count: int
    metadata: dict
    message: str


class SessionInfoResponse(BaseModel):
    session_id: str
    metadata: dict
    chunk_count: int


class CreateRoomRequest(BaseModel):
    host_name: Optional[str] = None


class CreateRoomResponse(BaseModel):
    room_code: str
    session_id: str
    host_id: str
    host_name: str
    filename: str
    file_type: str
    page_count: int
    word_count: int
    metadata: dict


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": settings.GROQ_MODEL,
        "embedding_model": settings.EMBEDDING_MODEL,
        "groq_key_configured": bool(settings.GROQ_API_KEY),
    }


@app.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a PDF or DOCX document and create an AI session.
    The document is processed in memory — no files are saved to disk.
    """
    filename = file.filename or "document"
    if not (filename.lower().endswith(".pdf") or
            filename.lower().endswith(".docx") or
            filename.lower().endswith(".doc")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload a PDF or DOCX file."
        )

    file_bytes = await file.read()

    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_FILE_SIZE_MB}MB."
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        logger.info(f"Parsing document: {filename} ({len(file_bytes)} bytes)")
        doc_data = parse_document(file_bytes, filename)

        logger.info(f"Creating RAG session for: {filename}")
        if not settings.GROQ_API_KEY:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Groq API key not configured. "
                    "Please add GROQ_API_KEY to backend/.env file. "
                    "Get a free key at https://console.groq.com"
                )
            )

        session_id = create_session(
            doc_text=doc_data["text"],
            doc_metadata={
                "filename": filename,
                "file_type": doc_data["file_type"],
                "page_count": doc_data["page_count"],
                "word_count": doc_data["word_count"],
                **doc_data.get("metadata", {}),
            },
            doc_pages=doc_data.get("pages", [])
        )

        return UploadResponse(
            session_id=session_id,
            filename=filename,
            file_type=doc_data["file_type"],
            page_count=doc_data["page_count"],
            word_count=doc_data["word_count"],
            metadata=doc_data.get("metadata", {}),
            message=f"Document processed successfully. Ready to answer questions!",
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing document {filename}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process document: {str(e)}"
        )


@app.post("/room/create", response_model=CreateRoomResponse)
async def create_room(
    file: UploadFile = File(...),
    host_name: Optional[str] = Form(None),
    host_id: Optional[str] = Form(None),
):
    """
    Upload a document and create a collaborative reading room.
    Returns room code for sharing with friends.
    """
    filename = file.filename or "document"
    if not (filename.lower().endswith(".pdf") or
            filename.lower().endswith(".docx") or
            filename.lower().endswith(".doc")):
        raise HTTPException(status_code=400, detail="Invalid file type.")

    file_bytes = await file.read()
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large. Max {settings.MAX_FILE_SIZE_MB}MB.")
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Groq API key not configured.")

    try:
        logger.info(f"Creating room for: {filename}")
        doc_data = parse_document(file_bytes, filename)

        session_id = create_session(
            doc_text=doc_data["text"],
            doc_metadata={
                "filename": filename,
                "file_type": doc_data["file_type"],
                "page_count": doc_data["page_count"],
                "word_count": doc_data["word_count"],
                **doc_data.get("metadata", {}),
            },
            doc_pages=doc_data.get("pages", [])
        )

        resolved_host_id = host_id or str(uuid.uuid4())
        resolved_host_name = host_name or generate_username()

        room = room_manager.create_room(
            session_id=session_id,
            file_bytes=file_bytes,
            filename=filename,
            file_type=doc_data["file_type"],
            host_id=resolved_host_id,
            host_name=resolved_host_name,
        )

        logger.info(f"Room {room.code} created by {resolved_host_name}")

        return CreateRoomResponse(
            room_code=room.code,
            session_id=session_id,
            host_id=resolved_host_id,
            host_name=resolved_host_name,
            filename=filename,
            file_type=doc_data["file_type"],
            page_count=doc_data["page_count"],
            word_count=doc_data["word_count"],
            metadata=doc_data.get("metadata", {}),
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating room: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create room: {str(e)}")


@app.get("/room/{code}")
async def get_room(code: str):
    """Get room info by code (existence check + metadata)."""
    room = room_manager.get_room(code.upper())
    if not room:
        raise HTTPException(status_code=404, detail=f"Room '{code}' not found.")
    return {
        **room.to_info(),
        "members": room.get_online_members(),
        "recent_messages": [m.to_dict() for m in room.messages[-30:]],
    }


@app.get("/room/{code}/file")
async def get_room_file(code: str):
    """Serve the room's document file bytes (for guests to load the PDF/DOCX viewer)."""
    room = room_manager.get_room(code.upper())
    if not room:
        raise HTTPException(status_code=404, detail=f"Room '{code}' not found.")

    content_type = (
        "application/pdf" if room.file_type == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=room.file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{room.filename}"'},
    )


@app.websocket("/ws/{code}/{user_id}")
async def room_websocket(websocket: WebSocket, code: str, user_id: str):
    """WebSocket endpoint for collaborative room group chat."""
    await websocket.accept()

    room = room_manager.get_room(code.upper())
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Get user name from query param (or generate)
    user_name = websocket.query_params.get("name", generate_username())

    member = room.add_member(user_id, user_name, websocket)

    # Notify room of new member
    join_event = {
        "type": "member_joined",
        "user_id": user_id,
        "user_name": user_name,
        "is_host": member.is_host,
        "members": room.get_online_members(),
    }
    await room.broadcast(join_event)
    # Also send the new member the recent history
    try:
        await websocket.send_text(json.dumps({
            "type": "history",
            "messages": [m.to_dict() for m in room.messages[-30:]],
            "members": room.get_online_members(),
            "session_id": room.session_id,
            "filename": room.filename,
            "file_type": room.file_type,
        }))
    except Exception:
        pass

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                continue

            msg_type = data.get("type", "chat")

            if msg_type == "chat":
                content = data.get("content", "").strip()
                if not content:
                    continue

                # Check for @chatai prefix
                if content.lower().startswith("@chatai "):
                    question = content[8:].strip()
                    if not question:
                        continue

                    # Store and broadcast user message immediately (non-blocking)
                    user_msg = room.add_message(user_id, user_name, content)
                    await room.broadcast({"type": "message", "message": user_msg.to_dict()})

                    # Run AI in a thread pool so the event loop stays free
                    try:
                        ai_result = await asyncio.to_thread(
                            ask_question,
                            room.session_id,
                            question,
                            data.get("language"),
                        )
                        ai_msg = room.add_message(
                            "chatai", "DocMind AI",
                            ai_result["answer"], is_ai=True
                        )
                        await room.broadcast({
                            "type": "message",
                            "message": ai_msg.to_dict(),
                            "sources": ai_result.get("sources", []),
                        })
                    except Exception as e:
                        err_text = clean_error_message(str(e))
                        err_msg = room.add_message("chatai", "DocMind AI", err_text, is_ai=True)
                        await room.broadcast({"type": "message", "message": err_msg.to_dict()})
                else:
                    # Regular group chat — broadcast immediately
                    msg = room.add_message(user_id, user_name, content)
                    await room.broadcast({"type": "message", "message": msg.to_dict()})

    except WebSocketDisconnect:
        room.remove_member(user_id)
        await room.broadcast({
            "type": "member_left",
            "user_id": user_id,
            "user_name": user_name,
            "members": room.get_online_members(),
        })


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Ask a question about the uploaded document."""
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if len(request.question) > 2000:
        raise HTTPException(
            status_code=400,
            detail="Question is too long. Please keep it under 2000 characters.",
        )

    start_time = time.time()

    try:
        result = ask_question(
            session_id=request.session_id,
            question=request.question.strip(),
            language=request.language,
        )

        processing_time = (time.time() - start_time) * 1000

        return ChatResponse(
            answer=result["answer"],
            sources=result.get("sources", []),
            session_id=request.session_id,
            processing_time_ms=round(processing_time, 2),
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        clean_err = clean_error_message(str(e))
        status_code = 429 if "rate limit" in clean_err.lower() else 500
        raise HTTPException(status_code=status_code, detail=clean_err)
    except Exception as e:
        logger.error(f"Chat error for session {request.session_id}: {e}", exc_info=True)
        clean_err = clean_error_message(str(e))
        status_code = 429 if "rate limit" in clean_err.lower() else 500
        raise HTTPException(
            status_code=status_code,
            detail=clean_err,
        )


@app.get("/session/{session_id}", response_model=SessionInfoResponse)
async def get_session(session_id: str):
    """Get information about an active session."""
    info = get_session_info(session_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    return info


@app.delete("/session/{session_id}")
async def delete_session_endpoint(session_id: str):
    """Delete a session and free associated memory."""
    deleted = delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    return {"message": f"Session {session_id} deleted successfully."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
