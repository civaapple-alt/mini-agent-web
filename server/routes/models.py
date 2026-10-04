"""Host-owned model catalog management forwarded through App Server."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError

from server.session_manager import session_manager

router = APIRouter(prefix="/api/models", tags=["Models"])

_OPERATIONS = {
    "get",
    "test_connection",
    "upsert_provider",
    "delete_provider",
    "upsert_model",
    "delete_model",
    "set_defaults",
    "set_project_default",
}


async def _manage(
    operation: str, fields: dict[str, Any], project_id: str | None
) -> dict[str, Any]:
    if operation not in _OPERATIONS:
        raise HTTPException(
            status_code=422, detail="Unsupported model catalog operation"
        )
    try:
        client = await session_manager.get_client_for_project(project_id)
        result = await client.manage_model_catalog(operation, **fields)
        value = result.get("value", result) if isinstance(result, dict) else {}
        catalog = value.get("catalog") if isinstance(value, dict) else None
        if not isinstance(catalog, dict):
            raise HTTPException(
                status_code=502, detail="App Server returned an invalid model catalog"
            )
        response = {"catalog": catalog}
        if operation == "test_connection":
            result = value.get("connectionTest") if isinstance(value, dict) else None
            allowed_statuses = {
                "succeeded",
                "invalid_credentials",
                "provider_rejected",
                "timed_out",
                "unreachable",
                "invalid_response",
                "failed",
            }
            if (
                not isinstance(result, dict)
                or result.get("status") not in allowed_statuses
                or not isinstance(result.get("message"), str)
                or len(result["message"]) > 256
            ):
                raise HTTPException(
                    status_code=502,
                    detail="App Server returned an invalid connection test result",
                )
            response["connectionTest"] = {
                "status": result["status"],
                "message": result["message"],
            }
        return response
    except HTTPException:
        raise
    except AppServerError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except (KeyError, RuntimeError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:  # SDK transport and App Server errors cross this boundary.
        raise HTTPException(
            status_code=502, detail="Model settings request failed"
        ) from err


@router.get("", summary="Read the Host-owned model catalog")
async def get_model_catalog(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    return await _manage("get", {}, project_id)


@router.post("/manage", summary="Update the Host-owned model catalog")
async def manage_model_catalog(
    request: dict[str, Any], project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    payload = dict(request)
    operation = payload.pop("operation", None)
    if not isinstance(operation, str):
        raise HTTPException(status_code=422, detail="operation is required")
    return await _manage(operation, payload, project_id)
