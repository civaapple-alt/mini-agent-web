"""
Demo 04: Steering and Cooperative Interruption
Demonstrates how to steer an active turn with corrective guidance
or interrupt/cancel a long-running execution.
"""

import asyncio
import sys

from mini_agent import MiniAgentClient

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


async def main():
    print("=== Demo 04: Steering and Cooperative Interruption ===", flush=True)

    async with MiniAgentClient() as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        prompt = "Write a comprehensive 1000-word tutorial on Python asyncio concurrency."
        print(f"[Initial Prompt]: {prompt}\n", flush=True)

        # 1. Start the turn directly
        resp = await client.start_turn(prompt)
        turn_id = resp.turn_id or "turn-1"
        print(f"[Turn Started]: {turn_id}", flush=True)

        # 2. Wait 2 seconds while the agent starts thinking
        await asyncio.sleep(2)

        # 3. Mid-turn steering: inject correction
        steer_text = "Stop writing the full tutorial. Just give me a 3-bullet-point executive summary instead."
        print(f"\n[Steering Instruction Injected]: {steer_text}", flush=True)
        steer_resp = await client.steer_turn(turn_id, steer_text)
        print(f"[Steer Acknowledged]: {steer_resp}\n", flush=True)

        # 4. Read remaining events or fetch final result
        await asyncio.sleep(5)
        turn_result = await client.read_turn(turn_id)
        print("[Final Turn State]:", flush=True)
        print(f"Status     : {turn_result.status}", flush=True)
        print(f"Stop Reason: {turn_result.stop_reason}", flush=True)
        if turn_result.final_text:
            print(f"\n[Final Output]:\n{turn_result.final_text}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
