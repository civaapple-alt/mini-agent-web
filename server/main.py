"""
CLI launcher for Mini Agent Web API Gateway.
"""

from __future__ import annotations

import uvicorn

from server.config import settings


def run_server() -> None:
    """Run the FastAPI application with uvicorn."""
    print(
        f"🚀 Starting Mini Agent Web Gateway on http://{settings.host}:{settings.port}"
    )
    print(f"📚 Interactive API Docs available at http://localhost:{settings.port}/docs")
    uvicorn.run(
        "server.app:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run_server()
