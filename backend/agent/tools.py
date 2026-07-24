from langchain_core.tools import tool
from typing import Optional
from datetime import datetime
from contextvars import ContextVar

# Used by the wrapper in graph.py to inject the user's local hour
_local_hour_var: ContextVar[Optional[int]] = ContextVar('_local_hour_var', default=None)

MOOD_MUSIC_MAP = {
    "stressed": {"emoji": "\U0001f630", "label": "Stressed", "description": "Rain sounds to calm your mind"},
    "anxious": {"emoji": "\U0001f61f", "label": "Anxious", "description": "Soft piano for peace"},
    "tired": {"emoji": "\U0001f634", "label": "Tired", "description": "Nature sounds to recharge"},
    "sad": {"emoji": "\U0001f614", "label": "Sad", "description": "Gentle melodies to comfort"},
    "focus": {"emoji": "\U0001f3af", "label": "Need Focus", "description": "Lo-fi beats for concentration"},
    "happy": {"emoji": "\U0001f60a", "label": "Happy", "description": "Uplifting acoustic vibes"},
    "sleep": {"emoji": "\U0001f319", "label": "Sleep", "description": "Deep calm for restful sleep"},
    "meditate": {"emoji": "\U0001f9d8", "label": "Meditate", "description": "Zen peace for mindfulness"},
}

MOOD_SYNONYMS = {
    "delightful": "happy", "cheerful": "happy", "upbeat": "happy", "good": "happy",
    "great": "happy", "excited": "happy", "joyful": "happy", "pleased": "happy",
    "overwhelmed": "stressed", "tense": "stressed", "frustrated": "stressed",
    "pressured": "stressed", "burned out": "stressed", "burnout": "stressed",
    "worried": "anxious", "nervous": "anxious", "panicked": "anxious", "scared": "anxious",
    "exhausted": "tired", "sleepy": "tired", "drained": "tired", "worn out": "tired",
    "fatigued": "tired", "sleepy": "tired",
    "down": "sad", "depressed": "sad", "lonely": "sad", "unhappy": "sad", "blue": "sad",
    "concentrate": "focus", "productive": "focus", "work": "focus", "study": "focus",
    "working": "focus", "studying": "focus", "coding": "focus",
    "rest": "sleep", "bed": "sleep", "drowsy": "sleep", "insomnia": "sleep",
    "calm": "meditate", "peaceful": "meditate", "zen": "meditate", "mindful": "meditate",
    "relax": "meditate", "relaxing": "meditate",
}


@tool
def check_system_settings(
    brightness: Optional[int] = None,
    volume: Optional[int] = None,
    auto_apply: bool = False,
) -> dict:
    """Check if the user's current system settings (brightness, volume) are optimal for their health. Call this whenever a user asks about their settings, wellness, burnout prevention, or when they mention brightness/volume. Returns recommendations for any settings that need adjustment.

Set auto_apply=True when the user explicitly asks to FIX, OPTIMIZE, APPLY, or UPDATE settings (e.g. "fix my settings", "optimize my brightness", "apply the recommended settings", "update everything"). In this case, apply the changes immediately.

    Set auto_apply=False when the user asks to CHECK, VIEW, or SEE settings (e.g. "check my settings", "what's my brightness", "show me my settings"). In this case, show the recommendations with Execute/Reject buttons for the user to confirm."""
    hour = _local_hour_var.get() or datetime.utcnow().hour

    recommendations = []
    status = {}

    if brightness is not None:
        if 6 <= hour < 18:
            opt_min, opt_max, time_ctx = 60, 75, "daytime"
        elif 18 <= hour < 21:
            opt_min, opt_max, time_ctx = 50, 65, "evening"
        else:
            opt_min, opt_max, time_ctx = 30, 50, "night"

        if brightness > opt_max:
            rec_brightness = opt_max
            recommendations.append({
                "type": "brightness",
                "action": "decrease",
                "current": brightness,
                "recommended": rec_brightness,
                "reason": f"Brightness at {brightness}% is too high for {time_ctx}. {rec_brightness}% reduces eye strain.",
                "priority": 4 if brightness > opt_max + 20 else 3,
                "execute_params": {"target_brightness": rec_brightness},
            })
            status["brightness"] = "needs_adjustment"
        elif brightness < opt_min:
            rec_brightness = opt_min
            recommendations.append({
                "type": "brightness",
                "action": "increase",
                "current": brightness,
                "recommended": rec_brightness,
                "reason": f"Brightness at {brightness}% is too low for {time_ctx}. {rec_brightness}% is more comfortable.",
                "priority": 2,
                "execute_params": {"target_brightness": rec_brightness},
            })
            status["brightness"] = "needs_adjustment"
        else:
            status["brightness"] = "optimal"

    if volume is not None:
        if volume > 70:
            recommendations.append({
                "type": "volume",
                "action": "decrease",
                "current": volume,
                "recommended": 60,
                "reason": f"Volume at {volume}% exceeds WHO safe limit of 60% for extended listening. Risk of hearing damage.",
                "priority": 5 if volume > 85 else 4,
                "execute_params": {"target_volume": 60},
            })
            status["volume"] = "needs_adjustment"
        elif volume > 60:
            recommendations.append({
                "type": "volume",
                "action": "decrease",
                "current": volume,
                "recommended": 60,
                "reason": f"Volume at {volume}% is slightly above the recommended 60% for long sessions.",
                "priority": 2,
                "execute_params": {"target_volume": 60},
            })
            status["volume"] = "needs_adjustment"
        else:
            status["volume"] = "optimal"

    return {
        "has_recommendations": len(recommendations) > 0,
        "recommendations": recommendations,
        "status": status,
        "current_hour": hour,
        "auto_apply": auto_apply,
    }


