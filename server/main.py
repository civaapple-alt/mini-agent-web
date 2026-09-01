"""
CLI launcher for Mini Agent Web API Gateway.
"""

from __future__ import annotations

import sys

import uvicorn

from server.config import settings

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
    )


if __name__ == "__main__":
    run_server()
