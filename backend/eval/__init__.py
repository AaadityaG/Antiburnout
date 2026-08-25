"""LangSmith-based evaluation harness for the AntiBurnout AI stack.

Covers:
- Agent tool routing + auto-execute flags (real LLM)
- Tool rule correctness (settings recommendations, music routing)
- RAG retrieval quality (KB, recall@k / MRR)
- Chunking correctness

Run from the `backend/` directory:
    python -m eval.run push
    python -m eval.run agent
    python -m eval.run retrieval
    python -m eval.run chunking
    python -m eval.run all

Requires env vars: LANGSMITH_API_KEY, and a provider API key (see .env.example).
"""
