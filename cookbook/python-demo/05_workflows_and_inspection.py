"""
Demo 05: Management, Thread Settings, Goals, and Checkpoints
Demonstrates querying WorldState, thread lifecycle & forking, updating the
Codex-shaped collaboration mode, and managing a Thread-owned Goal.
"""

import asyncio

from mini_agent import AppServerError, MiniAgentClient


async def main():
    print("=== Demo 05: Workflows and Management APIs ===", flush=True)

    async with MiniAgentClient(log_dir="logs") as client:
        # 1. Initialize
        init_res = await client.initialize(profile="interactive")
        print(
            f"[OK] Initialized, server: {init_res.get('serverName')} v{init_res.get('serverVersion')}",
            flush=True,
        )
        await client.start_thread("main-thread")

        # 2. Thread Lifecycle & Branching
        print("\n--- 1. Thread Lifecycle & Branching ---", flush=True)
        thread_list = await client.list_threads()
        print(f"Active Threads: {thread_list.data}", flush=True)

        fork_res = await client.fork_thread("main-thread", "experiment-branch")
        print(f"Forked Thread : {fork_res.thread_id}", flush=True)

        checkpoint = await client.read_thread("main-thread")
        print(
            f"Main Status   : {checkpoint.status}, Next Turn: {checkpoint.next_turn_number}",
            flush=True,
        )

        closed = await client.close_thread("experiment-branch")
        print(f"Closed Branch : {closed}", flush=True)

        # 3. Inspect Environment & World State
        print("\n--- 2. World State & Governance ---", flush=True)
        try:
            world = await client.get_world_state()
            print(
                f"OS/Arch Shell : {world.status.get('os')} {world.status.get('arch')} ({world.status.get('shell')})",
                flush=True,
            )
            print(
                f"Commands Avail: {len(world.status.get('available_commands', []))} tools detected",
                flush=True,
            )
        except AppServerError as err:
            print(f"(world/state error: {err})", flush=True)

        # 4. Inspect MCP Servers status
        print("\n--- 3. MCP Status ---", flush=True)
        try:
            mcp = await client.get_mcp_status()
            print(f"Enabled Servers : {mcp.enabled_servers}", flush=True)
            print(f"Available Tools : {mcp.tool_count}", flush=True)
        except AppServerError as err:
            print(f"(mcp/status error: {err})", flush=True)

        # 5. Update collaboration mode (locks workspace mutations)
        print("\n--- 4. Enabling Plan Mode ---", flush=True)
        try:
            settings = await client.set_collaboration_mode("plan")
            print(f"Collaboration Mode: {settings.collaboration_mode.mode}", flush=True)
        except AppServerError as err:
            print(f"(thread/settings/update error: {err})", flush=True)

        # 6. Thread-owned Goal Runtime
        print("\n--- 5. Thread Goal Runtime ---", flush=True)
        try:
            goal_res = await client.set_goal(
                objective="Implement High-Performance Caching Layer",
                token_budget=4096,
            )
            goal = goal_res.goal
            print(f"Goal Thread   : {goal.thread_id}", flush=True)
            print(f"Goal Status   : {goal.status}", flush=True)
            print(
                f"Token Budget  : {goal.token_budget or 'unlimited'}",
                flush=True,
            )

            current = await client.get_goal()
            print(
                f"Goal Readback : {current.goal.status if current.goal else 'cleared'}",
                flush=True,
            )
        except AppServerError as err:
            print(f"(thread/goal error: {err})", flush=True)

        print("\n=== Demo 05 Completed Successfully ===", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
