import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/test-inference", tags=["Test Inference"])

INFERENCE_URL = "https://opencode.ai/inference/openai/v1/chat/completions"

FREE_MODELS = [
    "big-pickle",
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "hy3-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
    "laguna-s-2.1-free",
]

@router.get("/models")
async def list_free_models():
    """List free models available on the OpenCode inference API."""
    return {"free_models": FREE_MODELS}

@router.get("/opencode")
async def test_opencode_inference(
    message: str = "HI",
    model: str = "big-pickle",
):
    """Test endpoint that calls the OpenCode inference API and returns the response.

    Free models are callable without an auth header. Only the free models listed
    in FREE_MODELS are accepted.
    """
    if model not in FREE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model}' is not allowed. Available free models: {FREE_MODELS}",
        )
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                INFERENCE_URL,
                headers={"Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "user", "content": message}
                    ],
                },
            )
            response.raise_for_status()
            data = response.json()
            return {
                "status": "ok",
                "model": model,
                "content": data["choices"][0]["message"]["content"],
            }
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"OpenCode inference failed: {e}")
    except (httpx.HTTPError, KeyError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"Error calling OpenCode inference: {str(e)}")