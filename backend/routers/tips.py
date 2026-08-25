from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from auth import verify_token
from db import db
from services.encryption import decrypt_api_key
from langchain_core.messages import SystemMessage, HumanMessage
from datetime import datetime

router = APIRouter(prefix="/tips", tags=["Break Tips"])

class TipRequest(BaseModel):
    break_number: Optional[int] = 1
    time_of_day: Optional[str] = None
    focus_area: Optional[str] = None

class TipResponse(BaseModel):
    tip: str
    category: str
    duration: str
    instruction: str


def build_tip_system_prompt(request: TipRequest, user: dict) -> str:
    time_context = ""
    if request.time_of_day:
        time_context = f"\n- Current time of day: {request.time_of_day}"

    break_context = ""
    if request.break_number:
        break_context = f"\n- This is break number {request.break_number} today"

    focus_context = ""
    if request.focus_area:
        focus_context = f"\n- User wants to focus on: {request.focus_area}"

    return f"""You are an expert wellness coach specializing in preventing burnout, eye strain, and stress for desk workers.

Generate ONE specific, actionable tip for a break activity. The tip should help reduce:
- Eye strain and tension from screen time
- Stress and mental fatigue
- Physical tension from sitting
- Overall burnout prevention

Requirements:
1. Make it SPECIFIC and ACTIONABLE (not generic advice)
2. Keep the instruction VERY SHORT (1-2 sentences max, under 50 words)
3. Make it different each time - variety is crucial
4. Focus on techniques that can be done at a desk or nearby
5. Base recommendations on scientific evidence
6. Make it engaging and encouraging

Context:
- User has been using AntiBurnout app
- They're taking a scheduled break{time_context}{break_context}{focus_context}

Categories to rotate through:
- eyes: Eye exercises and relaxation techniques
- stress: Stress reduction and relaxation
- posture: Stretches and posture correction
- mindfulness: Mental breaks and awareness
- hydration: Water intake and health
- movement: Physical activity and exercise

Return ONLY valid JSON with this structure:
{{
  "tip": "Short title of the tip",
  "category": "one of the categories above",
  "duration": "suggested time to spend",
  "instruction": "Very brief instruction (1-2 sentences, under 50 words)"
}}

Do NOT include any other text. Only return the JSON object."""


@router.post("/recommendation", response_model=TipResponse)
async def get_tip_recommendation(token: str, request: TipRequest = TipRequest()):
    try:
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_id = payload.get("sub")
        user = db.get_user_by_id(user_id)

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Use stored provider if available, otherwise use first available env-based provider
        ai_providers = user.get("ai_providers", {})
        if ai_providers:
            provider_key = next(iter(ai_providers))
            provider_config = ai_providers[provider_key]
            device_id = user.get("device_id", "")
            api_key = decrypt_api_key(provider_config["api_key"], device_id)
            model = provider_config["model"]
        else:
            from config.llm_providers import list_providers_for_frontend
            available = list_providers_for_frontend()
            if not available:
                raise HTTPException(status_code=400, detail="No LLM providers configured.")
            provider_key = available[0]["key"]
            api_key = ""
            model = available[0]["default_model"]

        from services.llm_service import get_llm
        llm = get_llm(provider_key, model, api_key)

        system_prompt = build_tip_system_prompt(request, user)

        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content="Give me a fresh break tip"),
        ], temperature=0.9, max_tokens=300)

        ai_response = response.content

        import json
        try:
            if "```" in ai_response:
                json_str = ai_response.split("```")[1]
                if json_str.startswith("json"):
                    json_str = json_str[4:]
                tip_data = json.loads(json_str.strip())
            else:
                tip_data = json.loads(ai_response)

            return TipResponse(
                tip=tip_data["tip"],
                category=tip_data["category"],
                duration=tip_data["duration"],
                instruction=tip_data["instruction"]
            )
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=502, detail=f"Failed to parse AI response: {str(e)}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate tip: {str(e)}")
