from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.session_manager import session_manager


@pytest.mark.asyncio
async def test_workflow_state_projects_host_enabled_web_fetch(monkeypatch):
    selected_tools = [
        "read_file",
        "apply_patch",
        "shell",
        "read_image",
        "web_fetch",
        "scheduled_task",
        "ask_user",
    ]
    workflow = SimpleNamespace(
        goal=None,
        raw={"value": {"builtinTools": selected_tools}},
        builtin_tools=selected_tools,
        collaboration_mode=SimpleNamespace(mode="default"),
        continuation_mode="manual",
        state_revision=1,
    )
    client = SimpleNamespace(get_workflow_state=AsyncMock(return_value=workflow))

    monkeypatch.setattr(
        session_manager,
        "read_any_project_thread",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        session_manager,
        "builtin_tools_for_thread",
        lambda *_args, **_kwargs: None,
    )

    async def get_client_for_thread(thread_id, project_id=None):
        assert thread_id == "thread-1"
        assert project_id is None
        return client

    monkeypatch.setattr(session_manager, "get_client_for_thread", get_client_for_thread)
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        response = await http.get(
            "/api/workflows/state", params={"thread_id": "thread-1"}
        )

    assert response.status_code == 200
    assert response.json()["builtin_tools"] == selected_tools
    assert "ask_user" in response.json()["available_builtin_tools"]
    client.get_workflow_state.assert_awaited_once_with(thread_id="thread-1")
