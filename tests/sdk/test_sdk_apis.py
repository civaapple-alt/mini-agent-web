"""
Automated pytest suite for Mini Agent Python SDK advanced APIs.
"""

from pathlib import Path

import pytest
from mini_agent import (
    MiniAgentClient,
    RuntimeStatus,
    ThreadCheckpoint,
    TurnEventsResult,
)
from mini_agent.errors import ServerProcessError

from tests.conftest import has_app_server


@pytest.mark.skipif(
    not has_app_server(),
    reason="Live SDK test requires mini-agent-app-server binary (set MINI_AGENT_APP_SERVER_PATH)",
)
@pytest.mark.asyncio
async def test_advanced_thread_and_workflow_apis(tmp_path: Path):
    # Workflow files belong to the App Server SessionStore. Keep this live SDK
    # test from exercising the disabled-session cwd fallback and polluting the
    # repository under test.
    async with MiniAgentClient(
        cwd=str(tmp_path),
        env={
            "MINI_AGENT_SESSION_MODE": "new",
            "MINI_AGENT_THREAD_ID": "default",
        },
        log_dir="logs",
    ) as client:
        # 1. Initialize
        init_res = await client.initialize()
        assert init_res.get("protocolVersion") == 1
        assert init_res.get("serverVersion") == "0.8.0"

        # 2. Thread lifecycle
        tid1 = await client.start_thread()
        assert tid1 == "default"

        # List threads
        thread_list = await client.list_threads()
        assert "default" in thread_list.data

        wf_state = await client.get_workflow_state(thread_id="default")
        assert wf_state.collaboration_mode.mode in ("default", "plan")
        assert hasattr(wf_state, "builtin_tools")
        assert wf_state.builtin_tools == [
            "read_file",
            "apply_patch",
            "shell",
            "read_image",
        ]

        plan_res = await client.update_thread_settings(
            "plan", builtin_tools=["read_file", "shell"], thread_id="default"
        )
        assert plan_res.collaboration_mode.mode == "plan"
        assert "read_file" in plan_res.builtin_tools

        empty_res = await client.update_thread_settings(
            "plan", builtin_tools=[], thread_id="default"
        )
        assert empty_res.builtin_tools == []

        plan_off = await client.set_collaboration_mode("default", thread_id="default")
        assert plan_off.collaboration_mode.mode == "default"

        # Read and fork thread history after workflow operations. The App
        # Server binds the workflow service to the initially opened Thread.
        cp = await client.read_thread("default")
        assert isinstance(cp, ThreadCheckpoint)
        assert cp.thread_id == "default"

        fork_res = await client.fork_thread("default", "thread-forked")
        assert fork_res.thread_id == "thread-forked"
        closed = await client.close_thread("thread-forked")
        assert closed is True

        session_fork = await client.fork_session("default", "thread-session-fork")
        assert session_fork.thread_id == "thread-session-fork"
        assert session_fork.session_id
        assert session_fork.parent_session_id
        assert session_fork.context_after_bytes <= session_fork.context_before_bytes

        notebook = await client.write_notebook(
            "architecture.child_session",
            "Child state is independent.",
            importance="high",
            keywords=["child", "checkpoint"],
            evidence=[
                {
                    "kind": "commit",
                    "project": "mini-codex",
                    "commit": "3941fcc",
                    "subject": "feat: implement session notebook and subagent policy",
                    "committedAt": "2026-09-18T10:00:00Z",
                }
            ],
        )
        assert notebook["entries"][0]["importance"] == "high"
        assert notebook["entries"][0]["keywords"] == ["child", "checkpoint"]
        notebook = await client.read_notebook()
        assert notebook["entries"][0]["key"] == "architecture.child_session"
        notebook = await client.forget_notebook("architecture.child_session")
        assert notebook["entries"] == []

        # 4. World Governance & MCP
        world = await client.get_world_state()
        assert hasattr(world, "context") and bool(world.context)

        refresh_res = await client.refresh_world()
        assert hasattr(refresh_res, "changed")

        exec_res = await client.set_world_execution(
            access="project", policy="interactive"
        )
        assert hasattr(exec_res, "changed")

        mcp_res = await client.get_mcp_status()
        assert hasattr(mcp_res, "tool_count")

        mcp_retry = await client.retry_mcp()
        assert hasattr(mcp_retry, "tool_count")

        # 6. Session Info (None in ephemeral mode or SessionInfo when session database is active)
        session_info = await client.get_session_info()
        assert session_info is None or hasattr(session_info, "session_id")

    assert not (tmp_path / "plan").exists()
    assert not (tmp_path / "goal").exists()
    assert not (tmp_path / "plan_mode.json").exists()


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
            return {"value": {"goal": goal}, "stateRevision": 4}
        if method == "thread/goal/get":
            return {"value": {"goal": goal}, "stateRevision": 4}
        if method == "thread/goal/clear":
            return {"value": {"cleared": True}, "stateRevision": 5}
        raise AssertionError(f"unexpected method: {method}")

    client._send_request = fake_send

    goal_res = await client.set_goal(goal["objective"], token_budget=4096)
    current_goal = await client.get_goal()
    cleared_goal = await client.clear_goal()

    assert goal_res.goal.objective == goal["objective"]
    assert goal_res.goal.token_budget == 4096
    assert goal_res.state_revision == 4
    assert current_goal.goal == goal_res.goal
    assert current_goal.state_revision == 4
    assert cleared_goal.cleared is True
    assert cleared_goal.state_revision == 5
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
async def test_sdk_runtime_observation_api_mapping():
    client = MiniAgentClient()
    calls = []

    async def fake_send(method, params=None):
        calls.append((method, params))
        if method == "runtime/status":
            return {
                "phase": "goal_verification",
                "threadId": "thread-1",
                "turnId": "turn-2",
                "operationId": "goal-verification:g-1:9",
                "checkpointSeq": 9,
                "stateRevision": 12,
                "timestampMs": 1234,
            }
        if method == "turn/events":
            return {
                "data": [
                    {
                        "threadId": "thread-1",
                        "sequence": 8,
                        "event": {"type": "run_started"},
                    }
                ],
                "nextCursor": 8,
                "oldestSequence": 1,
                "hasGap": False,
            }
        raise AssertionError(f"unexpected method: {method}")

    client._send_request = fake_send

    status = await client.get_runtime_status("thread-1")
    events = await client.replay_events("thread-1", after_sequence=7, limit=16)

    assert isinstance(status, RuntimeStatus)
    assert status.phase == "goal_verification"
    assert status.operation_id == "goal-verification:g-1:9"
    assert isinstance(events, TurnEventsResult)
    assert events.next_cursor == 8
    assert events.data[0]["sequence"] == 8
    assert calls == [
        ("runtime/status", {"threadId": "thread-1"}),
        (
            "turn/events",
            {"threadId": "thread-1", "afterSequence": 7, "limit": 16},
        ),
    ]


