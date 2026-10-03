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


@router.post("/test", summary="Run a bounded search against a configured provider")
async def test_web_search(
    request: dict[str, Any], project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    query = request.get("query")
    provider = request.get("provider")
    if (
        set(request) - {"query", "provider"}
        or not isinstance(query, str)
        or not query.strip()
        or len(query.strip().encode()) > 2000
        or (
            "provider" in request
            and provider is not None
            and (
                not isinstance(provider, str)
                or provider not in {"deepseek", "exa", "kimi"}
            )
        )
    ):
        raise HTTPException(
            status_code=422,
            detail="query must contain 1 to 2000 bytes and provider must be deepseek, exa, kimi, or omitted",
        )
    try:
        client = await session_manager.get_client_for_project(project_id)
        if provider is None:
            result = await client.test_web_search(query.strip())
        else:
            result = await client.test_web_search(query.strip(), provider=provider)
        value = result.get("value", result) if isinstance(result, dict) else {}
        results = value.get("results") if isinstance(value, dict) else None
        result_count = value.get("resultCount") if isinstance(value, dict) else None
        returned_query = value.get("query") if isinstance(value, dict) else None
        if (
            not isinstance(results, list)
            or len(results) > 3
            or type(result_count) is not int
            or result_count != len(results)
            or not isinstance(returned_query, str)
            or returned_query != query.strip()
            or len(returned_query) > 2000
            or any(
                not isinstance(item, dict)
                or not isinstance(item.get("url"), str)
                or len(item["url"]) > 2000
                or not isinstance(item.get("title"), str)
                or len(item["title"]) > 1024
                or not isinstance(item.get("snippet"), str)
                or len(item["snippet"]) > 2560
                for item in results
            )
        ):
            raise HTTPException(
                status_code=502,
                detail="App Server returned an invalid search test result",
            )
        return {
            "query": returned_query,
            "resultCount": result_count,
            "results": results,
        }
    except HTTPException:
        raise
    except AppServerError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    except (KeyError, RuntimeError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=502, detail="Web search test failed") from err
