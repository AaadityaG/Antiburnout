"""Evaluators for the AntiBurnout agent + RAG stack.

All evaluators use the LangSmith custom-evaluator signature
`(inputs, outputs, reference_outputs)`:
- inputs           = the example's inputs (message, metrics, ...)
- outputs          = the target's prediction dict
- reference_outputs = the example's expected outputs (golden expectations)

Each returns a langsmith EvaluationResult. Scores are deterministic given the
prediction, so the same prediction scores the same on every machine.
"""

from functools import wraps

from langsmith.evaluation import EvaluationResult


def _result(key: str, score: float, comment: str | None = None) -> EvaluationResult:
    return EvaluationResult(key=key, score=score, comment=comment)


def _guarded(key: str):
    """Fail honestly when the target produced no prediction (e.g. LLM error).

    Without this, evaluators like word-count would give a perfect score to an
    empty/errored run, which corrupts "works everywhere" comparisons.
    """

    def decorator(func):
        @wraps(func)
        def wrapper(inputs, outputs, reference_outputs):
            if outputs is None or not isinstance(outputs, dict) or not outputs:
                return _result(key, 0.0, "no prediction outputs (target errored)")
            return func(inputs, outputs, reference_outputs)

        return wrapper

    return decorator


def _tools(outputs: dict) -> list[str]:
    return outputs.get("tools_used", []) or []


def _tool_calls(outputs: dict) -> list[dict]:
    return outputs.get("tool_calls", []) or []


def _tool_results(outputs: dict) -> list[dict]:
    return outputs.get("tool_results", []) or []


# --- Response quality -------------------------------------------------------


@_guarded("response_nonempty")
def response_nonempty(inputs, outputs, reference_outputs) -> EvaluationResult:
    response = (outputs or {}).get("response", "")
    if not response or not str(response).strip():
        return _result("response_nonempty", 0.0, "empty response")
    return _result("response_nonempty", 1.0)


@_guarded("response_word_count")
def response_word_count(inputs, outputs, reference_outputs) -> EvaluationResult:
    response = str((outputs or {}).get("response", "") or "")
    max_words = (reference_outputs or {}).get("max_words", 120)
    count = len(response.split())
    if count <= max_words:
        return _result("response_word_count", 1.0, f"{count} words")
    return _result("response_word_count", 0.0, f"{count} words > max {max_words}")


# --- Tool routing -----------------------------------------------------------


