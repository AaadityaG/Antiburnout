"""Fixtures for evaluation runs.

Seeds deterministic, self-contained data so the agent tools
(get_user_activity, get_user_break_settings, kb_search) return real,
predictable data on every machine. All seeding happens through the same
db / kb modules the app uses, so nothing is mocked.
"""

import os
from datetime import datetime, timedelta

# Fixed identity used by every eval run. ChromaDB collection names replace
# dashes with underscores, so this stays collision-free across machines.
EVAL_USER_ID = "eval-user-0001"
EVAL_KB_USER_ID = "eval-kb-user"

DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


def get_eval_user() -> dict:
    """Return the fixture user the agent runs as (no DB round-trip needed)."""
    return {
        "id": EVAL_USER_ID,
        "device_id": "eval-device",
        "device_name": "eval-machine",
        "name": "Eval User",
        "email": "",
        "created_at": (datetime.utcnow() - timedelta(days=30)).isoformat(),
        "last_login": datetime.utcnow().isoformat(),
    }


def get_llm_config() -> dict:
    """Resolve the LLM config for real-LLM evaluation.

    Accepts a key under OPENROUTER_API_KEY, EVAL_OPENROUTER_API_KEY, or
    OPENAI_API_KEY and detects the provider from the key prefix, so the same
    harness works on any machine with either provider. Both use the
    OpenAI-compatible chat completions API, so the agent's ChatOpenAI binding
    works unchanged.
    """
    model_override = os.getenv("EVAL_MODEL")
    key = (
        os.getenv("OPENROUTER_API_KEY")
        or os.getenv("EVAL_OPENROUTER_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    if not key:
        raise RuntimeError(
            "No LLM key found for real-LLM evaluation. Set OPENROUTER_API_KEY or "
            "OPENAI_API_KEY in backend/.env (see .env.example)."
        )

    base_url_override = os.getenv("LLM_BASE_URL")
    if key.startswith("sk-or-v1-") or key.startswith("sk-or-"):
        return {
            "provider": "openrouter",
            "api_key": key,
            "base_url": base_url_override or "https://openrouter.ai/api/v1",
            "model": model_override or DEFAULT_OPENROUTER_MODEL,
        }
    return {
        "provider": "openai",
        "api_key": key,
        "base_url": base_url_override or "https://api.openai.com/v1",
        "model": model_override or DEFAULT_OPENAI_MODEL,
    }


def ensure_seed_data() -> None:
    """Seed break settings + activity so data-backed tools return records."""
    from db import activity_db, settings_db

    settings_db.save_user_settings(EVAL_USER_ID, {
        "break_interval": 1800,
        "break_duration": 90,
        "auto_start": True,
    })

    if not activity_db.get_user_activity(EVAL_USER_ID, days=7):
        for _ in range(3):
            activity_db.save_session(EVAL_USER_ID, {
                "session_duration": 1800,
                "target_duration": 1800,
                "completed": True,
                "skipped": False,
            })


# --- Knowledge base corpus -------------------------------------------------

SLEEP_TEXT = (
    "Sleep is essential for preventing burnout. Most adults need between 7 and 8 "
    "hours of sleep every night to function well. A consistent bedtime, even on "
    "weekends, keeps your circadian rhythm stable. Keep your bedroom cool, dark, "
    "and quiet. Avoid caffeine after 2 PM because it stays in your system for hours. "
    "Stop using screens one hour before bed; blue light suppresses melatonin. "
    "If you have sleep debt, you need about 2 to 3 days of normal sleep to recover "
    "from every single hour you missed. Napping for 20 minutes in the early "
    "afternoon can restore alertness without disrupting nighttime sleep. Deep sleep "
    "renews the immune system, and REM sleep consolidates memory, so never trade "
    "sleep for extra screen time."
)

STRESS_TEXT = (
    "Work stress and burnout often build up silently. Common symptoms of burnout "
    "are chronic fatigue, irritability, reduced performance, and feeling detached "
    "from your work. To manage stress, schedule short recovery breaks every hour "
    "instead of powering through. Practice deep breathing: inhale for four counts, "
    "hold for seven, exhale for eight. Write down three things that went well at "
    "the end of each day to train a positive outlook. Set firm boundaries between "
    "work and personal time, and avoid checking email late at night. Talk to a "
    "colleague or friend about pressure you are feeling; isolation amplifies stress. "
    "Regular movement, even a five minute walk, lowers cortisol and resets your "
    "nervous system."
)

ERGONOMICS_TEXT = (
    "Ergonomics prevents the physical strain of long screen sessions. Position the "
    "top of your monitor at or slightly below eye level, about an arm's length away. "
    "Sit with your feet flat on the floor, knees at a 90 degree angle, and your "
    "back supported. To reduce eye strain follow the 20-20-20 rule: every 20 "
    "minutes look at something 20 feet away for 20 seconds. Adjust screen brightness "
    "to match the room lighting and avoid glare. Keep your wrists straight and your "
    "elbows at your sides while typing. A standing desk with periodic position "
    "changes prevents stiffness. Stretch your neck, shoulders, and wrists during "
    "every break to release tension built up from sitting."
)

WELLNESS_TEXT = (
    "Daily wellness habits build resilience against burnout. Hydration matters: "
    "drinking a full glass of water when you feel tired or unfocused can restore "
    "energy because even mild dehydration causes fatigue. Eat regular balanced "
    "meals instead of skipping lunch to keep blood sugar stable. Mindfulness "
    "practice, such as a five minute body scan or box breathing, reduces anxiety "
    "and improves attention. Movement breaks improve blood flow and refresh your "
    "mind. Maintain social connections even during busy weeks. Track your energy "
    "levels to notice early warning signs of overwork, and schedule recovery "
    "activities like walks, music, or reading into your calendar deliberately."
)

KB_CORPUS = [
    ("sleep-hygiene", "sleep-hygiene.md", "md", SLEEP_TEXT),
    ("stress-management", "stress-management.md", "md", STRESS_TEXT),
    ("ergonomics", "ergonomics.md", "md", ERGONOMICS_TEXT),
    ("wellness-guide", "wellness-guide.md", "md", WELLNESS_TEXT),
]


def ensure_kb_corpus() -> None:
    """(Re)seed the eval user's KB collection with the known corpus.

    Deletes the collection first so runs are idempotent on any machine.
    """
    from kb.vector_store import delete_user_collection, store_document

    delete_user_collection(EVAL_KB_USER_ID)
    for doc_id, filename, file_type, text in KB_CORPUS:
        store_document(EVAL_KB_USER_ID, doc_id, filename, file_type, text, page_count=1)
