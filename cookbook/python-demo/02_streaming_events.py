"""
Demo 02: Deep Event Stream Inspection
Demonstrates inspecting granular event types including model step lifecycle,
token usage, UTF-8 output truncation, and loop warnings.
"""

import asyncio
import json
from client import MiniAgentClient


async def main():
    print("=== Demo 02: Deep Event Stream Inspection ===")

    async with MiniAgentClient() as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        prompt = "Inspect the current directory, check files, and tell me the project structure."
        print(f"[Prompt]: {prompt}\n")

        async for item in client.stream_turn(prompt):
            if item["type"] != "event":
                continue

            event = item["event"]
            seq = item.get("sequence", 0)

            # Match event variant keys
            for event_type, payload in event.items():
                print(f"[Seq #{seq:02d}] Event: {event_type}")

                if event_type == "model_started":
                    print(f"   Step: {payload.get('step')}")

                elif event_type == "model_responded":
                    usage = payload.get("usage")
                    if usage:
                        print(f"   Usage: prompt_tokens={usage.get('prompt_tokens')}, completion_tokens={usage.get('completion_tokens')}")
                    tool_calls = payload.get("tool_calls", [])
                    if tool_calls:
                        print(f"   Proposed Tools: {[t['name'] for t in tool_calls]}")
                    if payload.get("text"):
                        print(f"   Text Snippet: {payload['text'][:100]}...")

                elif event_type == "tool_finished":
                    print(f"   Tool: {payload.get('name')}, Truncated: {payload.get('truncated')}, Outcome: {payload.get('outcome')}")
                    content_preview = payload.get("content", "")[:120].replace("\n", " ")
                    print(f"   Output Preview: {content_preview}...")

                elif event_type == "turn_finished":
                    print(f"   Final Status: {payload.get('status')}")


if __name__ == "__main__":
    asyncio.run(main())
