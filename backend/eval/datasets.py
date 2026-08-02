"""LangSmith datasets for the AntiBurnout eval harness.

Each dataset is a golden set of (inputs, expected outputs) pushed to LangSmith.
Because datasets live in LangSmith, every machine runs the exact same inputs
and the exact same reference expectations — that is what makes results
comparable "everywhere".

Datasets:
- antiburnout-agent-tool-routing : message + metrics -> expected tool calls, flags, recommendations
- antiburnout-kb-retrieval        : query -> expected KB document ids
- antiburnout-chunking            : text -> expected chunk count
"""

from langsmith import Client

TOOL_ROUTING_DATASET = "antiburnout-agent-tool-routing"
RETRIEVAL_DATASET = "antiburnout-kb-retrieval"
CHUNKING_DATASET = "antiburnout-chunking"

# Bound tool names as exposed to the LLM (wrappers from agent/graph.py).
SETTINGS = "check_settings_with_metrics"
ACTIVITY = "get_user_activity"
BREAK_SETTINGS = "get_user_break_settings"
BREAK_TIP = "get_break_tip"
MUSIC = "recommend_music"
KB = "kb_search"

# --- Tool routing golden cases ----------------------------------------------

TOOL_ROUTING_CASES = [
    # -- settings: show vs auto-execute + deterministic recommendations
    {
        "inputs": {"message": "check my settings please", "brightness": 100, "volume": 80, "local_hour": 10},
        "outputs": {
            "tools": [SETTINGS],
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": False},
            "expected_recommendations": [
                {"type": "brightness", "action": "decrease", "recommended": 75},
                {"type": "volume", "action": "decrease", "recommended": 60},
            ],
            "max_words": 150,
        },
    },
    {
        "inputs": {"message": "fix my settings", "brightness": 100, "volume": 90, "local_hour": 10},
        "outputs": {
            "tools": [SETTINGS],
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": True},
            "expected_recommendations": [
                {"type": "brightness", "action": "decrease", "recommended": 75},
                {"type": "volume", "action": "decrease", "recommended": 60},
            ],
        },
    },
    {
        "inputs": {"message": "optimize my brightness and volume", "brightness": 20, "volume": 55, "local_hour": 23},
        "outputs": {
            "tools": [SETTINGS],
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": True},
            "expected_recommendations": [
                {"type": "brightness", "action": "increase", "recommended": 30},
            ],
        },
    },
    {
        "inputs": {"message": "what is my volume right now", "volume": 85, "local_hour": 10},
        "outputs": {
            "tools": [SETTINGS],
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": False},
            "expected_recommendations": [
                {"type": "volume", "action": "decrease", "recommended": 60},
            ],
        },
    },
    {
        "inputs": {"message": "yes, apply them", "brightness": 80, "volume": 65, "local_hour": 20},
        "outputs": {
            "tools": [SETTINGS],
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": True},
            "expected_recommendations": [
                {"type": "brightness", "action": "decrease", "recommended": 65},
                {"type": "volume", "action": "decrease", "recommended": 60},
            ],
        },
    },
    # -- activity
    {
        "inputs": {"message": "show me my progress"},
        "outputs": {"tools": [ACTIVITY]},
    },
    {
        "inputs": {"message": "how many breaks have I taken today"},
        "outputs": {"tools": [ACTIVITY]},
    },
    # -- break settings
    {
        "inputs": {"message": "what are my break settings"},
        "outputs": {"tools": [BREAK_SETTINGS]},
    },
    # -- break tips: show vs configure
    {
        "inputs": {"message": "give me a break tip"},
        "outputs": {"tools": [BREAK_TIP], "expected_auto": {"tool": BREAK_TIP, "param": "auto_apply", "value": False}},
    },
    {
        "inputs": {"message": "set up breaks for me"},
        "outputs": {"tools": [BREAK_TIP], "expected_auto": {"tool": BREAK_TIP, "param": "auto_apply", "value": True}},
    },
    # -- music: query routing, mood routing, play vs find
    {
        "inputs": {"message": "play some lofi beats"},
        "outputs": {
            "tools": [MUSIC],
            "music_query_substring": "lofi",
            "expected_auto": {"tool": MUSIC, "param": "auto_play", "value": True},
        },
    },
    {
        "inputs": {"message": "play something happy"},
        "outputs": {
            "tools": [MUSIC],
            "expected_mood": "happy",
            "expected_auto": {"tool": MUSIC, "param": "auto_play", "value": True},
        },
    },
    {
        "inputs": {"message": "find me some jazz"},
        "outputs": {
            "tools": [MUSIC],
            "music_query_substring": "jazz",
            "expected_auto": {"tool": MUSIC, "param": "auto_play", "value": False},
        },
    },
    {
        "inputs": {"message": "put on pooja music"},
        "outputs": {
            "tools": [MUSIC],
            "music_query_substring": "pooja",
            "expected_auto": {"tool": MUSIC, "param": "auto_play", "value": True},
        },
    },
    {
        "inputs": {"message": "search lofi from japan"},
        "outputs": {
            "tools": [MUSIC],
            "music_query_substring": "japan",
            "expected_auto": {"tool": MUSIC, "param": "auto_play", "value": False},
        },
    },
    # -- rules: no music for feelings unless asked; no kb_search proactively
    {
        "inputs": {"message": "I'm feeling stressed"},
        "outputs": {"tools": [], "forbidden_tools": [MUSIC]},
    },
    {
        "inputs": {"message": "I'm really anxious about work today"},
        "outputs": {"tools": [], "forbidden_tools": [MUSIC]},
    },
    {
        "inputs": {"message": "can you tell me about mindfulness meditation in general"},
        "outputs": {"tools": [], "forbidden_tools": [KB]},
    },
    # -- kb_search only on explicit mention
    {
        "inputs": {"message": "search my knowledge base for sleep tips"},
        "outputs": {"tools": [KB]},
    },
    {
        "inputs": {"message": "what does my document say about productivity"},
        "outputs": {"tools": [KB]},
    },
    # -- pure chit-chat: no tools
    {
        "inputs": {"message": "hello, how are you today?"},
        "outputs": {"tools": []},
    },
    # -- mixed intent: settings + music in one message
    {
        "inputs": {"message": "check my settings and play calm zen music", "brightness": 90, "volume": 40, "local_hour": 22},
        "outputs": {
            "tools": [SETTINGS, MUSIC],
            "music_query_substring": "zen",
            "expected_auto": {"tool": SETTINGS, "param": "auto_apply", "value": False},
            "expected_recommendations": [
                {"type": "brightness", "action": "decrease", "recommended": 50},
            ],
        },
    },
]

