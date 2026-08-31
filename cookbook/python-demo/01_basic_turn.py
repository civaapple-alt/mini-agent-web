"""
Demo 01: Basic Turn Execution
Demonstrates connecting to mini-agent-app-server, initializing, and executing a single turn.
"""

import asyncio

from client import MiniAgentClient


async def main():
    print("=== Demo 01: Basic Turn Execution ===")

    # 1. Start client (automatically finds mini-agent-app-server on PATH)
    async with MiniAgentClient() as client:
        # 2. Negotiate protocol and initialize
        init_result = await client.initialize(
            profile="interactive",
            client_name="python-basic-demo",
        )
        print(f"[OK] Initialized with profile: {init_result.get('profile')}")

        # 3. Start default execution thread
        thread_id = await client.start_thread()
        print(f"[OK] Thread started: {thread_id}")

        # 4. Stream and process turn events
        prompt = "Hello! Please summarize what tools you have available in 2 concise sentences."
        print(f"\n[User Prompt]: {prompt}\n")

        async for item in client.stream_turn(prompt):
            if item["type"] == "_turn_submission":
                raw_data = item.get("data", {})
                val = raw_data.get("value", raw_data) if isinstance(raw_data, dict) else raw_data
                turn_id = (
                    val.get("turn_id")
                    or val.get("turnId")
                    or (val.get("turn_id", {}).get("0") if isinstance(val.get("turn_id"), dict) else None)
                    or "started"
                )
                print(f"[Turn Started] Turn ID: {turn_id}")

            elif item["type"] == "event":
                event = item["event"]

                # Handle model output
                if "model_responded" in event:
                    resp = event["model_responded"]
                    if resp.get("reasoning"):
                        print(f"[Thinking]:\n{resp['reasoning']}\n")
                    if resp.get("text"):
                        print(f"[Assistant Response]:\n{resp['text']}\n")

                # Handle tool execution
                elif "tool_started" in event:
                    call = event["tool_started"]["call"]
                    print(f" -> [Tool Calling]: {call['name']}({call['arguments']})")

                elif "tool_finished" in event:
                    tool_res = event["tool_finished"]
                    status = "ERROR" if tool_res["is_error"] else "OK"
                    print(f" <- [Tool Finished] [{status}]: {tool_res['name']}")

                # Turn finished or failed
                elif "turn_finished" in event:
                    status = event["turn_finished"]["status"]
                    print(f"\n[Turn Finished Status]: {status}")

                elif "run_failed" in event:
                    reason = event["run_failed"].get("reason", event["run_failed"])
                    print(f"\n[Run Failed Reason]: {reason}")


if __name__ == "__main__":
    asyncio.run(main())
