"""
FastAPI Application Entry Point.
Configures CORS, Lifespan lifecycle, API Routes, and Static UI serving.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import settings
from server.routes import agent, threads, world
from server.routes import settings as settings_route
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
        version="0.6.0",
        lifespan=lifespan,
    )

    # Configure CORS (allow_origin_regex ensures WebSocket handshake passes on localhost/127.0.0.1)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API Routers
    app.include_router(agent.router)
    app.include_router(agent.ws_router)
    app.include_router(threads.router)
    app.include_router(world.router)
    app.include_router(settings_route.router)

    # Static UI Serving (React SPA frontend/dist)
    dist_path = settings.frontend_dist

    if (dist_path / "assets").exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(dist_path / "assets")),
            name="assets",
        )

    @app.get("/health", tags=["Health"])
    async def health_check():
        """Service health check."""
        return {
            "status": "healthy",
            "server": "mini-agent-web-gateway",
            "version": "0.6.0",
        }

    @app.get("/", tags=["UI"])
    async def serve_index():
        """Serve React SPA single page app."""
        index_file = dist_path / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {
            "service": "Mini Agent Web Gateway",
            "status": "running",
            "docs": "/docs",
            "frontend_tip": "Run `npm run build` in frontend/ to build the React SPA.",
        }

    return app


app = create_app()
