from fastapi import APIRouter, HTTPException
from services.llm_service import get_llm
from config.llm_providers import list_providers_for_frontend
from langchain_core.messages import HumanMessage

router = APIRouter(prefix="/test-inference", tags=["Test Inference"])


@router.get("/opencode")
async def test_inference(
    message: str = "HI",
    provider: str = "",
    model: str = "",
):
    """Test endpoint that calls the first available LLM provider."""
    available = list_providers_for_frontend()
    if not available:
        raise HTTPException(status_code=400, detail="No LLM providers configured in backend/.env.")

    # Use specified or first available
    provider_key = provider or available[0]["key"]
    provider_info = next((p for p in available if p["key"] == provider_key), None)
    if not provider_info:
        raise HTTPException(status_code=400, detail=f"Provider '{provider_key}' not available (no API key in .env).")

    model_id = model or provider_info["default_model"]

    try:
        llm = get_llm(provider_key, model_id)
        response = await llm.ainvoke([HumanMessage(content=message)])
        return {
            "status": "ok",
            "provider": provider_key,
            "model": model_id,
            "content": response.content,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM inference failed: {str(e)}")
