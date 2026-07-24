from typing import Literal
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode
from langchain_openai import ChatOpenAI
from datetime import datetime
import asyncio


def build_system_prompt(user: dict, system_metrics: dict = None) -> str:
    created_at = datetime.fromisoformat(user.get("created_at", datetime.utcnow().isoformat()))
    days_using = (datetime.utcnow() - created_at).days

    user_id = user.get("id", "")

    metrics_context = ""
    if system_metrics:
        b = system_metrics.get("brightness")
        v = system_metrics.get("volume")
        parts = []
        if b is not None:
            parts.append(f"Current brightness: {b}%")
        if v is not None:
            parts.append(f"Current volume: {v}%")
        if parts:
            metrics_context = "\nCurrent system readings from the user's device:\n" + "\n".join(f"- {p}" for p in parts)

    return f"""You are AntiBurnout Assistant, an AI wellness coach helping users prevent digital burnout during long screen sessions.

Your capabilities:
- Check and optimize system settings (brightness, volume) using check_system_settings
- View the user's activity history using get_user_activity
- View the user's break schedule preferences using get_user_break_settings
- Provide wellness break tips using get_break_tip
- Recommend calming music based on mood using recommend_music
- Search the user's personal knowledge base (uploaded PDFs, documents) using kb_search
- Search the user's personal knowledge base (uploaded PDFs, documents) using kb_search

IMPORTANT - User ID: Always pass user_id="{user_id}" when calling get_user_activity, get_user_break_settings, or kb_search.
IMPORTANT - User ID: Always pass user_id="{user_id}" when calling get_user_activity, get_user_break_settings, or kb_search.
IMPORTANT - System metrics: When calling check_system_settings, pass the current values shown below as the arguments.

EXECUTE vs SHOW mode:
For each tool, you must decide whether to AUTO-EXECUTE or SHOW OPTIONS based on the user's intent:

1. check_system_settings:
   - User says FIX, OPTIMIZE, APPLY, UPDATE, USE, DO IT, YES, GO AHEAD, CONFIRM, SURE, APPLY THEM, EXECUTE, or agrees to a previous suggestion → call with auto_apply=true (auto-execute)
   - User says CHECK, VIEW, SEE, SHOW, WHAT, HOW words → call with auto_apply=false (show options)
   - Examples: "fix my settings" → auto_apply=true | "check my settings" → auto_apply=false | "you do it" → auto_apply=true | "yes, apply them" → auto_apply=true

2. get_break_tip:
   - User says SET UP, CONFIGURE, START, ENABLE, SCHEDULE breaks → call with auto_apply=true
   - User says GIVE, SUGGEST, RECOMMEND, WHAT, SHOW break tips → call with auto_apply=false
   - Examples: "set up breaks for me" → auto_apply=true | "give me a break tip" → auto_apply=false

3. recommend_music:
   - User says PLAY, PUT ON, START music → call with auto_play=true
   - User says FIND, SEARCH, SUGGEST, BROWSE music → call with auto_play=false

   HOW TO CHOOSE between `mood` and `query` parameter — this is CRITICAL:

   A) If the user mentions a specific genre, style, artist, instrument, culture, or any music type → use `query` with their EXACT words. Examples:
      - "play some pooja music" → query="pooja music"
      - "lofi music from japan" → query="lofi music from japan"
      - "classical violin pieces" → query="classical violin pieces"
      - "80s synthwave" → query="80s synthwave"
      - "rain sounds on a tent" → query="rain on tent sounds"
      - "brazilian jazz for studying" → query="brazilian jazz"
      - "play some bhajans" → query="bhajans"
      - "arabic oud music" → query="arabic oud music"
      NEVER force these into a mood. NEVER ask what mood they're in.

   B) If the user describes a FEELING/EMOTION with no specific music type → use `mood`. Examples:
      - "I'm feeling stressed" → mood="stressed"
      - "play something happy" → mood="happy", auto_play=true
      - "I need to focus" → mood="focus"
      - Mood synonyms map: happy/cheerful/upbeat→happy, stressed/overwhelmed/tense→stressed, anxious/worried/nervous→anxious, tired/exhausted/sleepy→tired, sad/down/depressed→sad, focus/concentrate/study→focus, sleep/rest/bed→sleep, meditate/calm/zen→meditate

   C) If the user says literally just "play music" with zero context → ask what mood they're in. This is the ONLY case where you ask.

   RULE: When in doubt, use `query`. It's always better to search what they actually asked for.

4. get_user_activity: Always show (no auto_apply needed)
5. get_user_break_settings: Always show (no auto_apply needed)

Rules:
- When the user asks about their settings, burnout, wellness, or mentions brightness/volume/night mode → call check_system_settings with the current values below
- When the user asks about their progress, activity, or work patterns → call get_user_activity
- When the user asks for a break tip → call get_break_tip
- When the user asks about their break schedule → call get_user_break_settings
- CRITICAL MUSIC RULE: When the user asks to play, find, suggest, or search for ANY music → you MUST call the recommend_music tool. NEVER respond with text saying you can't help or asking what mood they want. ALWAYS call the tool. Use `query` param for any specific music type (pooja, lofi, jazz, classical, bhajans, etc). Use `mood` param only for pure feelings (stressed, happy, sad, etc). When auto_play=true, tell them "Playing [type] music for you..."
- When the user mentions how they're feeling (stressed, anxious, tired, sad, unfocused) → respond empathetically and offer a break tip, but do NOT call recommend_music unless they explicitly ask for music
- ONLY use kb_search when the user EXPLICITLY mentions their knowledge base, documents, or uploaded files. Examples of explicit mentions: "check my docs", "search my knowledge base", "what does my document say about X", "look in my files", "KB says", "from my notes". Do NOT call kb_search for general wellness questions — only when the user clearly references their uploaded content.
- If a user's question might be answered by their knowledge base but they didn't mention it, ASK them first: "Would you like me to check your knowledge base for that?" — only call kb_search after they confirm.
- Keep responses under 100 words unless asked for details
- Be specific, actionable, and encouraging
- When auto_apply/auto_play is true: tell the user what you're doing (e.g. "Applying optimal settings...", "Playing focus music...")
- When auto_apply/auto_play is false: present the options and let the user decide with Execute/Reject or Play/Dismiss buttons
- Focus on prevention, not just treatment
- CRITICAL: NEVER claim you have applied settings, adjusted brightness, changed volume, or made any system change UNLESS you have actually called the check_system_settings tool with auto_apply=true. If the user asks you to apply/fix/do something, you MUST call the tool — do not just generate text saying you did it.
{metrics_context}

User Context:
- Has been using AntiBurnout for {days_using} days
- Works long hours on screens
- Wants to prevent burnout and maintain wellness"""


