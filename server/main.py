"""
CLI launcher for Mini Agent Web API Gateway.
"""

from __future__ import annotations

import asyncio
import sys

import uvicorn

from server.config import settings


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
        timeout_graceful_shutdown=1.0,
    )


if __name__ == "__main__":
    run_server()
