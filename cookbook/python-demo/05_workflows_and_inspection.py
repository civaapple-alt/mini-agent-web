"""
Demo 05: Management, Workflows, and Thread Checkpoints
Demonstrates querying WorldState, toggling Plan Mode (read-only locking),
and reading settled thread checkpoints.
"""

import asyncio
import json
from client import MiniAgentClient


async def main():
    print("=== Demo 05: Workflows and Management APIs ===")

    async with MiniAgentClient() as client:
        # 1. Initialize
        await client.initialize(profile="interactive")
        await client.start_thread()

        # 2. Inspect Environment & World State
        print("\n--- 1. World State ---")
        world = await client.get_world_state()
        print(json.dumps(world, indent=2, ensure_ascii=False))

        # 3. Inspect MCP Servers status
        print("\n--- 2. MCP Status ---")
        mcp = await client.get_mcp_status()
        print(json.dumps(mcp, indent=2, ensure_ascii=False))

        # 4. Toggle Plan Mode (locks workspace mutations)
        print("\n--- 3. Enabling Plan Mode ---")
        plan_resp = await client.set_plan_mode(
            active=True,
            prompt="Drafting high-level architecture before coding.",
        )
        print(f"Plan Mode Set: {plan_resp}")

        # 5. Read Thread Checkpoint
        print("\n--- 4. Settled Thread Checkpoint ---")
        checkpoint = await client.read_thread()
        print(f"Thread ID     : {checkpoint.get('thread_id')}")
        print(f"Status        : {checkpoint.get('status')}")
        print(f"Turn Counter  : {checkpoint.get('next_turn_number')}")
        print(f"Message Count : {len(checkpoint.get('session', {}).get('messages', []))}")


if __name__ == "__main__":
    asyncio.run(main())