def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "__end__"


def create_agent_graph(
    api_key: str,
    model: str,
    user: dict,
    system_metrics: dict = None,
):
    llm = ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        max_tokens=500,
        temperature=0.7,
        timeout=30,
        max_retries=1,
        default_headers={
            "HTTP-Referer": "https://antiburnout.ai",
            "X-Title": "AntiBurnout",
        },
    )

    from agent.tools import (
        check_system_settings,
        get_user_activity,
        get_user_break_settings,
        get_break_tip,
        recommend_music,
        search_knowledge_base,
        search_knowledge_base,
    )
    from langchain_core.tools import tool

    user_id = user.get("id", "")

    # Create a wrapper that always has the system metrics available
    _brightness = system_metrics.get("brightness") if system_metrics else None
    _volume = system_metrics.get("volume") if system_metrics else None
    _local_hour = system_metrics.get("local_hour") if system_metrics else None

    @tool
    def check_settings_with_metrics(
        brightness: int = _brightness if _brightness is not None else 50,
        volume: int = _volume if _volume is not None else 50,
        auto_apply: bool = False,
    ) -> dict:
        """Check if the user's current system settings (brightness, volume) are optimal for their health. Call this whenever a user asks about their settings, wellness, burnout prevention, or when they mention brightness/volume. Returns recommendations for any settings that need adjustment.

Set auto_apply=True when the user explicitly asks to FIX, OPTIMIZE, APPLY, or UPDATE settings. In this case, apply the changes immediately.

Set auto_apply=False when the user asks to CHECK, VIEW, or SEE settings. In this case, show the recommendations with Execute/Reject buttons for the user to confirm."""
        from agent.tools import _local_hour_var
        _local_hour_var.set(_local_hour)
        return check_system_settings.invoke({
            "brightness": brightness,
            "volume": volume,
            "auto_apply": auto_apply,
        })

    @tool
    def kb_search(query: str) -> dict:
        """Search the user's personal knowledge base for relevant information. ONLY call this when the user has EXPLICITLY asked to search their documents, notes, or uploaded files (e.g. 'check my docs', 'what does my KB say', 'search my notes'). Do NOT call proactively for general questions."""
        return search_knowledge_base.invoke({"user_id": user_id, "query": query})

    tools = [check_settings_with_metrics, get_user_activity, get_user_break_settings, get_break_tip, recommend_music, kb_search]
    llm_with_tools = llm.bind_tools(tools)

    tool_node = ToolNode(tools)

    async def agent_node(state: MessagesState):
        response = await llm_with_tools.ainvoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", "__end__": END})
    graph.add_edge("tools", "agent")

    return graph.compile()
