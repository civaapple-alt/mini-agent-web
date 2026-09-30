"""Host-owned web search settings forwarded through App Server."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError

from server.session_manager import session_manager

router = APIRouter(prefix="/api/web-search", tags=["Web search"])


async def _read(project_id: str | None) -> dict[str, Any]:
    try:
        client = await session_manager.get_client_for_project(project_id)
        result = await client.get_web_search_settings()
        value = result.get("value", result) if isinstance(result, dict) else {}
        settings = value.get("settings") if isinstance(value, dict) else None
        if not isinstance(settings, dict) or "provider" not in settings:
            raise HTTPException(
                status_code=502,
                detail="App Server returned invalid web search settings",
            )
        return {"settings": settings}
    except HTTPException:
        raise
    except AppServerError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except (KeyError, RuntimeError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502, detail="Web search settings request failed"
        ) from err


@router.get("/settings", summary="Read Host-owned web search settings")
async def get_web_search_settings(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    return await _read(project_id)


@router.post("/settings", summary="Update Host-owned web search settings")
async def update_web_search_settings(
    request: dict[str, Any], project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    allowed = {"provider", "deepseekApiKey", "exaApiKey", "kimiApiKey"}
    if set(request) - allowed or not isinstance(request.get("provider"), str):
        raise HTTPException(
            status_code=422,
            detail="provider and supported credential fields are required",
        )
    fields = {key: value for key, value in request.items() if key != "provider"}
    if any(
        not isinstance(value, str) or len(value) > 4096 for value in fields.values()
    ):
        raise HTTPException(
            status_code=422,
            detail="search API keys must be strings of at most 4096 characters",
        )
    try:
        client = await session_manager.get_client_for_project(project_id)
        result = await client.update_web_search_settings(
            request["provider"],
            deepseek_api_key=fields.get("deepseekApiKey"),
            exa_api_key=fields.get("exaApiKey"),
            kimi_api_key=fields.get("kimiApiKey"),
        )
        value = result.get("value", result) if isinstance(result, dict) else {}
        settings = value.get("settings") if isinstance(value, dict) else None
        if not isinstance(settings, dict) or "provider" not in settings:
            raise HTTPException(
                status_code=502,
                detail="App Server returned invalid web search settings",
            )
        return {"settings": settings}
    except HTTPException:
        raise
    except AppServerError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except (KeyError, RuntimeError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502, detail="Web search settings request failed"
        ) from err
