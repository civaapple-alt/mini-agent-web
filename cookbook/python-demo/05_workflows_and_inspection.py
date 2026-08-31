"""
Demo 05: Management, Workflows, and Thread Checkpoints
Demonstrates querying WorldState, toggling Plan Mode (read-only locking),
and reading settled thread checkpoints.
"""

import asyncio
import json

from mini_agent import AppServerError, MiniAgentClient


async def main():
    print("=== Demo 05: Workflows and Management APIs ===", flush=True)

    async with MiniAgentClient() as client:
        # 1. Initialize
        init_res = await client.initialize(profile="interactive")
        print(
            f"[OK] Initialized, server: {init_res.get('serverName')} v{init_res.get('serverVersion')}",
            flush=True,
        )
        await client.start_thread()

        # 2. Inspect Environment & World State
        print("\n--- 1. World State ---", flush=True)
        try:
            world = await client.get_world_state()
            print(json.dumps(world, indent=2, ensure_ascii=False), flush=True)
        except AppServerError as err:
            print(f"(world/state not available on this server version: {err})", flush=True)

        # 3. Inspect MCP Servers status
        print("\n--- 2. MCP Status ---", flush=True)
        try:
            mcp = await client.get_mcp_status()
            print(json.dumps(mcp, indent=2, ensure_ascii=False), flush=True)
        except AppServerError as err:
            print(f"(mcp/status not available on this server version: {err})", flush=True)

        # 4. Toggle Plan Mode (locks workspace mutations)
        print("\n--- 3. Enabling Plan Mode ---", flush=True)
        try:
            plan_resp = await client.set_plan_mode(
                active=True,
                prompt="Drafting high-level architecture before coding.",
            )
            print(f"Plan Mode Set: {plan_resp}", flush=True)
        except AppServerError as err:
            print(f"(workflow/plan/set not available on this server version: {err})", flush=True)

        # 5. Read Thread Checkpoint
        print("\n--- 4. Settled Thread Checkpoint ---", flush=True)
        checkpoint = await client.read_thread()
        print(f"Thread ID     : {checkpoint.thread_id}", flush=True)
        print(f"Status        : {checkpoint.status}", flush=True)
        print(f"Turn Counter  : {checkpoint.next_turn_number}", flush=True)
        print(f"Message Count : {len(checkpoint.messages)}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
