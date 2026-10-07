"""
CLI launcher for Mini Agent Web API Gateway.
"""

from __future__ import annotations

import asyncio
import sys
from copy import deepcopy

import uvicorn
from uvicorn.config import LOGGING_CONFIG

from server.config import settings

_LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S%z"


def _gateway_logging_config() -> dict:
    """Add local timestamps with UTC offsets to Uvicorn console logs."""
    config = deepcopy(LOGGING_CONFIG)
    config["formatters"]["default"].update(
        fmt="%(asctime)s %(levelprefix)s %(message)s",
        datefmt=_LOG_DATE_FORMAT,
    )
    config["formatters"]["access"].update(
        fmt=(
            "%(asctime)s %(levelprefix)s %(client_addr)s - "
            '"%(request_line)s" %(status_code)s'
        ),
        datefmt=_LOG_DATE_FORMAT,
    )
    return config


def proactor_loop_factory(*, use_subprocess: bool = False) -> asyncio.AbstractEventLoop:
    """Create an event loop that supports child processes on Windows.

    Uvicorn selects a Selector loop for its Windows reload subprocess. The
    gateway itself starts ``mini-agent-app-server`` through asyncio, which
    requires a Proactor loop on Windows.
    """
    if sys.platform == "win32":
        return asyncio.ProactorEventLoop()
    return asyncio.new_event_loop()


# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001, S110
        pass


def run_server() -> None:
    """Run the FastAPI application in production mode (reload=False)."""
    print(
        f"Starting Mini Agent Server on http://{settings.host}:{settings.port} (Production)"
    )
    print(f"Interactive API Docs: http://localhost:{settings.port}/docs")
    uvicorn.run(
        "server.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_config=_gateway_logging_config(),
        timeout_graceful_shutdown=1.0,
    )


def run_server_dev() -> None:
    """Run the FastAPI application in developer mode with auto-reload (reload=True)."""
    print(
        f"Starting Mini Agent Server on http://{settings.host}:{settings.port} (Dev Mode / Auto-Reload)"
    )
    print(f"Interactive API Docs: http://localhost:{settings.port}/docs")
    uvicorn.run(
        "server.app:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        loop="server.main:proactor_loop_factory",
        log_config=_gateway_logging_config(),
        timeout_graceful_shutdown=1.0,
    )


if __name__ == "__main__":
    run_server()
