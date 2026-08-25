from datetime import datetime
from langchain_core.messages import AIMessage, ToolMessage
from logger import get_logger

logger = get_logger("agent")


async def run_agent(
    provider_key: str,
    model: str,
    api_key: str,
    user: dict,
    system_metrics: dict,
    message: str,
    conversation_history: list,
    include_tool_calls: bool = False,
):
    from agent.graph import create_agent_graph, build_system_prompt
    from services.llm_service import get_llm
    from config.llm_providers import provider_supports_tools

    system_prompt = build_system_prompt(user, system_metrics if system_metrics else None)

    tools_supported = provider_supports_tools(provider_key)
    if not tools_supported:
        system_prompt += "\n\nIMPORTANT: You cannot execute actions or call tools. You can only provide information, advice, and guidance. Do not claim to perform actions you cannot actually do. When a user asks you to check settings, recommend music, or search documents, explain what they should do or provide the information directly."

    initial_messages = [{"role": "system", "content": system_prompt}]
    for msg in (conversation_history or [])[-10:]:
        initial_messages.append({"role": msg.role, "content": msg.content})
    initial_messages.append({"role": "user", "content": message})

    llm = get_llm(provider_key, model, api_key)

    graph = create_agent_graph(
        llm=llm,
        user=user,
        system_metrics=system_metrics if system_metrics else None,
        provider_key=provider_key,
    )

    logger.info("Agent invocation started", model=model, message_length=len(message), history_turns=len(conversation_history or []))
    final_state = await graph.ainvoke(
        {"messages": initial_messages},
        config={"recursion_limit": 10},
    )
    logger.info("Agent invocation completed", model=model, message_count=len(final_state["messages"]))

    ai_response = ""
    recommendations = []
    tools_used = []
    token_usage = {}
    tool_calls = []
    tool_results = []

    for msg in reversed(final_state["messages"]):
        if isinstance(msg, AIMessage) and hasattr(msg, "usage_metadata") and msg.usage_metadata:
            token_usage = {
                "input_tokens": msg.usage_metadata.get("input_tokens", 0),
                "output_tokens": msg.usage_metadata.get("output_tokens", 0),
                "total_tokens": msg.usage_metadata.get("total_tokens", 0),
            }
            break

    for msg in final_state["messages"]:
        if isinstance(msg, AIMessage):
            if msg.content:
                # Gemini native SDK returns content as list of parts
                content = msg.content
                if isinstance(content, list):
                    content = " ".join(
                        part.get("text", "") if isinstance(part, dict) else str(part)
                        for part in content
                    )
                ai_response = content
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name = tc.get("name", "")
                    if tool_name and tool_name not in tools_used:
                        tools_used.append(tool_name)
                    tool_calls.append({
                        "name": tc.get("name", ""),
                        "arguments": tc.get("args", {}) if isinstance(tc.get("args"), dict) else {},
                    })
        if isinstance(msg, ToolMessage):
            try:
                import json
                content = msg.content
                if isinstance(content, str):
                    content = json.loads(content)
                tool_results.append({
                    "name": getattr(msg, "name", ""),
                    "content": content,
                })
                if isinstance(content, dict) and content.get("has_recommendations"):
                    is_auto = content.get("auto_apply", False)
                    for rec in content.get("recommendations", []):
                        recommendations.append({
                            "id": f"{rec['type']}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
                            "type": rec["type"],
                            "title": f"{'Reduce' if rec['action'] == 'decrease' else 'Increase' if rec['action'] == 'increase' else rec['action'].title()} {rec['type'].replace('_', ' ').title()}",
                            "message": rec["reason"],
                            "priority": rec["priority"],
                            "action_type": "auto_execute" if is_auto else "execute",
                            "execute_endpoint": f"agent/execute/{rec['type']}",
                            "execute_params": rec["execute_params"],
                            "created_at": datetime.utcnow().isoformat(),
                        })
                if isinstance(content, dict) and content.get("success") and (content.get("mood") or content.get("query")):
                    is_auto = content.get("auto_play", False)
                    rec = {
                        "id": f"music_{content.get('mood') or 'search'}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
                        "type": "music",
                        "title": f"{content.get('emoji', '\U0001f3b5')} Play {content['label']} Music",
                        "message": content["message"],
                        "priority": 3,
                        "action_type": "auto_play_music" if is_auto else "play_music",
                        "created_at": datetime.utcnow().isoformat(),
                    }
                    if content.get("query"):
                        rec["query"] = content["query"]
                    else:
                        rec["mood"] = content["mood"]
                    recommendations.append(rec)
                if isinstance(content, dict) and content.get("tip") and content.get("auto_apply"):
                    recommendations.append({
                        "id": f"break_{content.get('category', 'general')}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
                        "type": "break_tip",
                        "title": f"Configure Break: {content['tip']}",
                        "message": content.get("instruction", ""),
                        "priority": 3,
                        "action_type": "auto_configure_breaks",
                        "tip": content,
                        "created_at": datetime.utcnow().isoformat(),
                    })
            except Exception:
                pass

    if not ai_response:
        ai_response = "I'm here to help you stay well! What's on your mind?"

    # Build thinking steps from the message chain
    thinking_steps = []
    for msg in final_state["messages"]:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            for tc in msg.tool_calls:
                name = tc.get("name", "")
                args = tc.get("args", {})
                args_str = ", ".join(f"{k}={v!r}" for k, v in args.items()) if isinstance(args, dict) else ""
                thinking_steps.append({"type": "tool_call", "tool": name, "args": args_str})
        if isinstance(msg, ToolMessage):
            name = getattr(msg, "name", "")
            content = msg.content
            if isinstance(content, str):
                try:
                    import json
                    content = json.loads(content)
                except Exception:
                    pass
            summary = ""
            if isinstance(content, dict):
                summary = content.get("message", content.get("summary", str(content)[:200]))
            else:
                summary = str(content)[:200]
            thinking_steps.append({"type": "tool_result", "tool": name, "summary": summary})

    logger.info(
        "Agent run complete",
        model=model,
        tools_used=tools_used,
        recommendation_count=len(recommendations),
        input_tokens=token_usage.get("input_tokens", 0),
        output_tokens=token_usage.get("output_tokens", 0),
        total_tokens=token_usage.get("total_tokens", 0),
    )

    if include_tool_calls:
        return ai_response, recommendations, tools_used, token_usage, tool_calls, tool_results, thinking_steps

    return ai_response, recommendations, tools_used, token_usage, thinking_steps
