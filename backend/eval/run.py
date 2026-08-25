"""CLI for the AntiBurnout LangSmith eval harness.

Usage (from backend/):
    python -m eval.run push --force        # (re)push golden datasets to LangSmith
    python -m eval.run agent               # tool routing + flag correctness (real LLM)
    python -m eval.run retrieval           # KB retrieval recall@k / MRR
    python -m eval.run chunking            # chunking correctness (no LLM)
    python -m eval.run all --force         # everything

Required env: LANGSMITH_API_KEY, and a provider API key (see .env.example).
"""

import argparse
import os
import sys

from dotenv import load_dotenv
from langsmith.evaluation import evaluate

from eval import datasets, evaluators

# Load backend/.env explicitly — independent of the current working directory,
# so the harness behaves the same no matter where it's invoked from.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _require_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    print(f"[error] missing required env var: {' or '.join(names)} (set it in backend/.env or the environment)")
    sys.exit(1)


def _require_langsmith_key() -> str:
    """Resolve LANGSMITH_API_KEY or its LANGCHAIN_API_KEY alias.

    LangSmith clients accept both names, but some versions only read
    LANGSMITH_API_KEY — normalize so either works everywhere.
    """
    key = _require_env("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY")
    if not os.getenv("LANGSMITH_API_KEY"):
        os.environ["LANGSMITH_API_KEY"] = key
    return key


def _print_results(results, label: str) -> None:
    df = results.to_pandas()
    print(f"\n=== {label} ===")
    print(f"Experiment: {results.experiment_name} (view in LangSmith dashboard)")

    feedback_cols = [c for c in df.columns if str(c).startswith("feedback.")]
    if not feedback_cols:
        print("(no feedback columns returned)")
        return

    for col in feedback_cols:
        key = str(col).split(".", 1)[1]
        scores = df[col].dropna().tolist()
        if not scores:
            continue
        passed = sum(1 for s in scores if s >= 1.0)
        avg = sum(scores) / len(scores)
        print(f"  {key:<28} pass={passed}/{len(scores)}  avg={avg:.2f}")


def cmd_push(args) -> None:
    _require_langsmith_key()
    datasets.push_all_datasets(force=args.force)


def cmd_agent(args) -> None:
    _require_langsmith_key()
    from eval import fixtures
    from eval.targets import run_agent_target

    fixtures.ensure_seed_data()
    print("[run] seeded fixture user data (settings + activity)")

    results = evaluate(
        run_agent_target,
        data=datasets.TOOL_ROUTING_DATASET,
        evaluators=[
            evaluators.response_nonempty,
            evaluators.response_word_count,
            evaluators.tool_selection,
            evaluators.forbidden_tools,
            evaluators.auto_flag_correct,
            evaluators.music_query_matches,
            evaluators.mood_matches,
            evaluators.settings_recommendations,
            evaluators.no_false_action_claim,
        ],
        experiment_prefix="agent-tool-routing",
        max_concurrency=args.concurrency,
    )
    _print_results(results, "Agent tool routing (real LLM)")


def cmd_retrieval(args) -> None:
    _require_langsmith_key()
    from eval import fixtures
    from eval.targets import kb_retrieval_target

    fixtures.ensure_kb_corpus()
    print("[run] seeded eval KB corpus")

    results = evaluate(
        kb_retrieval_target,
        data=datasets.RETRIEVAL_DATASET,
        evaluators=[evaluators.recall_at_k, evaluators.mrr],
        experiment_prefix="kb-retrieval",
        max_concurrency=args.concurrency,
    )
    _print_results(results, "KB retrieval (RAG)")


def cmd_chunking(args) -> None:
    _require_langsmith_key()
    from eval.targets import chunk_target

    results = evaluate(
        chunk_target,
        data=datasets.CHUNKING_DATASET,
        evaluators=[evaluators.chunk_count_ok, evaluators.chunk_size_ok],
        experiment_prefix="chunking",
        max_concurrency=args.concurrency,
    )
    _print_results(results, "Chunking correctness")


def main() -> None:
    parser = argparse.ArgumentParser(description="AntiBurnout LangSmith eval harness")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("push", help="Push golden datasets to LangSmith")
    p.add_argument("--force", action="store_true", help="Recreate existing datasets")
    p.set_defaults(func=cmd_push)

    p = sub.add_parser("agent", help="Run agent tool-routing evaluation (real LLM)")
    p.add_argument("--concurrency", type=int, default=4)
    p.set_defaults(func=cmd_agent)

    p = sub.add_parser("retrieval", help="Run KB retrieval evaluation")
    p.add_argument("--concurrency", type=int, default=4)
    p.set_defaults(func=cmd_retrieval)

    p = sub.add_parser("chunking", help="Run chunking evaluation")
    p.add_argument("--concurrency", type=int, default=4)
    p.set_defaults(func=cmd_chunking)

    p = sub.add_parser("all", help="Push datasets then run all evaluations")
    p.add_argument("--force", action="store_true")
    p.add_argument("--concurrency", type=int, default=4)
    p.set_defaults(func=lambda a: (cmd_push(a), cmd_agent(a), cmd_retrieval(a), cmd_chunking(a)))

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
