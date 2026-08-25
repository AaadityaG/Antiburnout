from fastapi import APIRouter
from config.llm_providers import list_providers_for_frontend

router = APIRouter(prefix="/llm", tags=["LLM"])


@router.get("/models")
async def get_available_models():
    """Return all providers and their models for the frontend UI."""
    return {"providers": list_providers_for_frontend()}
