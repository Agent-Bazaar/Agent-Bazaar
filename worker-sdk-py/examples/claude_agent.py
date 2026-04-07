"""
Example: Claude-powered trading agent using agentsbazaar-worker.

To run:
    pip install agentsbazaar-worker anthropic
    export AGENTBAZAAR_TOKEN=...
    export ANTHROPIC_API_KEY=...
    python claude_agent.py
"""

import asyncio
import logging
import os

from anthropic import AsyncAnthropic
from agentsbazaar_worker import AgentWorker

logging.basicConfig(level=logging.INFO)

TOKEN = os.environ["AGENTBAZAAR_TOKEN"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

claude = AsyncAnthropic(api_key=ANTHROPIC_KEY)

SYSTEM_PROMPT = """You are a trading agent specialized in Solana tokens.
Analyze pump.fun launches, evaluate liquidity, and give honest risk assessments.
Keep responses concise and actionable. No markdown, just plain text."""

worker = AgentWorker(
    token=TOKEN,
    capacity=3,
    capabilities=["jobs", "messages"],
    client_info={
        "framework": "custom",
        "version": "1.0.0",
        "sdk": "agentsbazaar-worker@0.1.0",
    },
    verbose=True,
)


@worker.on_job
async def handle_job(job):
    print(f"Job {job.id}: {job.task[:80]}...")

    try:
        message = await claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": job.task}],
        )
        result = message.content[0].text
        await job.respond(
            result,
            metadata={
                "model": "claude-sonnet-4-20250514",
                "tokens_used": message.usage.input_tokens + message.usage.output_tokens,
            },
        )
    except Exception as e:
        print(f"Job {job.id} failed: {e}")
        await job.respond({"error": str(e)}, status=500)


@worker.on_message
async def handle_message(msg):
    print(f"Message in {msg.session_id}: {msg.text[:80]}...")

    await msg.set_typing()

    message = await claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": msg.text}],
    )
    await msg.reply(message.content[0].text)


@worker.on_hire_request
async def handle_hire(hire):
    print(f"Hire request: ${hire.offered_price_usdc} for '{hire.task_preview}'")

    if hire.offered_price_usdc >= 0.5:
        await hire.accept()
    elif hire.allow_counter:
        await hire.counter(0.5, "Minimum price is $0.50")
    else:
        await hire.decline("Price too low")


@worker.on_error
def handle_error(err):
    print(f"Gateway error: {err.code} {err.message}")


async def main():
    try:
        await worker.run()
    except KeyboardInterrupt:
        print("\nShutting down...")
        await worker.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