@_guarded("tool_selection")
def tool_selection(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("tools", [])
    used = set(_tools(outputs))
    if not expected:
        return _result("tool_selection", 1.0, "no tools expected")
    missing = [t for t in expected if t not in used]
    score = 1.0 - len(missing) / len(expected)
    comment = f"missing={missing}" if missing else f"all expected tools called ({sorted(used)})"
    return _result("tool_selection", score, comment)


@_guarded("forbidden_tools")
def forbidden_tools(inputs, outputs, reference_outputs) -> EvaluationResult:
    forbidden = (reference_outputs or {}).get("forbidden_tools", [])
    used = set(_tools(outputs))
    violated = [t for t in forbidden if t in used]
    if violated:
        return _result("forbidden_tools", 0.0, f"called forbidden tools: {violated}")
    return _result("forbidden_tools", 1.0)


@_guarded("auto_flag_correct")
def auto_flag_correct(inputs, outputs, reference_outputs) -> EvaluationResult:
    spec = (reference_outputs or {}).get("expected_auto")
    if not spec:
        return _result("auto_flag_correct", 1.0, "n/a")
    calls = {tc.get("name"): tc for tc in _tool_calls(outputs)}
    tc = calls.get(spec["tool"])
    if tc is None:
        return _result("auto_flag_correct", 0.0, f"{spec['tool']} not called")
    actual = tc.get("arguments", {}).get(spec["param"])
    ok = actual == spec["value"]
    comment = f"{spec['param']}={actual} expected {spec['value']}"
    return _result("auto_flag_correct", 1.0 if ok else 0.0, comment)


@_guarded("music_query_matches")
def music_query_matches(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("music_query_substring")
    if not expected:
        return _result("music_query_matches", 1.0, "n/a")
    for tc in _tool_calls(outputs):
        if tc.get("name") == "recommend_music":
            q = str(tc.get("arguments", {}).get("query", ""))
            if expected.lower() in q.lower():
                return _result("music_query_matches", 1.0, f"query={q!r}")
            return _result("music_query_matches", 0.0, f"query={q!r} lacks {expected!r}")
    return _result("music_query_matches", 0.0, "recommend_music not called")


@_guarded("mood_matches")
def mood_matches(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("expected_mood")
    if not expected:
        return _result("mood_matches", 1.0, "n/a")
    for tc in _tool_calls(outputs):
        if tc.get("name") == "recommend_music":
            m = str(tc.get("arguments", {}).get("mood", ""))
            return _result("mood_matches", 1.0 if m == expected else 0.0, f"mood={m!r}")
    return _result("mood_matches", 0.0, "recommend_music not called")


# --- Tool rule correctness (end-to-end through the LLM + tool) --------------

# Phrases that would claim a system change happened without a tool call.
_FALSE_CLAIM_PATTERNS = [
    "applied the", "applied your", "applied my", "i've applied", "i have applied",
    "i applied", "adjusted your", "changed your", "lowered your brightness",
    "reduced your brightness", "increased your brightness", "raised your brightness",
    "lowered your volume", "reduced your volume", "changed the brightness",
    "changed the volume", "already applied", "done it",
]


@_guarded("no_false_action_claim")
def no_false_action_claim(inputs, outputs, reference_outputs) -> EvaluationResult:
    response = str((outputs or {}).get("response", "") or "").lower()
    called_auto = any(
        tc.get("name") == "check_settings_with_metrics"
        and tc.get("arguments", {}).get("auto_apply") is True
        for tc in _tool_calls(outputs)
    )
    if called_auto:
        return _result("no_false_action_claim", 1.0, "auto_apply tool called")
    violated = [p for p in _FALSE_CLAIM_PATTERNS if p in response]
    if violated:
        return _result("no_false_action_claim", 0.0, f"false claim: {violated}")
    return _result("no_false_action_claim", 1.0)


@_guarded("settings_recommendations")
def settings_recommendations(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("expected_recommendations", [])
    if expected is None or not expected:
        return _result("settings_recommendations", 1.0, "n/a")

    actual = []
    for tr in _tool_results(outputs):
        if tr.get("name") == "check_settings_with_metrics":
            content = tr.get("content") or {}
            if isinstance(content, dict):
                actual = content.get("recommendations", [])
                break

    passed = []
    for exp in expected:
        matched = any(
            r.get("type") == exp.get("type")
            and r.get("action") == exp.get("action")
            and r.get("recommended") == exp.get("recommended")
            for r in actual
        )
        passed.append(matched)

    score = sum(passed) / len(expected)
    missing = [e for e, ok in zip(expected, passed) if not ok]
    return _result(
        "settings_recommendations",
        score,
        f"missing={missing}" if missing else "all recommendations correct",
    )


# --- RAG retrieval ----------------------------------------------------------


@_guarded("recall_at_k")
def recall_at_k(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("expected_docs", [])
    predicted = (outputs or {}).get("doc_ids", [])
    if not expected:
        return _result("recall_at_k", 1.0, "n/a")
    hits = [d for d in expected if d in predicted]
    return _result("recall_at_k", len(hits) / len(expected), f"predicted={predicted}")


@_guarded("mrr")
def mrr(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("expected_docs", [])
    predicted = (outputs or {}).get("doc_ids", [])
    for i, doc in enumerate(predicted):
        if doc in expected:
            return _result("mrr", 1.0 / (i + 1), f"rank={i + 1}")
    return _result("mrr", 0.0, "not in top results")


# --- Chunking ---------------------------------------------------------------


@_guarded("chunk_count_ok")
def chunk_count_ok(inputs, outputs, reference_outputs) -> EvaluationResult:
    expected = (reference_outputs or {}).get("expected_count")
    actual = (outputs or {}).get("count")
    if actual == expected:
        return _result("chunk_count_ok", 1.0, f"{actual} chunks")
    return _result("chunk_count_ok", 0.0, f"expected {expected}, got {actual}")


@_guarded("chunk_size_ok")
def chunk_size_ok(inputs, outputs, reference_outputs) -> EvaluationResult:
    chunks = (outputs or {}).get("chunks", [])
    bad = [i for i, c in enumerate(chunks) if len(str(c).split()) > 300]
    if bad:
        return _result("chunk_size_ok", 0.0, f"chunks over 300 words: {bad}")
    return _result("chunk_size_ok", 1.0)
