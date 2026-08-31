"""
Demo 05: Management, Workflows, and Thread Checkpoints
Demonstrates querying WorldState, thread lifecycle & forking, toggling
Plan Mode (read-only locking), and managing multi-milestone Goal workflows.
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

        # 5. Toggle Plan Mode (locks workspace mutations)
        print("\n--- 4. Enabling Plan Mode ---", flush=True)
        try:
            plan_resp = await client.set_plan_mode(
                active=True,
                prompt="Drafting high-level architecture before coding.",
            )
            print(f"Plan Mode Active: {plan_resp.plan_active}", flush=True)
        except AppServerError as err:
            print(f"(workflow/plan/set error: {err})", flush=True)

        # 6. Multi-Milestone Goal Workflow
        print("\n--- 5. Multi-Milestone Goal Workflow ---", flush=True)
        try:
            goal_res = await client.start_goal(
                "Implement High-Performance Caching Layer"
            )
            print(f"Goal ID       : {goal_res.goal_id}", flush=True)
            print(f"Goal Status   : {goal_res.status}", flush=True)
            print(
                f"Milestones    : {goal_res.current_milestone}/{goal_res.total_milestones}",
                flush=True,
            )

            criteria = await client.get_goal_criteria()
            print(
                f"Criteria Lines: {len(criteria.splitlines())} lines retrieved",
                flush=True,
            )

            paused = await client.pause_goal()
            print(f"Paused Goal   : {paused.status}", flush=True)
        except AppServerError as err:
            print(f"(goal workflow error: {err})", flush=True)

        print("\n=== Demo 05 Completed Successfully ===", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
