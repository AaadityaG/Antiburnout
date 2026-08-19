from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import verify_token
from db import db, chat_history_db
from services.encryption import decrypt_api_key
from services.agent_runner import run_agent
from datetime import datetime
from logger import get_logger
from routers.test_inference import FREE_MODELS

logger = get_logger("chat")

router = APIRouter(prefix="/chat", tags=["Chat"])


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    conversation_history: Optional[List[Message]] = []
    model_key: Optional[str] = None
    session_id: Optional[str] = None
    brightness: Optional[int] = None
    volume: Optional[int] = None
    local_hour: Optional[int] = None


class ChatResponse(BaseModel):
    response: str
    model: str
    provider: str
    session_id: str
    recommendations: Optional[List[dict]] = []
    tools_used: Optional[List[str]] = []
    token_usage: Optional[dict] = None
    model_config_info: Optional[dict] = None


@router.post("/send", response_model=ChatResponse)
async def send_message(token: str, request: ChatRequest):
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        user = db.get_user_by_id(user_id)

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        ai_providers = user.get("ai_providers", {})

        use_opencode_free = False
        base_url = None

        # Free OpenCode inference models — no stored key needed, no auth header
        if request.model_key and request.model_key.startswith("free_"):
            model_id = request.model_key[len("free_"):]
            if model_id not in FREE_MODELS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{model_id}' is not an allowed free model. Available free models: {FREE_MODELS}",
                )
            provider_key = "opencode_free"
            model = model_id
            api_key = ""
            use_opencode_free = True
        else:
            if not ai_providers:
                raise HTTPException(
                    status_code=400,
                    detail="No AI provider configured. Please add one in Profile Settings.",
                )

            provider_key = request.model_key or list(ai_providers.keys())[0]
            if provider_key not in ai_providers:
                raise HTTPException(
                    status_code=400,
                    detail=f"Model '{provider_key}' not found. Please select a valid model.",
                )

            provider_config = ai_providers[provider_key]
            device_id = user.get("device_id", "")
            api_key = decrypt_api_key(provider_config["api_key"], device_id)
            model = provider_config["model"]

        print(f"[Chat] Provider: {provider_key}, Model: {model}, Key starts: {api_key[:12] if api_key else 'n/a'}...")
        logger.info(
            "Chat request received",
            user_id=user_id,
            model=model,
            provider=provider_key,
            has_conversation_history=bool(request.conversation_history),
        )

        system_metrics = {}
        if request.brightness is not None:
            system_metrics["brightness"] = request.brightness
        if request.volume is not None:
            system_metrics["volume"] = request.volume
        if request.local_hour is not None:
            system_metrics["local_hour"] = request.local_hour

        ai_response, recommendations, tools_used, token_usage = await run_agent(
            api_key=api_key,
            model=model,
            user=user,
            system_metrics=system_metrics,
            message=request.message,
            conversation_history=request.conversation_history,
            base_url=base_url,
            use_opencode_free=use_opencode_free,
        )

        session_id = ""
        try:
            if request.session_id:
                chat_history_db.add_message_to_session(
                    user_id=user_id,
                    session_id=request.session_id,
                    message=request.message,
                    response=ai_response,
                    model=model,
                    provider_key=provider_key,
                )
                session_id = request.session_id
            else:
                session_doc = chat_history_db.create_session(
                    user_id=user_id,
                    first_message=request.message,
                    first_response=ai_response,
                    model=model,
                    provider_key=provider_key,
                )
                session_id = session_doc["id"]
        except Exception as e:
            logger.warning("Failed to save chat history", user_id=user_id, session_id=session_id, error=str(e))

        # Store conversation in vector DB for semantic search.
        # This is separate from the structured chat_history_db —
        # vector DB enables "find similar conversations" while
        # structured DB enables "list all sessions" and "get session messages".
        try:
            from rag.vector_store import get_user_collection, chunk_text
            from datetime import datetime as _dt
            collection = get_user_collection(user_id)

            # Combine user message and AI response into one document
            doc_text = f"User: {request.message}\nAI: {ai_response}"
            timestamp = _dt.utcnow().isoformat()

            # Create a unique base ID for this conversation turn.
            # Each chunk will get: {base_id}_c0, {base_id}_c1, etc.
            base_id = f"{session_id}_{_dt.utcnow().strftime('%Y%m%d%H%M%S%f')}"

            # Split long text into overlapping chunks (short text stays as one piece)
            chunks = chunk_text(doc_text)

            # Batch all chunks for a single add_texts call (more efficient)
            texts_to_add = []
            ids_to_add = []
            metadatas_to_add = []

            for i, chunk in enumerate(chunks):
                texts_to_add.append(chunk)
                ids_to_add.append(f"{base_id}_c{i}")
                metadatas_to_add.append({
                    "user_id": user_id,
                    "session_id": session_id,
                    "timestamp": timestamp,
                    "tools_used": ",".join(tools_used) if tools_used else "",
                    # Chunk reconstruction metadata — used by search to
                    # reassemble all chunks from the same parent document
                    "chunk_index": i,           # position of this chunk (0, 1, 2...)
                    "total_chunks": len(chunks), # total chunks in this document
                    "parent_id": base_id,        # links all chunks to same parent
                })

            collection.add_texts(
                texts=texts_to_add,
                ids=ids_to_add,
                metadatas=metadatas_to_add,
            )
        except Exception as e:
            # Non-blocking: if vector DB fails, chat still works,
            # just semantic search won't find this conversation
            logger.warning("Failed to store in vector DB", user_id=user_id, session_id=session_id, error=str(e))

        # Model configuration info exposed to frontend for display.
        # These values match what's hardcoded in agent/graph.py.
        model_config_info = {
            "max_tokens": 500,
            "temperature": 0.7,
            "context_window": 4096,  # approximate for most OpenRouter models
        }

        return ChatResponse(
            response=ai_response,
            model=model,
            provider="opencode_free" if use_opencode_free else "openrouter",
            session_id=session_id,
            recommendations=recommendations,
            tools_used=tools_used,
            token_usage=token_usage if token_usage else None,
            model_config_info=model_config_info,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Chat endpoint failed", user_id=user_id if 'user_id' in locals() else None, error_type=type(e).__name__, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")
