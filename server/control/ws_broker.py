"""Project-scoped WebSocket connection registration and broadcasting."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

from server.persistence import to_json_serializable

logger = logging.getLogger("mini_agent.server")


class WebSocketBroker:
    """Route gateway notifications to connections in the same project scope."""

    def __init__(self, owner: Any) -> None:
        self.owner = owner

    async def connect(
        self, websocket: WebSocket, project_id: str | None = None
    ) -> None:
        await websocket.accept()
        self.owner._active_connections[websocket] = project_id
        logger.debug(
            "WebSocket client connected. Total clients: %d",
            len(self.owner._active_connections),
        )

    def set_project(self, websocket: WebSocket, project_id: str | None) -> None:
        if websocket in self.owner._active_connections:
            self.owner._active_connections[websocket] = project_id

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.owner._active_connections:
            self.owner._active_connections.pop(websocket, None)
            logger.debug(
                "WebSocket client disconnected. Remaining: %d",
                len(self.owner._active_connections),
            )

    async def broadcast(self, message: dict[str, Any]) -> None:
        safe_message = to_json_serializable(message)
        message_data = safe_message.get("data")
        message_project = safe_message.get("projectId") or safe_message.get(
            "project_id"
        )
        if not message_project and isinstance(message_data, dict):
            message_project = message_data.get("projectId") or message_data.get(
                "project_id"
            )
        disconnected: list[WebSocket] = []
        for ws, connection_project in list(self.owner._active_connections.items()):
            if (
                message_project
                and connection_project
                and message_project != connection_project
            ):
                continue
            try:
                await ws.send_json(safe_message)
            except Exception:  # noqa: BLE001
                disconnected.append(ws)

        for ws in disconnected:
            self.disconnect(ws)
