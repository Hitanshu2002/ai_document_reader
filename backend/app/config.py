"""
Configuration settings for the AI Document Reader backend.
"""
import os
from dotenv import load_dotenv

load_dotenv(override=True)


class Settings:
    # Groq API
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Embedding model (free, multilingual, runs locally)
    EMBEDDING_MODEL: str = os.getenv(
        "EMBEDDING_MODEL",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # RAG settings
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    RETRIEVER_K: int = 4  # top-k chunks to retrieve

    # Max file size: 50MB
    MAX_FILE_SIZE_MB: int = 50

    # CORS
    ALLOWED_ORIGINS: list = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]


settings = Settings()
