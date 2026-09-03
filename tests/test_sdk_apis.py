"""
Automated pytest suite for Mini Agent Python SDK advanced APIs.
"""

import pytest
from mini_agent import MiniAgentClient, ThreadCheckpoint


@pytest.mark.asyncio
async def test_advanced_thread_and_workflow_apis():
    async with MiniAgentClient(log_dir="logs") as client:
        # 1. Initialize
        init_res = await client.initialize()
        assert init_res.get("protocolVersion") == 1
        assert init_res.get("serverVersion") == "0.7.0"

        # 2. Thread lifecycle
        tid1 = await client.start_thread()
        assert tid1 == "default"

        # List threads
        thread_list = await client.list_threads()
        assert "default" in thread_list.data

        # Fork thread
        fork_res = await client.fork_thread("default", "thread-forked")
        assert fork_res.thread_id == "thread-forked"

        # Read thread
        cp = await client.read_thread("default")
        assert isinstance(cp, ThreadCheckpoint)
        assert cp.thread_id == "default"

        # Close thread
        closed = await client.close_thread("thread-forked")
        assert closed is True

        wf_state = await client.get_workflow_state()
        assert wf_state.collaboration_mode.mode in ("default", "plan")
        assert hasattr(wf_state, "builtin_tools")
        assert wf_state.builtin_tools == [
            "read_file",
            "apply_patch",
            "shell",
            "read_image",
        ]

        plan_res = await client.update_thread_settings(
            "plan", builtin_tools=["read_file", "shell"]
        )
        assert plan_res.collaboration_mode.mode == "plan"
        assert "read_file" in plan_res.builtin_tools

        empty_res = await client.update_thread_settings("plan", builtin_tools=[])
        assert empty_res.builtin_tools == []

        plan_off = await client.set_collaboration_mode("default")
        assert plan_off.collaboration_mode.mode == "default"

        # 4. World Governance & MCP
        world = await client.get_world_state()
        assert hasattr(world, "context") and bool(world.context)

        refresh_res = await client.refresh_world()
        assert hasattr(refresh_res, "changed")

        exec_res = await client.set_world_execution(
            access="project", approval="per_action"
        )
        assert hasattr(exec_res, "changed")

        mcp_res = await client.get_mcp_status()
        assert hasattr(mcp_res, "tool_count")

        mcp_retry = await client.retry_mcp()
        assert hasattr(mcp_retry, "tool_count")

        # 6. Session Info (None in ephemeral mode or SessionInfo when session database is active)
        session_info = await client.get_session_info()
        assert session_info is None or hasattr(session_info, "session_id")


@pytest.mark.asyncio
async def test_thread_goal_api_mapping_without_starting_goal_runtime():
    client = MiniAgentClient()
    calls = []
    goal = {
        "threadId": "default",
        "objective": "Build a resilient distributed cache",
        "status": "active",
        "tokenBudget": 4096,
        "tokensUsed": 0,
        "timeUsedSeconds": 0,
        "createdAt": 1,
        "updatedAt": 1,
    }

    async def fake_send(method, params=None):
        calls.append((method, params))
        if method == "thread/goal/set":
            return {"value": {"goal": goal}}
        if method == "thread/goal/get":
            return {"value": {"goal": goal}}
        if method == "thread/goal/clear":
            return {"value": {"cleared": True}}
        raise AssertionError(f"unexpected method: {method}")

    client._send_request = fake_send

    goal_res = await client.set_goal(goal["objective"], token_budget=4096)
    current_goal = await client.get_goal()
    cleared_goal = await client.clear_goal()

    assert goal_res.goal.objective == goal["objective"]
    assert goal_res.goal.token_budget == 4096
    assert current_goal.goal == goal_res.goal
    assert cleared_goal.cleared is True
    assert calls == [
        (
            "thread/goal/set",
            {
                "threadId": "default",
                "objective": goal["objective"],
                "tokenBudget": 4096,
            },
        ),
        ("thread/goal/get", {"threadId": "default"}),
        ("thread/goal/clear", {"threadId": "default"}),
    ]


@pytest.mark.asyncio
async def test_sdk_approval_response_uses_typed_decision():
    async def approval_handler(params):
        assert params["requestId"] == "approval-1"
        assert params["actionSummary"] == "shell"
        assert params["callId"] == "call-1"
        return {"decision": "approve", "access": "project", "approval": "per_action"}

    client = MiniAgentClient(approval_handler=approval_handler)
    calls = []

    async def fake_send(method, params=None):
        calls.append((method, params))
        return {"accepted": True}

    client._send_request = fake_send

    await client._handle_approval_request(
        {
            "requestId": "approval-1",
            "actionSummary": "shell",
            "access": "project",
            "allowedApprovalModes": ["per_action"],
            "threadId": "thread-1",
            "turnId": "turn-1",
            "callId": "call-1",
        }
    )

    assert calls == [
        (
            "approval/respond",
            {
                "requestId": "approval-1",
                "decision": "approve",
                "access": "project",
                "approval": "per_action",
            },
        )
    ]
