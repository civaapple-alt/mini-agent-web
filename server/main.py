"""
CLI launcher for Mini Agent Web API Gateway.
"""

from __future__ import annotations

import uvicorn

from server.config import settings


def run_server() -> None:
    """Run the FastAPI application in production mode (reload=False)."""
    print(f"🚀 Starting Mini Agent Server on http://{settings.host}:{settings.port} (Production)")
    print(f"📚 Interactive API Docs: http://localhost:{settings.port}/docs")
    uvicorn.run(
        "server.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


def run_server_dev() -> None:
    """Run the FastAPI application in developer mode with auto-reload (reload=True)."""
    print(f"🛠️ Starting Mini Agent Server on http://{settings.host}:{settings.port} (Dev Mode / Auto-Reload)")
    print(f"📚 Interactive API Docs: http://localhost:{settings.port}/docs")
    uvicorn.run(
        "server.app:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )


if __name__ == "__main__":
    run_server()
