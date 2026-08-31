"""
Demo 02: Deep Event Stream Inspection
Demonstrates inspecting granular event types including model step lifecycle,
token usage, UTF-8 output truncation, and loop warnings.
"""

import asyncio
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
            event_type = event.get("type", "unknown")

            print(f"[Seq #{seq:02d}] Event: {event_type}")

            if event_type == "model_started":
                print(f"   Step: {event.get('step')}")

            elif event_type == "assistant_reasoning_delta":
                delta = event.get("delta", "").replace("\n", " ")
                if delta:
                    print(f"   Thinking Delta: {delta[:60]}")

            elif event_type == "assistant_text_delta":
                delta = event.get("delta", "").replace("\n", " ")
                if delta:
                    print(f"   Text Delta: {delta[:60]}")

            elif event_type == "model_responded":
                usage = event.get("usage")
                if usage:
                    print(
                        f"   Usage: prompt_tokens={usage.get('prompt_tokens')}, "
                        f"completion_tokens={usage.get('completion_tokens')}"
                    )
                tool_calls = event.get("tool_calls", [])
                if tool_calls:
                    print(f"   Proposed Tools: {[t['name'] for t in tool_calls]}")
                if event.get("text"):
                    print(f"   Text Snippet: {event['text'][:100]}...")

            elif event_type == "tool_started":
                call = event.get("call", {})
                print(f"   Executing Tool: {call.get('name')} with args: {call.get('arguments')}")

            elif event_type == "tool_finished":
                print(
                    f"   Tool: {event.get('name')}, Truncated: {event.get('truncated')}, "
                    f"Outcome: {event.get('outcome')}"
                )
                content_preview = event.get("content", "")[:120].replace("\n", " ")
                print(f"   Output Preview: {content_preview}...")

            elif event_type == "turn_finished":
                print(f"   Final Status: {event.get('status')}")


if __name__ == "__main__":
    asyncio.run(main())
