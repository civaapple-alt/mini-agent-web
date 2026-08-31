"""
Automated pytest suite for Mini Agent Python SDK advanced APIs.
"""

import pytest
from mini_agent import MiniAgentClient, ThreadCheckpoint


@pytest.mark.asyncio
async def test_advanced_thread_and_workflow_apis():
    async with MiniAgentClient(log_dir="logs") as client:
        # 1. Initialize
        init_res = await client.initialize(profile="interactive")
        assert init_res.get("protocolVersion") == 1

        # 2. Thread lifecycle
        tid1 = await client.start_thread("thread-main")
        assert tid1 == "thread-main"

        # List threads
        thread_list = await client.list_threads()
        assert "thread-main" in thread_list.data

        # Fork thread
        fork_res = await client.fork_thread("thread-main", "thread-forked")
        assert fork_res.thread_id == "thread-forked"

        # Read thread
        cp = await client.read_thread("thread-main")
        assert isinstance(cp, ThreadCheckpoint)
        assert cp.thread_id == "thread-main"

        # Close thread
        closed = await client.close_thread("thread-forked")
        assert closed is True

        # 3. Workflows: Plan Mode
        wf_state = await client.get_workflow_state()
        assert isinstance(wf_state.plan_active, bool)

        plan_res = await client.set_plan_mode(active=True, prompt="Test plan prompt")
        assert plan_res.plan_active is True

        plan_off = await client.set_plan_mode(active=False)
        assert plan_off.plan_active is False

        # 4. Workflows: Goal Mode
        goal_res = await client.start_goal("Build a resilient distributed cache")
        assert goal_res.status == "running"

        criteria = await client.get_goal_criteria()
        assert isinstance(criteria, str)

        paused_goal = await client.pause_goal()
        assert paused_goal.status == "user_paused"

        failed_goal = await client.fail_goal()
        assert failed_goal.status == "failed"

        # 5. World Governance & MCP
        world = await client.get_world_state()
        assert hasattr(world, "context") and bool(world.context)

        refresh_res = await client.refresh_world()
        assert hasattr(refresh_res, "changed")

        exec_res = await client.set_world_execution(approval="interactive", copilot=False)
        assert hasattr(exec_res, "changed")

        mcp_res = await client.get_mcp_status()
        assert hasattr(mcp_res, "tool_count")

        mcp_retry = await client.retry_mcp()
        assert hasattr(mcp_retry, "tool_count")

        # 6. Session Info (None in ephemeral mode or SessionInfo when session database is active)
        session_info = await client.get_session_info()
        assert session_info is None or hasattr(session_info, "session_id")