@tool
def get_user_activity(user_id: str, days: int = 1) -> dict:
    """Get the user's recent wellness activity history. Call this when the user asks about their progress, activity, how many sessions they've done, or their work/break patterns. Returns session counts, break completion rates, and total focus time."""
    from db import activity_db

    try:
        records = activity_db.get_user_activity(user_id, days)
        if not records:
            return {
                "has_data": False,
                "message": "No activity recorded yet for this period.",
            }

        total_duration = sum(r.get("total_session_duration", 0) for r in records)
        total_breaks = sum(r.get("total_breaks_taken", 0) for r in records)
        total_skipped = sum(r.get("total_breaks_skipped", 0) for r in records)
        total_sessions = sum(r.get("sessions_count", 0) for r in records)

        return {
            "has_data": True,
            "days": len(records),
            "total_focus_seconds": total_duration,
            "total_focus_minutes": round(total_duration / 60, 1),
            "total_sessions": total_sessions,
            "total_breaks_taken": total_breaks,
            "total_breaks_skipped": total_skipped,
            "break_compliance": round(total_breaks / max(total_sessions, 1) * 100),
            "daily_records": records,
        }
    except Exception as e:
        return {"has_data": False, "error": str(e)}


@tool
def get_user_break_settings(user_id: str) -> dict:
    """Get the user's configured break preferences (interval, duration, auto-start). Call this when the user asks about or wants to change their break schedule settings."""
    from db import settings_db

    try:
        settings = settings_db.get_user_settings(user_id)
        if not settings:
            return {
                "has_settings": False,
                "message": "Using default settings: 30 min interval, 90 sec break, auto-start enabled.",
                "break_interval": 30,
                "break_duration": 90,
                "auto_start": True,
            }

        return {
            "has_settings": True,
            "break_interval": settings.get("break_interval", 30),
            "break_duration": settings.get("break_duration", 90),
            "auto_start": settings.get("auto_start", True),
            "break_interval_minutes": round(settings.get("break_interval", 30) / 60, 1),
        }
    except Exception as e:
        return {"has_settings": False, "error": str(e)}


@tool
def get_break_tip(focus_area: Optional[str] = None, auto_apply: bool = False) -> dict:
    """Get a wellness break tip. Call this when the user asks for a break suggestion, wellness tip, or wants to know what to do during a break. Returns a specific actionable activity with instructions.

    Set auto_apply=True when the user explicitly asks to SET UP, CONFIGURE, or START breaks (e.g. "set up breaks for me", "configure my breaks", "start taking breaks"). In this case, return the tip with auto_apply=true so break settings can be configured.

    Set auto_apply=False when the user asks for a tip, suggestion, or recommendation (e.g. "give me a break tip", "what should I do during a break", "suggest something"). In this case, just show the tip."""
    tips = {
        "eyes": [
            {"tip": "20-20-20 Rule", "duration": "20 seconds", "instruction": "Look at something 20 feet away for 20 seconds. This reduces eye strain by giving your focusing muscles a break."},
            {"tip": "Palming Exercise", "duration": "30 seconds", "instruction": "Rub your hands together to warm them, then gently cup your palms over closed eyes without pressing. Breathe deeply."},
            {"tip": "Blinking Exercise", "duration": "20 seconds", "instruction": "Blink rapidly 10 times, then close your eyes for 20 seconds. This rehydrates your eyes."},
            {"tip": "Focus Shift", "duration": "30 seconds", "instruction": "Hold your thumb 10 inches from your face. Focus on it for 10 seconds, then focus on something across the room for 10 seconds. Repeat 3 times."},
        ],
        "stress": [
            {"tip": "Deep Breathing (4-7-8)", "duration": "60 seconds", "instruction": "Inhale through nose for 4 counts, hold for 7, exhale through mouth for 8. Repeat 3 times."},
            {"tip": "Progressive Muscle Relaxation", "duration": "60 seconds", "instruction": "Tense your shoulders tightly for 5 seconds, then release. Notice the difference. Move to your arms, then face."},
        ],
        "posture": [
            {"tip": "Neck Stretch", "duration": "30 seconds", "instruction": "Tilt your head to the right, bringing ear toward shoulder. Hold 15 seconds, then switch. Repeat 2 times."},
            {"tip": "Shoulder Rolls", "duration": "20 seconds", "instruction": "Roll your shoulders forward 5 times, then backward 5 times. Releases tension from sitting."},
            {"tip": "Wrist Stretch", "duration": "30 seconds", "instruction": "Extend one arm, pull fingers back gently with other hand. Hold 15 seconds. Switch hands."},
        ],
        "mindfulness": [
            {"tip": "Box Breathing", "duration": "60 seconds", "instruction": "Inhale for 4 counts, hold for 4, exhale for 4, hold for 4. Repeat 4 times."},
            {"tip": "5-4-3-2-1 Grounding", "duration": "60 seconds", "instruction": "Notice 5 things you see, 4 you touch, 3 you hear, 2 you smell, 1 you taste."},
        ],
        "hydration": [
            {"tip": "Water Break", "duration": "30 seconds", "instruction": "Drink a full glass of water. Dehydration causes fatigue and reduced concentration."},
        ],
        "movement": [
            {"tip": "Stand and Stretch", "duration": "45 seconds", "instruction": "Stand up, reach arms overhead, stretch left for 10 seconds, then right."},
            {"tip": "Quick Walk", "duration": "60 seconds", "instruction": "Walk around your workspace. Movement increases blood flow and refreshes your mind."},
        ],
    }

    import random

    if focus_area and focus_area in tips:
        tip = random.choice(tips[focus_area])
        return {"category": focus_area, "auto_apply": auto_apply, **tip}

    all_tips = []
    for cat_tips in tips.values():
        all_tips.extend(cat_tips)

    categories = list(tips.keys())
    tip = random.choice(all_tips)
    category = random.choice(categories)

    return {"category": category, "auto_apply": auto_apply, **tip}


