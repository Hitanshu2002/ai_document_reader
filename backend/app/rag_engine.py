"""
RAG Engine — LangChain + FAISS + Groq pipeline (LCEL-based).
Uses modern LangChain Expression Language for compatibility with LangChain 0.3+/1.x.
Handles multilingual Q&A (Hindi/English/Sanskrit) with intelligent document understanding.
"""
import logging
import uuid
from typing import Optional
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from langchain.schema import Document

from app.config import settings

logger = logging.getLogger(__name__)

# Global session store: session_id -> {retriever, llm, history, metadata, chunk_count}
_sessions: dict = {}

# Lazy-loaded embedding model (singleton)
_embedding_model: Optional[HuggingFaceEmbeddings] = None


def get_embedding_model() -> HuggingFaceEmbeddings:
    """Get or create the singleton embedding model."""
    global _embedding_model
    if _embedding_model is None:
        logger.info(f"Loading embedding model: {settings.EMBEDDING_MODEL}")
        _embedding_model = HuggingFaceEmbeddings(
            model_name=settings.EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        logger.info("Embedding model loaded successfully.")
    return _embedding_model


SYSTEM_TEMPLATE = """You are DocMind, an extraordinarily intelligent, verified, context-aware AI document expert.

## STEP 1 — DOCUMENT DOMAIN ANALYSIS (do this mentally before answering)
Look at the document context and classify the domain:
- 💼 RESUME/CV → Act as Senior Executive Recruiter. Focus on STAR metrics, skills, career path. Tone: Constructive.
- 📚 BOOKS/LITERATURE → Act as Literature Scholar. Cover plot, themes, motifs. Tone: Analytical, engaging.
- 🛿 HOLY/RELIGIOUS → Act as Theological Scholar. Transliterate, translate, explain metaphysics. Tone: Reverent.
- 🔬 RESEARCH PAPER → Act as Principal Scientist. Analyze methodology, math, limitations. Tone: Precise.
- ✏️ EXAM PAPER → Act as Expert Tutor. Step-by-step LaTeX math solution. Tone: Clear, pedagogical.
- 🏢 GENERAL → Act as Senior Domain Specialist.

## STEP 2 — EXTRACT ANSWER FROM CONTEXT
Search the document context carefully. The context is organized by page like "[Passage N | Page X]".
- If the user asks about a specific question number or page, search ALL context passages for content matching that description.
- For scanned/image-based pages, the OCR text may contain the question inline. Look carefully.
- If you find the content: answer it COMPLETELY with full step-by-step working.
- If you genuinely cannot find it in context: say "This content was not found in the retrieved document passages" and then use your expert knowledge to answer based on the topic.

## STEP 3 — SELF-VERIFICATION (MANDATORY before responding)
After forming your answer, internally verify:
1. Does my answer match what is in the document context?
2. Is my math/logic correct? Re-check calculations.
3. Is my answer complete and detailed enough?
Only then write your final response.

🚨 MANDATORY FORMATTING RULES (NON-NEGOTIABLE):
1. **LaTeX MATH**: Use `$ ... $` for inline math, `$$ ... $$` for block equations. NEVER write raw math symbols.
2. **RICH STRUCTURE**: Use `### Headings`, numbered lists, bullet points, **bold** terms. No plain walls of text.
3. **COMPLETENESS**: Never give lazy short answers. Be thorough, detailed, and educational.
4. **LANGUAGE**: If [RESPOND IN HINDI ONLY] prefix present, reply 100% in Hindi. Otherwise 100% in English.

## SPECIAL CAPABILITIES:
- **Math Problems**: Full step-by-step LaTeX working, verify independently, suggest alternatives.
- **Sanskrit Shlokas**: Devanagari → Romanized → Word-by-word meaning → Translation → Philosophy.
- **Resume Analysis**: Scorecard format with improvement suggestions.
- **Summaries**: Domain-expert structured summary matching the document type.

## DOCUMENT CONTEXT (from this specific document):
{context}

> **Note on scanned documents**: If a page says "[OCR Error...]" or is blank, it means that page could not be read. Still try to answer based on available pages and your knowledge of the subject.
"""


def _format_docs(docs: list) -> str:
    """Format retrieved documents into context string."""
    parts = []
    for i, doc in enumerate(docs):
        page = doc.metadata.get("page_number", "?")
        parts.append(f"[Passage {i+1} | Page {page}]\n{doc.page_content}")
    return "\n\n---\n\n".join(parts)


def classify_document(doc_text: str, filename: str, llm) -> dict:
    """Classify the document's type, topic, and key themes using the LLM."""
    try:
        sample_text = doc_text[:4000]  # Use first 4000 chars for analysis
        prompt_text = f"""Analyze the following document sample (Filename: {filename}) and classify it.
Provide your analysis in a clean JSON format with these exact keys:
- "doc_type": One of [Resume/CV, Religious Text/Holy Scripture, Research Paper, Exam/Quiz, Book/Literature, General Business/Technical]
- "doc_topic": A specific title or topic of the document (e.g. "Srimad Bhagavad Gita", "Software Engineer Resume", etc.)
- "doc_summary": A concise 2-sentence summary of the document contents.
- "doc_key_themes": A list of 3-5 key themes or areas covered.

DOCUMENT SAMPLE:
{sample_text}

JSON RESPONSE ONLY (no markdown blocks, no prefix, no suffix):"""
        
        response = llm.invoke(prompt_text)
        response_text = response.content.strip()
        
        # Strip markdown code blocks if any
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        import json
        analysis = json.loads(response_text)
        logger.info(f"Classified document: {analysis}")
        return analysis
    except Exception as e:
        logger.error(f"Error classifying document: {e}")
        # Return fallback classification
        return {
            "doc_type": "General Business/Technical",
            "doc_topic": filename,
            "doc_summary": "An uploaded document containing text information.",
            "doc_key_themes": ["General Information"]
        }


def create_session(doc_text: str, doc_metadata: dict, doc_pages: list = None) -> str:
    """
    Create a new RAG session for a document.
    Returns session_id.
    """
    session_id = str(uuid.uuid4())
    logger.info(f"Creating RAG session: {session_id}")

    # Split text into chunks
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.CHUNK_SIZE,
        chunk_overlap=settings.CHUNK_OVERLAP,
        separators=["\n\n", "\n", "।", ".", "!", "?", " ", ""],
    )

    # Create Document objects with metadata
    documents = []
    chunk_idx = 0
    if doc_pages:
        for page in doc_pages:
            page_num = page["page_number"]
            page_text = page["text"] or ""
            if not page_text.strip():
                page_text = f"[Empty page content for Page {page_num}]"

            page_chunks = splitter.split_text(page_text)
            for chunk in page_chunks:
                documents.append(Document(
                    page_content=chunk,
                    metadata={
                        **doc_metadata,
                        "page_number": page_num,
                        "chunk_index": chunk_idx
                    }
                ))
                chunk_idx += 1
    else:
        # Fallback to splitting doc_text as a single string
        chunks = splitter.split_text(doc_text)
        for chunk in chunks:
            documents.append(Document(
                page_content=chunk,
                metadata={
                    **doc_metadata,
                    "chunk_index": chunk_idx
                }
            ))
            chunk_idx += 1

    logger.info(f"Created {len(documents)} chunks from document")

    # Build FAISS vector store
    embeddings = get_embedding_model()
    vectorstore = FAISS.from_documents(documents, embeddings)

    # Create retriever with MMR for diversity
    retriever = vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": settings.RETRIEVER_K, "fetch_k": 12}
    )

    # Create Groq LLM
    llm = ChatGroq(
        groq_api_key=settings.GROQ_API_KEY,
        model_name=settings.GROQ_MODEL,
        temperature=0.1,
        max_tokens=4096,
    )

    # Classify document
    analysis = classify_document(doc_text, doc_metadata.get("filename", "document"), llm)
    doc_metadata["analysis"] = analysis

    # Store session data — retriever, llm, and chat history
    _sessions[session_id] = {
        "retriever": retriever,
        "llm": llm,
        "history": [],  # List of (human, ai) message tuples
        "metadata": doc_metadata,
        "chunk_count": len(documents),
    }

    logger.info(f"Session {session_id} created with {len(documents)} chunks")
    return session_id


