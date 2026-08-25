from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from auth import verify_token
from db import db, chat_history_db
from services.encryption import decrypt_api_key
from services.agent_runner import run_agent
from datetime import datetime
from logger import get_logger
from config.llm_providers import get_provider, list_providers_for_frontend

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
    thinking_steps: Optional[List[dict]] = []


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

        # Resolve provider + model from the model_key
        provider_key, model = _resolve_model(request.model_key, user)

        # Try stored key first, fall back to env vars in llm_service
        api_key = ""
        ai_providers = user.get("ai_providers", {})
        if provider_key in ai_providers:
            device_id = user.get("device_id", "")
            api_key = decrypt_api_key(ai_providers[provider_key]["api_key"], device_id)

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

        ai_response, recommendations, tools_used, token_usage, thinking_steps = await run_agent(
            provider_key=provider_key,
            model=model,
            api_key=api_key,
            user=user,
            system_metrics=system_metrics,
            message=request.message,
            conversation_history=request.conversation_history,
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
        try:
            from rag.vector_store import get_user_collection, chunk_text
            from datetime import datetime as _dt
            collection = get_user_collection(user_id)

            doc_text = f"User: {request.message}\nAI: {ai_response}"
            timestamp = _dt.utcnow().isoformat()

            base_id = f"{session_id}_{_dt.utcnow().strftime('%Y%m%d%H%M%S%f')}"
            chunks = chunk_text(doc_text)

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
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "parent_id": base_id,
                })

            collection.add_texts(
                texts=texts_to_add,
                ids=ids_to_add,
                metadatas=metadatas_to_add,
            )
        except Exception as e:
            logger.warning("Failed to store in vector DB", user_id=user_id, session_id=session_id, error=str(e))

        model_config_info = {
            "max_tokens": 500,
            "temperature": 0.7,
            "context_window": 4096,
        }

        return ChatResponse(
            response=ai_response,
            model=model,
            provider=provider_key,
            session_id=session_id,
            recommendations=recommendations,
            tools_used=tools_used,
            token_usage=token_usage if token_usage else None,
            model_config_info=model_config_info,
            thinking_steps=thinking_steps,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Chat endpoint failed", user_id=user_id if 'user_id' in locals() else None, error_type=type(e).__name__, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")


def _resolve_model(model_key: str | None, user: dict) -> tuple[str, str]:
    """Parse model_key into (provider_key, model_id).

    Accepted formats:
      - "openrouter:<model>"    → openrouter, model
      - "gemini:<model>"        → openrouter, google/<model> (migrated)
      - None                    → first available provider's default model
    """
    if not model_key:
        # No model selected — use first provider with a configured key
        available = list_providers_for_frontend()
        if available:
            return available[0]["key"], available[0]["default_model"]
        raise HTTPException(status_code=400, detail="No LLM providers configured. Add an API key to backend/.env.")

    # Explicit provider prefix (e.g. "openrouter:gpt-4o-mini")
    if ":" in model_key:
        provider_key, model_id = model_key.split(":", 1)
        get_provider(provider_key)  # validate it exists
        return provider_key, model_id

    raise HTTPException(status_code=400, detail=f"Invalid model_key format: '{model_key}'. Use 'provider:model'.")


@router.post("/stream")
async def stream_message(token: str, request: ChatRequest):
    """SSE streaming endpoint — yields thinking steps live, then final response."""
    import json

    payload = verify_token(token)
    user_id = payload.get("sub")
    user = db.get_user_by_id(user_id)

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    provider_key, model = _resolve_model(request.model_key, user)

    api_key = ""
    ai_providers = user.get("ai_providers", {})
    if provider_key in ai_providers:
        device_id = user.get("device_id", "")
        api_key = decrypt_api_key(ai_providers[provider_key]["api_key"], device_id)

    system_metrics = {}
    if request.brightness is not None:
        system_metrics["brightness"] = request.brightness
    if request.volume is not None:
        system_metrics["volume"] = request.volume
    if request.local_hour is not None:
        system_metrics["local_hour"] = request.local_hour

    async def event_generator():
        from langchain_core.messages import AIMessage, ToolMessage, HumanMessage, SystemMessage
        from services.llm_service import get_llm
        from agent.graph import create_agent_graph, build_system_prompt
        from config.llm_providers import provider_supports_tools

        system_prompt = build_system_prompt(user, system_metrics if system_metrics else None)
        tools_supported = provider_supports_tools(provider_key)
        if not tools_supported:
            system_prompt += "\n\nIMPORTANT: You cannot execute actions or call tools. You can only provide information, advice, and guidance."

        initial_messages = [{"role": "system", "content": system_prompt}]
        for msg in (request.conversation_history or [])[-10:]:
            initial_messages.append({"role": msg.role, "content": msg.content})
        initial_messages.append({"role": "user", "content": request.message})

        llm = get_llm(provider_key, model, api_key)
        graph = create_agent_graph(
            llm=llm,
            user=user,
            system_metrics=system_metrics if system_metrics else None,
            provider_key=provider_key,
        )

        try:
            async for chunk in graph.astream(
                {"messages": initial_messages},
                config={"recursion_limit": 10},
                stream_mode="updates",
            ):
                for node_name, update in chunk.items():
                    if node_name == "agent":
                        for msg in update.get("messages", []):
                            if isinstance(msg, AIMessage) and msg.tool_calls:
                                for tc in msg.tool_calls:
                                    name = tc.get("name", "")
                                    args = tc.get("args", {})
                                    args_str = ", ".join(f"{k}={v!r}" for k, v in args.items()) if isinstance(args, dict) else ""
                                    yield f"data: {json.dumps({'type': 'tool_call', 'tool': name, 'args': args_str})}\n\n"
                            if isinstance(msg, AIMessage) and msg.content:
                                content = msg.content
                                if isinstance(content, list):
                                    content = " ".join(
                                        part.get("text", "") if isinstance(part, dict) else str(part)
                                        for part in content
                                    )
                                # This is the final response — send it last
                                yield f"data: {json.dumps({'type': 'response', 'content': content})}\n\n"
                    elif node_name == "tools":
                        for msg in update.get("messages", []):
                            if isinstance(msg, ToolMessage):
                                from services.agent_runner import _build_tool_summary
                                name = getattr(msg, "name", "")
                                content = msg.content
                                if isinstance(content, str):
                                    try:
                                        content = json.loads(content)
                                    except Exception:
                                        pass
                                summary = _build_tool_summary(name, content)
                                yield f"data: {json.dumps({'type': 'tool_result', 'tool': name, 'summary': summary})}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            logger.error("Streaming agent failed", error=str(e))
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