@tool
def search_knowledge_base(user_id: str, query: str) -> dict:
    """Search the user's personal knowledge base for relevant information. ONLY call this when the user has EXPLICITLY asked to search their documents, notes, or uploaded files (e.g. 'check my docs', 'what does my KB say', 'search my notes'). Do NOT call proactively for general questions. Returns all documents in the KB plus matching excerpts from the most relevant ones."""
    try:
        from kb.vector_store import search_documents, list_documents
        all_docs = list_documents(user_id)
        results = search_documents(user_id, query, k=3)

        doc_list = []
        for d in all_docs:
            doc_list.append({
                "filename": d["filename"],
                "file_type": d["file_type"],
                "page_count": d.get("page_count", 1),
                "total_chunks": d["total_chunks"],
            })

        formatted = []
        for r in results:
            formatted.append({
                "filename": r["filename"],
                "content": r["content"][:500],
                "score": round(r["score"], 3),
            })

        return {
            "all_documents": doc_list,
            "total_documents": len(doc_list),
            "has_results": len(results) > 0,
            "results": formatted,
            "count": len(formatted),
        }
    except Exception as e:
        return {"has_results": False, "error": str(e)}


@tool
def recommend_music(mood: str = "", query: str = "", auto_play: bool = False) -> dict:
    """Recommend music. ALWAYS call this when the user asks to play, find, or suggest music. NEVER just say you can't help — always call this tool.

    Use `query` for specific music types (genre, style, artist, culture, instrument). Examples: query="pooja music", query="lofi from japan", query="classical violin", query="80s synthwave".

    Use `mood` for feelings/emotions: stressed, anxious, tired, sad, focus, happy, sleep, meditate.

    Set auto_play=true when user wants to PLAY music. auto_play=false for FIND/SUGGEST/BROWSE."""

    if query and not mood:
        return {
            "success": True,
            "query": query,
            "mood": None,
            "emoji": "\U0001f3b5",
            "label": query.title(),
            "description": query,
            "auto_play": auto_play,
            "message": f"Playing {query} for you." if auto_play else f"Here's what I found for '{query}'. Would you like me to play it?",
        }

    if mood and not query:
        mood_lower = mood.lower().strip()
        if mood_lower not in MOOD_MUSIC_MAP:
            mood_lower = MOOD_SYNONYMS.get(mood_lower, mood_lower)
        if mood_lower in MOOD_MUSIC_MAP:
            info = MOOD_MUSIC_MAP[mood_lower]
            if auto_play:
                message = f"Playing {info['label'].lower()} music for you — {info['description'].lower()}."
            else:
                message = f"I found some {info['label'].lower()} music for you — {info['description'].lower()}. Would you like me to play it?"
            return {
                "success": True,
                "mood": mood_lower,
                "emoji": info["emoji"],
                "label": info["label"],
                "description": info["description"],
                "auto_play": auto_play,
                "message": message,
            }

    if mood and query:
        return {
            "success": True,
            "query": query,
            "mood": mood,
            "emoji": "\U0001f3b5",
            "label": mood.title(),
            "description": query,
            "auto_play": auto_play,
            "message": f"Playing {query} for you." if auto_play else f"Here's what I found for '{query}'. Would you like me to play it?",
        }

    return {
        "success": False,
        "message": "I need to know what music you'd like. Tell me a mood (stressed, happy, etc.) or a specific type (lofi, classical, jazz, etc.).",
    }
