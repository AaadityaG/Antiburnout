"""
Unified LLM factory. Every part of the backend calls get_llm() to get a
LangChain-compatible chat model. Adding a new provider = one dict in
config/llm_providers.py + possibly one branch here if it needs special auth.
"""

import os

from langchain_core.language_models.chat_models import BaseChatModel

from config.llm_providers import get_provider


def get_llm(provider_key: str, model: str, api_key: str = "") -> BaseChatModel:
    """Return a LangChain chat model configured for the given provider.

    Falls back to env vars if no api_key is provided.
    """
    provider = get_provider(provider_key)

    if not api_key:
        api_key = (
            os.getenv(provider.get("env_key", ""), "")
            or os.getenv(provider.get("fallback_env_key", ""), "")
            or os.getenv("OPENAI_API_KEY", "")
        )

    if provider_key == "gemini":
        return _get_gemini_llm(model, api_key)

    return _get_openai_compat_llm(provider, model, api_key)


def _get_gemini_llm(model: str, api_key: str) -> BaseChatModel:
    """Gemini via native Google SDK — proper tool calling support."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        max_output_tokens=1024,
        temperature=0.7,
        timeout=30,
    )


def _get_openai_compat_llm(provider: dict, model: str, api_key: str) -> BaseChatModel:
    """OpenAI-compatible endpoint (OpenRouter, etc.)."""
    from langchain_openai import ChatOpenAI

    base_url = os.getenv("LLM_BASE_URL") or provider.get("base_url", "")
    headers = provider.get("headers", {})

    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        max_tokens=1024,
        temperature=0.7,
        timeout=30,
        max_retries=1,
        default_headers=headers,
    )
