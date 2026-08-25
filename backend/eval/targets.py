"""Callable targets for LangSmith evaluation.

Each target receives the example's `inputs` dict and returns a structured
prediction dict that the evaluators can inspect. Nothing here requires a
mock — the agent target always runs the real LLM.
"""

import asyncio
from types import SimpleNamespace

from eval.fixtures import EVAL_KB_USER_ID, get_eval_user, get_llm_config


def _to_history(conversation_history) -> list:
    if not conversation_history:
        return []
    return [
        SimpleNamespace(role=m.get("role"), content=m.get("content"))
        for m in conversation_history
    ]


async def _run_agent_async(example: dict) -> dict:
    from services.agent_runner import run_agent

    config = get_llm_config()
    user = get_eval_user()

    system_metrics = {
        k: example[k] for k in ("brightness", "volume", "local_hour")
        if example.get(k) is not None
    }

    response, recommendations, tools_used, token_usage, tool_calls, tool_results = await run_agent(
        provider_key=config["provider"],
        model=config["model"],
        api_key=config["api_key"],
        user=user,
        system_metrics=system_metrics or None,
        message=example.get("message", ""),
        conversation_history=_to_history(example.get("conversation_history")),
        include_tool_calls=True,
    )

    return {
        "response": response,
        "recommendations": recommendations,
        "tools_used": tools_used,
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "token_usage": token_usage,
        "provider": config["provider"],
        "model": config["model"],
    }


def run_agent_target(example: dict) -> dict:
    """Run the full LangGraph agent with the real LLM.

    Mirrors the production path (services/agent_runner.run_agent) and returns
    a structured trace: response, recommendations, tools used, tool calls with
    arguments, tool outputs, and token usage.
    """
    return asyncio.run(_run_agent_async(example))


def kb_retrieval_target(example: dict) -> dict:
    """Run the KB retrieval pipeline (the same function kb_search calls)."""
    from kb.vector_store import search_documents

    results = search_documents(EVAL_KB_USER_ID, example.get("query", ""), k=5)
    return {
        "doc_ids": [r["doc_id"] for r in results],
        "filenames": [r["filename"] for r in results],
        "scores": [r["score"] for r in results],
        "count": len(results),
    }


def chunk_target(example: dict) -> dict:
    """Run the shared chunker (used by chat-history RAG and KB ingestion)."""
    from rag.vector_store import chunk_text

    chunks = chunk_text(example.get("text", ""))
    return {"count": len(chunks), "chunks": chunks}
