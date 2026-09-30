from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.session_manager import session_manager


@pytest.mark.asyncio
async def test_web_search_settings_route_forwards_write_only_host_settings(monkeypatch):
    settings = {
        "provider": "exa",
        "deepseekApiKeyConfigured": False,
        "exaApiKeyConfigured": True,
        "kimiApiKeyConfigured": False,
    }
    client = SimpleNamespace(
        get_web_search_settings=AsyncMock(
            return_value={"value": {"settings": settings}}
        ),
        update_web_search_settings=AsyncMock(
            return_value={"value": {"settings": settings}}
        ),
    )

    async def get_client_for_project(project_id):
        assert project_id == "project-1"
        return client

    monkeypatch.setattr(
        session_manager, "get_client_for_project", get_client_for_project
    )
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        response = await http.get(
            "/api/web-search/settings", params={"project_id": "project-1"}
        )
        updated = await http.post(
            "/api/web-search/settings?project_id=project-1",
            json={"provider": "exa", "exaApiKey": "new-key"},
        )

    assert response.status_code == 200
    assert response.json() == {"settings": settings}
    assert "new-key" not in response.text
    assert updated.status_code == 200
    assert updated.json() == {"settings": settings}
    client.update_web_search_settings.assert_awaited_once_with(
        "exa",
        deepseek_api_key=None,
        exa_api_key="new-key",
        kimi_api_key=None,
    )


@pytest.mark.asyncio
async def test_web_search_settings_route_rejects_unknown_fields():
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        response = await http.post(
            "/api/web-search/settings",
            json={"provider": "exa", "secret": "not-accepted"},
        )

    assert response.status_code == 422
