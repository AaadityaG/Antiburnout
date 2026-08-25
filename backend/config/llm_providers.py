"""
Single source of truth for all LLM providers.

To add a provider:
1. Add an entry to PROVIDERS below
2. If it needs special auth handling, add a branch in llm_service.py
3. That's it — chat, tips, eval all pick it up automatically.
"""

import os

PROVIDERS = {
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "env_key": "OPENROUTER_API_KEY",
        "fallback_env_key": "OPENAI_API_KEY",
        "default_model": "openai/gpt-4o-mini",
        "supports_tools": True,
        "headers": {
            "HTTP-Referer": "https://antiburnout.ai",
            "X-Title": "AntiBurnout",
        },
        "models": [
            {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini"},
            {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet"},
            {"id": "google/gemini-3.5-flash", "name": "Gemini 3.5 Flash"},
            {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B"},
        ],
    },
    "gemini": {
        "name": "Google Gemini",
        "env_key": "GEMINI_API_KEY",
        "fallback_env_key": "GOOGLE_API_KEY",
        "default_model": "gemini-3.6-flash",
        "supports_tools": True,
        "models": [
            {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash"},
            {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash"},
            {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite"},
            {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite"},
        ],
    },
}


def get_provider(provider_key: str) -> dict:
    """Return provider config or raise KeyError."""
    if provider_key not in PROVIDERS:
        raise KeyError(f"Unknown provider: {provider_key}. Available: {list(PROVIDERS.keys())}")
    return PROVIDERS[provider_key]


def has_api_key(provider: dict) -> bool:
    """Check if a provider has an API key configured in env vars."""
    primary = os.getenv(provider.get("env_key", ""), "")
    fallback = os.getenv(provider.get("fallback_env_key", ""), "")
    return bool(primary or fallback)


def provider_supports_tools(provider_key: str) -> bool:
    """Check if a provider supports tool calling."""
    p = PROVIDERS.get(provider_key)
    return bool(p and p.get("supports_tools", True))


def list_providers_for_frontend() -> list[dict]:
    """Return only providers that have API keys configured in the backend .env."""
    return [
        {
            "key": key,
            "name": p["name"],
            "default_model": p["default_model"],
            "models": p["models"],
            "supports_tools": p.get("supports_tools", True),
        }
        for key, p in PROVIDERS.items()
        if has_api_key(p)
    ]
