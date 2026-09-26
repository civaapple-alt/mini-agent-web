"""Project-scoped WebSocket connection registration and broadcasting."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

from server.persistence import to_json_serializable

logger = logging.getLogger("mini_agent.server")
WEBSOCKET_SEND_TIMEOUT_SECONDS = 2.0
WEBSOCKET_CLOSE_TIMEOUT_SECONDS = 0.5


class WebSocketBroker:
    """Route gateway notifications to connections in the same project scope."""

    def __init__(self, owner: Any) -> None:
        self.owner = owner
        self._send_locks: dict[WebSocket, asyncio.Lock] = {}

    async def connect(
        self, websocket: WebSocket, project_id: str | None = None
    ) -> None:
        await websocket.accept()
        self.owner._active_connections[websocket] = project_id
        self._send_locks[websocket] = asyncio.Lock()
        logger.debug(
            "WebSocket client connected. Total clients: %d",
            len(self.owner._active_connections),
        )

    def set_project(self, websocket: WebSocket, project_id: str | None) -> None:
        if websocket in self.owner._active_connections:
            self.owner._active_connections[websocket] = project_id

    def disconnect(self, websocket: WebSocket) -> None:
        self._send_locks.pop(websocket, None)
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
        deliveries: list[tuple[WebSocket, str | None]] = []
        for ws, connection_project in list(self.owner._active_connections.items()):
            if (
                message_project
                and connection_project
                and message_project != connection_project
            ):
                continue
            deliveries.append((ws, connection_project))

        results = await asyncio.gather(
            *(
                self._send_json(ws, safe_message, connection_project)
                for ws, connection_project in deliveries
            ),
            return_exceptions=True,
        )
        disconnected = [
            ws
            for (ws, _), result in zip(deliveries, results, strict=True)
            if result is not True
        ]
        await asyncio.gather(
            *(self._close_slow_connection(ws) for ws in disconnected),
            return_exceptions=True,
        )

    async def _send_json(
        self,
        websocket: WebSocket,
        message: dict[str, Any],
        project_id: str | None,
    ) -> bool:
        lock = self._send_locks.get(websocket)
        if lock is None:
            return False
        try:
            await asyncio.wait_for(
                self._send_locked(websocket, lock, message),
                timeout=WEBSOCKET_SEND_TIMEOUT_SECONDS,
            )
            return True
        except asyncio.TimeoutError:
            logger.warning(
                "Disconnecting slow WebSocket client for project %s after %.1fs",
                project_id or "default",
                WEBSOCKET_SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.debug("WebSocket notification delivery failed", exc_info=True)
        return False

    @staticmethod
    async def _send_locked(
        websocket: WebSocket,
        lock: asyncio.Lock,
        message: dict[str, Any],
    ) -> None:
        async with lock:
            await websocket.send_json(message)

    async def _close_slow_connection(self, websocket: WebSocket) -> None:
        if websocket not in self.owner._active_connections:
            return
        self.disconnect(websocket)
        try:
            await asyncio.wait_for(
                websocket.close(code=1013, reason="Notification client is too slow"),
                timeout=WEBSOCKET_CLOSE_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.debug("Unable to close disconnected WebSocket", exc_info=True)
