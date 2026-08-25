import asyncio
import os

from services.llm_service import get_llm
from langchain_core.messages import HumanMessage


async def main():
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    llm = get_llm("openrouter", "openai/gpt-4o", api_key)
    response = await llm.ainvoke([HumanMessage(content="Say hello in one word")])
    print(response.content)


if __name__ == "__main__":
    asyncio.run(main())