def ask_question(session_id: str, question: str, language: Optional[str] = None) -> dict:
    """
    Ask a question to the RAG chain for a session.
    Uses LCEL (LangChain Expression Language) for compatibility.
    Returns answer and source information.
    """
    if session_id not in _sessions:
        raise ValueError(f"Session {session_id} not found. Please upload a document first.")

    session = _sessions[session_id]
    retriever = session["retriever"]
    llm = session["llm"]
    history = session["history"]

    logger.info(f"Session {session_id}: Question: {question[:80]}... Requested Language: {language}")

    try:
        # Determine target language (explicit request or fallback to auto-detection)
        target_lang = language
        if not target_lang:
            target_lang = _detect_language_hint(question)

        augmented_question = question
        if target_lang == "hi" or target_lang.startswith("hi"):
            augmented_question = f"[RESPOND IN HINDI ONLY - यह प्रश्न हिंदी में है, हिंदी में उत्तर दें] {question}"
        else:
            augmented_question = f"[RESPOND IN ENGLISH ONLY - This question is in English, respond in English] {question}"

        # 1. Parse question for explicit page numbers AND question numbers
        import re
        page_matches = re.findall(r'(?:page|p\.|p\b|pg\.?|\bpg\b|पन्ना|पृष्ठ)\s*(\d+)', question, re.IGNORECASE)
        # Also detect "question 1", "Q.1", "Q1", "no. 1" patterns to boost page retrieval
        q_num_matches = re.findall(r'(?:question|q\.?|q\b|no\.|number|\bq\b)\s*(\d+)', question, re.IGNORECASE)
        forced_pages = []
        if page_matches:
            for match in page_matches:
                try:
                    forced_pages.append(int(match))
                except Exception:
                    pass

        # 2. Retrieve standard semantic chunks
        retrieved_docs = retriever.invoke(augmented_question)

        # 3. If specific pages were requested, force retrieval of chunks from those pages
        if forced_pages:
            try:
                page_docs = []
                for page_num in forced_pages:
                    logger.info(f"Page metadata filter triggered: forcing retrieval for page {page_num}")
                    docs_for_page = retriever.vectorstore.similarity_search(
                        augmented_question,
                        k=6,  # Get more chunks per page for better coverage
                        filter={"page_number": page_num}
                    )
                    page_docs.extend(docs_for_page)
                    # Also pull neighbouring pages for context
                    for neighbor in [page_num - 1, page_num + 1]:
                        if neighbor > 0:
                            try:
                                neighbor_docs = retriever.vectorstore.similarity_search(
                                    augmented_question, k=2,
                                    filter={"page_number": neighbor}
                                )
                                page_docs.extend(neighbor_docs)
                            except Exception:
                                pass

                # Merge retrieved chunks and keep unique ones, prioritising page-specific ones
                seen = set()
                merged = []
                for doc in page_docs + retrieved_docs:  # page_docs first = higher priority
                    h = hash(doc.page_content)
                    if h not in seen:
                        seen.add(h)
                        merged.append(doc)
                retrieved_docs = merged[:settings.RETRIEVER_K + 4]  # Allow extra chunks for page-specific queries
            except Exception as e:
                logger.error(f"Page metadata filter failed: {e}")
        elif q_num_matches:
            # No page specified but question number mentioned — do a broader semantic search
            logger.info(f"Question number detected ({q_num_matches}), expanding retrieval k")
            try:
                extra_docs = retriever.vectorstore.similarity_search(augmented_question, k=8)
                seen = set()
                merged = []
                for doc in extra_docs + retrieved_docs:
                    h = hash(doc.page_content)
                    if h not in seen:
                        seen.add(h)
                        merged.append(doc)
                retrieved_docs = merged[:settings.RETRIEVER_K + 4]
            except Exception as e:
                logger.error(f"Extended question search failed: {e}")

        context_str = _format_docs(retrieved_docs)

        # Build message history for the prompt
        history_messages = []
        for human_msg, ai_msg in history[-5:]:  # Last 5 exchanges
            history_messages.append(HumanMessage(content=human_msg))
            history_messages.append(AIMessage(content=ai_msg))

        # Extract classification info
        analysis = session["metadata"].get("analysis", {})
        doc_type = analysis.get("doc_type", "General Business/Technical")
        doc_topic = analysis.get("doc_topic", session["metadata"].get("filename", "Unknown Document"))
        doc_summary = analysis.get("doc_summary", "An uploaded document containing text information.")
        doc_themes = ", ".join(analysis.get("doc_key_themes", ["General Information"]))

        # Build the prompt
        from langchain_core.prompts import MessagesPlaceholder
        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_TEMPLATE),
            MessagesPlaceholder(variable_name="history"),
            ("human", "{question}"),
        ])

        # Build and run the chain
        chain = prompt | llm | StrOutputParser()

        answer = chain.invoke({
            "context": context_str,
            "question": augmented_question,
            "history": history_messages,
        })


        # Update history
        history.append((question, answer))
        # Keep only last 10 exchanges
        if len(history) > 10:
            history.pop(0)
        session["history"] = history

        # Extract source references
        sources = []
        seen_chunks = set()
        for doc in retrieved_docs:
            chunk_idx = doc.metadata.get("chunk_index", -1)
            if chunk_idx not in seen_chunks:
                seen_chunks.add(chunk_idx)
                sources.append({
                    "chunk_index": chunk_idx,
                    "page": doc.metadata.get("page_number", "?"),
                    "excerpt": doc.page_content[:150] + "...",
                })

        return {
            "answer": answer,
            "sources": sources[:3],
            "session_id": session_id,
        }

    except Exception as e:
        logger.error(f"Error in RAG chain for session {session_id}: {e}", exc_info=True)
        raise RuntimeError(f"Error generating answer: {str(e)}")


