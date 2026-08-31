"""
Demo 04: Steering and Cooperative Interruption
Demonstrates how to steer an active turn with corrective guidance
and cooperatively cancel/interrupt a long-running execution.
"""

import asyncio

from mini_agent import MiniAgentClient


async def main():
    print("=== Demo 04: Steering and Cooperative Interruption ===", flush=True)

    async with MiniAgentClient(log_dir="logs") as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        # ---------------------------------------------------------------------
        # Part 1: Mid-Turn Steering
        # ---------------------------------------------------------------------
        prompt1 = "Write a comprehensive 1000-word tutorial on Python asyncio concurrency."
        print("\n--- Part 1: Steering Active Turn ---")
        print(f"[Initial Prompt]: {prompt1}\n", flush=True)

        resp1 = await client.start_turn(prompt1)
        turn_id1 = resp1.turn_id or "turn-1"
        print(f"[Turn 1 Started]: {turn_id1}", flush=True)

        # Let the agent start thinking for 1.5 seconds
        await asyncio.sleep(1.5)

        # Inject runtime steering instruction
        steer_text = "Stop writing the full tutorial. Just give me a 3-bullet-point executive summary instead."
        print(f"\n[Steering Instruction Injected]: {steer_text}", flush=True)
        steer_resp = await client.steer_turn(turn_id1, steer_text)
        print(f"[Steer Acknowledged]: actionId={steer_resp.get('actionId')}\n", flush=True)

        # Wait until turn settles and read result
        print("[Waiting for steered turn to settle...]", flush=True)
        result1 = await client.wait_for_turn(turn_id1)
        print("[Turn 1 Settled]:", flush=True)
        print(f"Status     : {result1.status}", flush=True)
        print(f"Stop Reason: {result1.stop_reason}", flush=True)
        if result1.final_text:
            print(f"\n[Output Preview]:\n{result1.final_text[:300]}...\n", flush=True)

        # ---------------------------------------------------------------------
        # Part 2: Cooperative Turn Interruption (Cancel)
        # ---------------------------------------------------------------------
        prompt2 = "Count from 1 to 1000 and write a paragraph explaining prime factorization for each."
        print("\n--- Part 2: Cooperative Turn Interruption ---")
        print(f"[Initial Prompt]: {prompt2}\n", flush=True)

        resp2 = await client.start_turn(prompt2)
        turn_id2 = resp2.turn_id or "turn-2"
        print(f"[Turn 2 Started]: {turn_id2}", flush=True)

        await asyncio.sleep(1.0)
        print("[Interrupting Turn 2...]", flush=True)
        await client.interrupt_turn(turn_id2)

        print("[Waiting for turn cancellation checkpoint...]", flush=True)
        result2 = await client.wait_for_turn(turn_id2)
        print("[Turn 2 Settled]:", flush=True)
        print(f"Status     : {result2.status}", flush=True)
        print(f"Stop Reason: {result2.stop_reason}", flush=True)
        print("\n=== Demo 04 Completed Successfully ===", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
