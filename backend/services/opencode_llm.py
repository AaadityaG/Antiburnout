import json
from typing import Any, Dict, List, Optional

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatResult

INFERENCE_URL = "https://opencode.ai/inference/openai/v1/chat/completions"
DEFAULT_TIMEOUT = 120.0


def _message_to_dict(message: BaseMessage) -> Dict[str, Any]:
    """Convert a LangChain message into the OpenAI chat-completions format."""
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    if isinstance(message, HumanMessage):
        return {"role": "user", "content": message.content}
    if isinstance(message, ToolMessage):
        d: Dict[str, Any] = {
            "role": "tool",
            "content": message.content,
            "tool_call_id": message.tool_call_id,
        }
        if message.name:
            d["name"] = message.name
        return d
    if isinstance(message, AIMessage):
        d: Dict[str, Any] = {"role": "assistant", "content": message.content or ""}
        tool_calls = message.tool_calls
        if tool_calls:
            d["tool_calls"] = [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": json.dumps(tc["args"])},
                }
                for tc in tool_calls
            ]
        return d
    return {"role": "user", "content": str(message.content)}


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, dict) and c.get("type") == "text":
                parts.append(c.get("text", ""))
        return "".join(parts)
    return str(content)


class OpenCodeFreeChatModel(BaseChatModel):
    """LangChain chat model that calls the OpenCode inference API.

    The free models on this endpoint require NO Authorization header — the server
    rejects any Bearer token with 401. The OpenAI SDK always sends a Bearer token,
    so we call the endpoint directly with httpx (same as routers/test_inference.py).
    """

    model: str
    temperature: float = 0.7
    max_tokens: int = 500
    timeout: float = DEFAULT_TIMEOUT

    @property
    def _llm_type(self) -> str:
        return "opencode-free"

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": [_message_to_dict(m) for m in messages],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if stop:
            payload["stop"] = stop

        tools = kwargs.get("tools")
        if tools:
            payload["tools"] = tools

        data = self._post(payload, allow_retry_without_tools=bool(tools))
        return self._parse_response(data)

    def _post(self, payload: Dict[str, Any], allow_retry_without_tools: bool = False) -> Dict[str, Any]:
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    INFERENCE_URL,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            # If the endpoint rejects the `tools` payload, retry without it so the
            # agent still answers (just without tool calls) instead of failing.
            if allow_retry_without_tools and e.response.status_code in (400, 422):
                payload.pop("tools", None)
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        INFERENCE_URL,
                        json=payload,
                        headers={"Content-Type": "application/json"},
                    )
                    response.raise_for_status()
                    return response.json()
            raise RuntimeError(f"OpenCode inference failed: {e}") from e

    def _parse_response(self, data: Dict[str, Any]) -> ChatResult:
        try:
            choice = data["choices"][0]
            raw_message = choice["message"]
        except (KeyError, IndexError) as e:
            raise RuntimeError("OpenCode inference returned an unexpected response") from e

        content = _extract_text(raw_message.get("content", ""))

        kwargs: Dict[str, Any] = {}
        raw_tool_calls = raw_message.get("tool_calls")
        if raw_tool_calls:
            kwargs["tool_calls"] = [
                ToolCall(
                    id=tc.get("id", f"call_{i}"),
                    name=tc["function"]["name"],
                    args=json.loads(tc["function"].get("arguments") or "{}"),
                )
                for i, tc in enumerate(raw_tool_calls)
            ]

        usage = data.get("usage")
        if usage:
            kwargs["usage_metadata"] = {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            }

        message = AIMessage(content=content, **kwargs)
        return ChatResult(generations=[ChatGeneration(message=message)])