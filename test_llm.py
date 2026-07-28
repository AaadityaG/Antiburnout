import requests
import os

API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MODEL = "openai/gpt-4o"  # or "anthropic/claude-sonnet-4", etc.

resp = requests.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": MODEL,
        "messages": [{"role": "user", "content": "Say hello in one word"}],
        "max_tokens": 10,
    },
)
data = resp.json()
print(data)
if "error" in data:
    print("ERROR:", data["error"])