# --- KB retrieval golden cases ----------------------------------------------

RETRIEVAL_CASES = [
    {"inputs": {"query": "How many hours of sleep should I get each night?"}, "outputs": {"expected_docs": ["sleep-hygiene"]}},
    {"inputs": {"query": "What are the signs that I'm burning out at work?"}, "outputs": {"expected_docs": ["stress-management"]}},
    {"inputs": {"query": "How can I reduce eye strain while working on a computer?"}, "outputs": {"expected_docs": ["ergonomics"]}},
    {"inputs": {"query": "What is the 20-20-20 rule for screens?"}, "outputs": {"expected_docs": ["ergonomics"]}},
    {"inputs": {"query": "Why is staying hydrated important for energy?"}, "outputs": {"expected_docs": ["wellness-guide"]}},
    {"inputs": {"query": "How do I recover from sleep debt?"}, "outputs": {"expected_docs": ["sleep-hygiene"]}},
]

# --- Chunking golden cases --------------------------------------------------


def _expected_chunk_count(n_words: int) -> int:
    if n_words <= 300:
        return 1
    return 1 + (n_words - 300 + 249) // 250


def _word_text(n_words: int) -> str:
    return " ".join(f"word{i}" for i in range(n_words))


CHUNKING_CASES = [
    {"inputs": {"text": _word_text(50)}, "outputs": {"expected_count": _expected_chunk_count(50)}},
    {"inputs": {"text": _word_text(300)}, "outputs": {"expected_count": _expected_chunk_count(300)}},
    {"inputs": {"text": _word_text(310)}, "outputs": {"expected_count": _expected_chunk_count(310)}},
    {"inputs": {"text": _word_text(600)}, "outputs": {"expected_count": _expected_chunk_count(600)}},
    {"inputs": {"text": _word_text(900)}, "outputs": {"expected_count": _expected_chunk_count(900)}},
    {"inputs": {"text": ""}, "outputs": {"expected_count": 1}},
]

# --- Pushing ----------------------------------------------------------------


def push_all_datasets(force: bool = False) -> None:
    client = Client()
    _push(client, TOOL_ROUTING_DATASET, TOOL_ROUTING_CASES, "Agent tool routing + flags", force)
    _push(client, RETRIEVAL_DATASET, RETRIEVAL_CASES, "KB retrieval quality (recall@k / MRR)", force)
    _push(client, CHUNKING_DATASET, CHUNKING_CASES, "Chunking correctness", force)


def _push(client: Client, name: str, cases: list[dict], description: str, force: bool) -> None:
    if client.has_dataset(dataset_name=name):
        if not force:
            print(f"[dataset] {name} already exists (use --force to recreate)")
            return
        client.delete_dataset(dataset_name=name)
        print(f"[dataset] deleted existing {name}")

    client.create_dataset(dataset_name=name, description=description)
    client.create_examples(
        dataset_name=name,
        examples=[{"inputs": c["inputs"], "outputs": c["outputs"]} for c in cases],
    )
    print(f"[dataset] pushed {len(cases)} examples to {name}")
