"""
FastAPI Application Entry Point.
Configures CORS, Lifespan lifecycle, API Routes, and Static UI serving.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import settings
from server.routes import agent, threads, world
from server.session_manager import session_manager

logger = logging.getLogger("mini_agent.server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup and shutdown lifecycle."""
    logging.basicConfig(level=logging.INFO)
    logger.info(
        "Starting Mini Agent Web Gateway on %s:%d...", settings.host, settings.port
    )
    await session_manager.start()
    try:
        yield
    finally:
        logger.info("Shutting down Mini Agent Web Gateway...")
        await session_manager.stop()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Mini Agent Web API Gateway",
        description="FastAPI Web Gateway and WebSocket API for Mini Agent Harness",
        version="0.5.0",
        lifespan=lifespan,
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API Routers
    app.include_router(agent.router)
    app.include_router(threads.router)
    app.include_router(world.router)

    # Static UI Serving (prioritize modern React frontend/dist, fallback to web/)
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    static_path = settings.static_dir

    if (frontend_dist / "assets").exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(frontend_dist / "assets")),
            name="assets",
        )

    static_assets_path = static_path / "static"
    if static_assets_path.exists():
        app.mount(
            "/static", StaticFiles(directory=str(static_assets_path)), name="static"
        )

    @app.get("/health", tags=["Health"])
    async def health_check():
        """Service health check."""
        return {
            "status": "healthy",
            "server": "mini-agent-web-gateway",
            "version": "0.5.0",
        }

    @app.get("/", tags=["UI"])
    async def serve_index():
        """Serve Web UI single page app."""
        if (frontend_dist / "index.html").exists():
            return FileResponse(frontend_dist / "index.html")

        index_file = static_path / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {
            "service": "Mini Agent Web Gateway",
            "status": "running",
            "docs": "/docs",
        }

    return app


app = create_app()