@pytest.mark.asyncio
async def test_sdk_session_fork_api_mapping():
    client = MiniAgentClient()
    calls = []

    async def fake_send(method, params=None):
        calls.append((method, params))
        return {
            "value": {
                "sessionId": "s-child",
                "threadId": "thread-child",
                "path": "sessions/s-child/session.jsonl",
                "parentSessionId": "s-parent",
                "parentCheckpointSeq": 7,
                "sessionBytes": 2048,
                "contextBeforeBytes": 8192,
                "contextAfterBytes": 4096,
                "compacted": True,
                "method": "model_summary",
            }
        }

    client._send_request = fake_send
    result = await client.fork_session("thread-parent", "thread-child")

    assert result.session_id == "s-child"
    assert result.parent_checkpoint_seq == 7
    assert result.context_after_bytes == 4096
    assert result.compacted is True
    assert calls == [
        (
            "session/fork",
            {
                "sourceThreadId": "thread-parent",
                "newThreadId": "thread-child",
                "contextPolicy": "exact",
            },
        )
    ]


@pytest.mark.asyncio
async def test_sdk_approval_response_uses_typed_decision():
    async def approval_handler(params):
        assert params["requestId"] == "approval-1"
        assert params["actionSummary"] == "shell"
        assert params["callId"] == "call-1"
        return {"decision": "approve", "grantScope": "once"}

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
            "allowedGrantScopes": ["once"],
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
                "grantScope": "once",
            },
        )
    ]


@pytest.mark.asyncio
async def test_sdk_request_timeout_cleans_pending_request():
    class FakeStdin:
        def write(self, _data):
            return None

        async def drain(self):
            return None

    class FakeProcess:
        stdin = FakeStdin()
        returncode = None

    client = MiniAgentClient(request_timeout=0.01)
    client._proc = FakeProcess()

    with pytest.raises(ServerProcessError, match="request 'initialize' timed out"):
        await client._send_request("initialize")

    assert client._pending_requests == {}