def delete_session(session_id: str) -> bool:
    """Delete a session and free memory."""
    if session_id in _sessions:
        del _sessions[session_id]
        logger.info(f"Session {session_id} deleted")
        return True
    return False


def _detect_language_hint(text: str) -> str:
    """
    Detect if text is in Hindi. Returns 'hi' for Hindi, 'en' for English.
    """
    # First check for Devanagari Unicode range (fastest)
    for char in text:
        if '\u0900' <= char <= '\u097F':
            return "hi"

    # Then try langdetect
    try:
        from langdetect import detect
        lang = detect(text)
        return lang
    except Exception:
        return "en"


def get_session_info(session_id: str) -> Optional[dict]:
    """Get metadata about a session."""
    if session_id not in _sessions:
        return None
    session = _sessions[session_id]
    return {
        "session_id": session_id,
        "metadata": session["metadata"],
        "chunk_count": session["chunk_count"],
    }


def clean_error_message(err_str: str) -> str:
    """
    Clean raw error messages (especially Groq rate limits) to show a simple limit reached message.
    """
    import re
    # Check for Groq-style rate limit text: e.g. "try again in 1m23.4s" or "try again in 23.4s" or "try again in 15s"
    wait_match = re.search(r'try again in ([\d\w\.\-]+)', err_str, re.IGNORECASE)
    if wait_match:
        return f"⏱️ Rate limit reached. Try again in {wait_match.group(1)}."
    
    # Standard rate limit text
    if "rate_limit_exceeded" in err_str or "rate limit" in err_str.lower():
        return "⏱️ Rate limit reached. Please try again shortly."
        
    return f"❌ AI error: {err_str}"

