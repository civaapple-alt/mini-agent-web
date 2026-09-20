"""Bounded cross-repository scenario for durable child reports and parent wake-up."""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from mini_agent.errors import AppServerError

from server.app import create_app
from server.session_manager import session_manager


@pytest.mark.asyncio
async def test_child_report_reaches_parent_wakeup_and_gateway_projection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Exercise SDK → App Server SessionStore → Gateway wake and /children."""
    executable = os.environ.get("MINI_AGENT_APP_SERVER_PATH")
    if not executable or not Path(executable).is_file():
        pytest.skip("set MINI_AGENT_APP_SERVER_PATH to run the cross-repo scenario")

    project_id = "child-report-scenario"
    parent_thread_id = "scenario-parent"
    child_thread_id = "scenario-child"
    operation_id = f"child:{child_thread_id}"
    wake_key = (project_id, parent_thread_id)
    report_id = "scenario-report-1"
    report_text = "Found the failing branch; checking the caller next."
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(session_manager, "_current_project_id", project_id)
    monkeypatch.setattr(session_manager, "_current_project_path", workspace)
    monkeypatch.setattr(
        session_manager,
        "_projects_registry",
        {
            project_id: {
                "id": project_id,
                "name": project_id,
                "primary_path": str(workspace),
                "access": "project",
                "policy": "interactive",
            }
        },
    )
    thread_metadata_before = dict(session_manager._thread_metadata)
    project_metadata_before = dict(session_manager._thread_metadata_by_project)
    wake_seen_before = session_manager._child_wake_seen.copy()
    wake_pending_before = session_manager._child_wake_pending.get(wake_key)
    wake_deferred_before = session_manager._child_wake_deferred.copy()

    parent = None
    child = None
    try:
        parent = await session_manager.get_client_for_thread(
            parent_thread_id, project_id
        )
        fork = await parent.fork_session(
            parent_thread_id,
            child_thread_id,
            operation_id=operation_id,
            operation_attempt=1,
            operation_prompt="Inspect the failing branch.",
            execution_mode="parallel",
        )
        child = await session_manager.get_client_for_thread(
            child_thread_id, project_id
        )

        # Model an in-flight parent Turn. Reports must be durably recorded and
        # coalesced, but they must neither steer nor start another Turn.
        wake_started = asyncio.Event()
        wake_calls: list[dict[str, object]] = []
        steer_calls: list[dict[str, object]] = []

        async def record_wake(**kwargs: object) -> SimpleNamespace:
            wake_calls.append(kwargs)
            wake_started.set()
            return SimpleNamespace(turn_id="scenario-parent-wake")

        async def record_steer(*args: object, **kwargs: object) -> None:
            steer_calls.append({"args": args, **kwargs})

        monkeypatch.setattr(parent, "start_turn", record_wake)
        monkeypatch.setattr(parent, "steer_turn", record_steer)
        monkeypatch.setattr(parent, "wait_for_turn", _settled_turn)
        session_manager.set_active_turn(
            parent_thread_id, "scenario-parent-active", project_id=project_id
        )

        report_intent = json.dumps(
            {
                "status": "requested",
                "action": "report",
                "parent_thread_id": parent_thread_id,
                "operation_id": operation_id,
                "attempt": 1,
                "report": report_text,
            }
        )
        persisted = asyncio.Event()
        persist_report = session_manager._persist_child_report

        async def observe_persistence(*args: object, **kwargs: object) -> None:
            try:
                await persist_report(*args, **kwargs)
            finally:
                persisted.set()

        monkeypatch.setattr(
            session_manager, "_persist_child_report", observe_persistence
        )
        await session_manager._handle_runtime_notification(
            {
                "type": "event",
                "threadId": child_thread_id,
                "turnId": "scenario-child-turn",
                "event": {
                    "type": "tool_finished",
                    "name": "task_report",
                    "call_id": report_id,
                    "content": report_intent,
                    "is_error": False,
                    "truncated": False,
                },
            },
            project_id,
        )
        await asyncio.wait_for(persisted.wait(), timeout=5)

        active_wake_job = session_manager._child_wake_jobs.get(wake_key)
        if active_wake_job is not None:
            await asyncio.wait_for(active_wake_job, timeout=5)
        else:
            await asyncio.sleep(0)
        assert session_manager.get_active_turn(parent_thread_id, project_id) == (
            "scenario-parent-active"
        )
        assert wake_calls == []
        assert steer_calls == []
        assert session_manager._child_wake_pending[wake_key] == {
            child_thread_id: {
                "status": "report",
                "attempt": 1,
                "child_session_available": True,
            }
        }
        assert wake_key in session_manager._child_wake_deferred

        # Once the existing parent Turn settles, the merged child update starts
        # exactly one marked continuation. The report body stays in SessionStore;
        # the bounded prompt points the parent at task_read instead of copying it.
        session_manager.clear_active_turn(
            parent_thread_id, project_id, "scenario-parent-active"
        )
        await asyncio.wait_for(wake_started.wait(), timeout=5)
        wake_job = session_manager._child_wake_jobs.get(wake_key)
        if wake_job is not None:
            await asyncio.wait_for(wake_job, timeout=5)
        wake_task = session_manager._active_tasks_by_project.get(wake_key)
        if wake_task is not None:
            await asyncio.wait_for(wake_task, timeout=5)
        assert len(wake_calls) == 1
        assert steer_calls == []
        wake_kwargs = wake_calls[0]
        assert wake_kwargs["thread_id"] == parent_thread_id
        assert wake_kwargs["mode"] == "start_if_idle"
        assert wake_kwargs["turn_source"] == "child_wakeup"
        prompt = str(wake_kwargs["prompt"])
        assert child_thread_id in prompt
        assert "task_read" in prompt
        assert "omit after_cursor" in prompt
        assert report_text not in prompt
        assert len(prompt.encode("utf-8")) <= 2048

        # Duplicate delivery reuses the canonical report cursor and JSONL record.
        duplicate = await child.child_task_action(
            child_thread_id,
            parent_thread_id,
            operation_id,
            1,
            "report",
            report=report_text,
            report_id=report_id,
        )
        assert duplicate["status"] == "reported"
        with pytest.raises(AppServerError):
            await child.child_task_action(
                child_thread_id,
                parent_thread_id,
                operation_id,
                2,
                "report",
                report="Stale attempt must not be recorded.",
                report_id="scenario-stale-report",
            )

        child_file = Path(fork.path)
        records = [
            json.loads(line)
            for line in child_file.read_text(encoding="utf-8").splitlines()
        ]
        reports = [record for record in records if record.get("kind") == "child_report"]
        assert len(reports) == 1
        assert reports[0]["report"] == report_text
        assert duplicate["cursor"] == reports[0]["seq"]

        # The public Gateway projection is rebuilt from that same SessionStore data.
        transport = ASGITransport(app=create_app())
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                f"/api/threads/{parent_thread_id}/children",
                params={"project_id": project_id},
            )
        assert response.status_code == 200
        projected = response.json()["children"]
        assert len(projected) == 1
        assert projected[0]["child_thread_id"] == child_thread_id
        assert projected[0]["reports"][-1]["report"] == report_text
        assert projected[0]["child_session_available"] is True
    finally:
        wake_job = session_manager._child_wake_jobs.pop(wake_key, None)
        if wake_job is not None and not wake_job.done():
            wake_job.cancel()
        if wake_job is not None:
            await asyncio.gather(wake_job, return_exceptions=True)
        session_manager._child_wake_pending.pop(wake_key, None)
        active_task = session_manager._active_tasks_by_project.get(wake_key)
        session_manager.cancel_active_task(parent_thread_id, project_id)
        if active_task is not None:
            await asyncio.gather(active_task, return_exceptions=True)
        session_manager.clear_active_turn(parent_thread_id, project_id)
        if wake_pending_before is not None:
            session_manager._child_wake_pending[wake_key] = wake_pending_before
        if wake_deferred_before:
            session_manager._child_wake_deferred.add(wake_key)
        else:
            session_manager._child_wake_deferred.discard(wake_key)
        session_manager._child_wake_seen = wake_seen_before
        shutdown_errors: list[Exception] = []
        for thread_id, client in (
            (child_thread_id, child),
            (parent_thread_id, parent),
        ):
            if client is None:
                continue
            try:
                await client.stop()
            except Exception as error:  # noqa: BLE001
                shutdown_errors.append(error)
            else:
                if session_manager._project_clients.get((project_id, thread_id)) is client:
                    session_manager._project_clients.pop((project_id, thread_id), None)
                if session_manager._clients.get(thread_id) is client:
                    session_manager._clients.pop(thread_id, None)
                    session_manager._client_projects.pop(thread_id, None)
                if session_manager._client is client:
                    session_manager._client = None
                if session_manager._active_thread_projects.get(thread_id) == project_id:
                    session_manager._active_thread_projects.pop(thread_id, None)
        session_manager._thread_metadata.clear()
        session_manager._thread_metadata.update(thread_metadata_before)
        session_manager._thread_metadata_by_project.clear()
        session_manager._thread_metadata_by_project.update(project_metadata_before)
        if shutdown_errors:
            raise RuntimeError("Failed to stop scenario App Server clients") from shutdown_errors[0]


@pytest.mark.asyncio
async def test_completed_child_assign_persists_follow_up_and_starts_same_thread(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Exercise durable completed-child assign without calling a model."""
    executable = os.environ.get("MINI_AGENT_APP_SERVER_PATH")
    if not executable or not Path(executable).is_file():
        pytest.skip("set MINI_AGENT_APP_SERVER_PATH to run the cross-repo scenario")

    project_id = "child-follow-up-scenario"
    parent_thread_id = "scenario-follow-up-parent"
    child_thread_id = "scenario-follow-up-child"
    operation_id = f"child:{child_thread_id}"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(session_manager, "_current_project_id", project_id)
    monkeypatch.setattr(session_manager, "_current_project_path", workspace)
    monkeypatch.setattr(
        session_manager,
        "_projects_registry",
        {
            project_id: {
                "id": project_id,
                "name": project_id,
                "primary_path": str(workspace),
                "access": "project",
                "policy": "interactive",
            }
        },
    )
    thread_metadata_before = dict(session_manager._thread_metadata)
    project_metadata_before = dict(session_manager._thread_metadata_by_project)

    parent = None
    child_client = None
    child_thread_active_turn = None
    try:
        parent = await session_manager.get_client_for_thread(
            parent_thread_id, project_id
        )
        fork = await parent.fork_session(
            parent_thread_id,
            child_thread_id,
            operation_id=operation_id,
            operation_attempt=1,
            operation_prompt="Inspect the original issue.",
            execution_mode="parallel",
        )

        # Seed a settled operation snapshot in the real SessionStore JSONL. The
        # App Server and Gateway then reopen/read and mutate this persisted child;
        # only the terminal model-backed turn/start request is intercepted below.
        child_path = Path(fork.path)
        records = [
            json.loads(line)
            for line in child_path.read_text(encoding="utf-8").splitlines()
        ]
        next_sequence = max(
            (int(record.get("seq", 0)) for record in records), default=0
        ) + 1
        records.append(
            {
                "seq": next_sequence,
                "kind": "operation",
                "operation_id": operation_id,
                "operation_kind": "child_task",
                "status": "completed",
                "parent_thread_id": parent_thread_id,
                "turn_id": "scenario-completed-turn",
                "attempt": 1,
                "attempt_kind": "initial",
                "control_request_id": None,
                "operation_group_id": None,
                "execution_mode": "parallel",
                "group_sequence": None,
                "prompt": "Inspect the original issue.",
                "result": "Original task completed.",
                "error": None,
                "timestamp_ms": time.time_ns() // 1_000_000,
            }
        )
        child_path.write_text(
            "\n".join(json.dumps(record) for record in records) + "\n",
            encoding="utf-8",
        )

        completed_children = await session_manager.list_child_tasks(
            parent_thread_id, project_id
        )
        assert len(completed_children) == 1
        assert completed_children[0]["status"] == "completed"
        assert completed_children[0]["operation_attempt"] == 1

        request_id = "scenario-parent-turn:tool-follow-up-1"
        start_calls: list[dict[str, object]] = []

        async def record_start_turn(**kwargs: object) -> SimpleNamespace:
            nonlocal child_thread_active_turn
            start_calls.append(kwargs)
            child_thread_active_turn = "scenario-follow-up-turn"
            return SimpleNamespace(turn_id="scenario-follow-up-turn")

        get_client = session_manager.get_client_for_thread

        async def get_client_with_terminal_seam(
            thread_id: str | None = None, requested_project_id: str | None = None
        ):
            nonlocal child_client
            child_client = await get_client(thread_id, requested_project_id)
            if thread_id == child_thread_id:
                child_client.start_turn = record_start_turn
            return child_client

        monkeypatch.setattr(
            session_manager, "get_client_for_thread", get_client_with_terminal_seam
        )
        outcomes: list[dict[str, object]] = []
        monkeypatch.setattr(
            session_manager,
            "_queue_child_control_outcome",
            lambda *_args: outcomes.append(_args[-1]),
        )
        reconcile_queue = session_manager._drain_child_queue
        defer_queue_drain = AsyncMock()
        monkeypatch.setattr(session_manager, "_drain_child_queue", defer_queue_drain)

        await session_manager._apply_child_control(
            parent_thread_id,
            {
                "action": "assign",
                "child_thread_id": child_thread_id,
                "operation_id": operation_id,
                "prompt": "Address the review findings in this same session.",
            },
            project_id,
            "scenario-parent-turn",
            request_id,
        )

        assert start_calls == []
        defer_queue_drain.assert_awaited_once_with(parent_thread_id, project_id)
        assert outcomes[-1]["routes"] == [
            {"child_thread_id": child_thread_id, "route": "follow_up_queued"}
        ]

        persisted_records = [
            json.loads(line)
            for line in child_path.read_text(encoding="utf-8").splitlines()
        ]
        persisted_operation = next(
            record
            for record in reversed(persisted_records)
            if record.get("kind") == "operation"
            and record.get("operation_kind") == "child_task"
            and record.get("operation_id") == operation_id
        )
        assert persisted_operation["status"] == "queued"
        assert persisted_operation["attempt"] == 2
        assert persisted_operation["attempt_kind"] == "follow_up"
        assert persisted_operation["control_request_id"] == request_id
        assert persisted_operation["prompt"] == "Address the review findings in this same session."

        # Simulate a child App Server restart after allocation but before the
        # scheduler's terminal turn/start call. Reopen the same Thread/Session
        # from its durable queue and let the real Gateway drain path resume it.
        first_child_client = child_client
        await first_child_client.stop()
        if session_manager._project_clients.get((project_id, child_thread_id)) is first_child_client:
            session_manager._project_clients.pop((project_id, child_thread_id), None)
        if session_manager._clients.get(child_thread_id) is first_child_client:
            session_manager._clients.pop(child_thread_id, None)
            session_manager._client_projects.pop(child_thread_id, None)
        if session_manager._client is first_child_client:
            session_manager._client = None
        if session_manager._active_thread_projects.get(child_thread_id) == project_id:
            session_manager._active_thread_projects.pop(child_thread_id, None)
        child_client = None
        monkeypatch.setattr(session_manager, "_drain_child_queue", reconcile_queue)

        resumed_client = await session_manager.get_client_for_thread(
            child_thread_id, project_id
        )
        assert resumed_client is not first_child_client
        queued_after_restart = await session_manager.list_child_tasks(
            parent_thread_id, project_id
        )
        assert queued_after_restart[0]["status"] == "queued"
        assert queued_after_restart[0]["operation_attempt"] == 2
        assert queued_after_restart[0]["attempt_kind"] == "follow_up"
        assert queued_after_restart[0]["operation_prompt"] == persisted_operation["prompt"]

        await reconcile_queue(parent_thread_id, project_id)

        assert len(start_calls) == 1
        assert start_calls[0]["thread_id"] == child_thread_id
        assert start_calls[0]["operation_id"] == operation_id
        assert start_calls[0]["operation_attempt"] == 2
        assert start_calls[0]["operation_attempt_kind"] == "follow_up"
        assert start_calls[0]["prompt"] == persisted_operation["prompt"]
    finally:
        if child_thread_active_turn:
            session_manager.clear_active_turn(
                child_thread_id, project_id, child_thread_active_turn
            )
        for thread_id, client in (
            (child_thread_id, child_client),
            (parent_thread_id, parent),
        ):
            if client is None:
                continue
            try:
                await client.stop()
            finally:
                if session_manager._project_clients.get((project_id, thread_id)) is client:
                    session_manager._project_clients.pop((project_id, thread_id), None)
                if session_manager._clients.get(thread_id) is client:
                    session_manager._clients.pop(thread_id, None)
                    session_manager._client_projects.pop(thread_id, None)
                if session_manager._client is client:
                    session_manager._client = None
                if session_manager._active_thread_projects.get(thread_id) == project_id:
                    session_manager._active_thread_projects.pop(thread_id, None)
        session_manager._thread_metadata.clear()
        session_manager._thread_metadata.update(thread_metadata_before)
        session_manager._thread_metadata_by_project.clear()
        session_manager._thread_metadata_by_project.update(project_metadata_before)


async def _settled_turn(*_args: object, **_kwargs: object) -> None:
    return None
