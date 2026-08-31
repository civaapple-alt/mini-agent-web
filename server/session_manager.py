"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, and WebSocket/SSE event broadcasting.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, is_dataclass
from typing import Any

from fastapi import WebSocket
from mini_agent import MiniAgentClient

from server.config import settings

logger = logging.getLogger("mini_agent.server")


def to_json_serializable(obj: Any) -> Any:
    """Recursively convert dataclasses and objects into JSON-safe dictionaries."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return {
            k: to_json_serializable(v)
            for k, v in asdict(obj).items()
            if not k.startswith("_")
        }
    if isinstance(obj, dict):
        return {
            k: to_json_serializable(v)
            for k, v in obj.items()
            if k not in ("typed_event", "submission")
        }
    if isinstance(obj, (list, tuple)):
        return [to_json_serializable(v) for v in obj]
    return obj


class SessionManager:
    """Manages the backend MiniAgentClient and frontend connections."""

    def __init__(self) -> None:
        self._client: MiniAgentClient | None = None
        self._active_connections: list[WebSocket] = []
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

    @property
    def client(self) -> MiniAgentClient:
        if self._client is None:
            raise RuntimeError(
                "SessionManager is not started. MiniAgentClient is None."
            )
        return self._client

    async def start(self) -> None:
        """Start and initialize the background MiniAgentClient."""
        async with self._lock:
            if self._client is not None:
                return

            self._client = MiniAgentClient(
                log_dir=settings.log_dir,
                approval_handler=self._handle_approval_request,
            )
            await self._client.__aenter__()
            init_res = await self._client.initialize(profile=settings.profile)
            logger.info(
                "MiniAgentClient initialized successfully: %s v%s",
                init_res.get("serverName"),
                init_res.get("serverVersion"),
            )
            self._initialized = True

    async def stop(self) -> None:
        """Stop the background MiniAgentClient."""
        async with self._lock:
            if self._client is not None:
                # Cancel any pending approval futures
                for fut in self._pending_approvals.values():
                    if not fut.done():
                        fut.cancel()
                self._pending_approvals.clear()

                await self._client.__aexit__(None, None, None)
                self._client = None
                self._initialized = False
                logger.info("MiniAgentClient terminated cleanly.")

    # -------------------------------------------------------------------------
    # Approval Handshake Management
    # -------------------------------------------------------------------------

    async def _handle_approval_request(self, req: dict[str, Any]) -> dict[str, Any]:
        """
        Called asynchronously by MiniAgentClient when the App Server encounters
        a sensitive tool invocation requiring human approval.
        """
        req_id = str(
            req.get("id") or req.get("actionId") or req.get("requestId", "req")
        )
        logger.info("Approval requested by server: %s", req)

        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending_approvals[req_id] = future

        # Broadcast approval request to all connected UI clients
        payload = {
            "type": "approval_request",
            "requestId": req_id,
            "data": req,
        }
        await self.broadcast_ws(payload)

        try:
            # Wait for human response from web UI (max 10 minutes timeout)
            decision = await asyncio.wait_for(future, timeout=600.0)
            logger.info("Approval resolved for %s: %s", req_id, decision)
            return decision
        except (asyncio.TimeoutError, asyncio.CancelledError):
            logger.warning("Approval request %s timed out or was cancelled", req_id)
            return {
                "decision": "denied",
                "reason": "Approval request timed out or cancelled",
            }
        finally:
            self._pending_approvals.pop(req_id, None)

    def resolve_approval(
        self, request_id: str, decision: str, reason: str | None = None
    ) -> bool:
        """Resolve a pending approval future with human decision."""
        fut = self._pending_approvals.get(request_id)
        if fut and not fut.done():
            fut.set_result(
                {
                    "decision": decision,
                    "reason": reason or "",
                }
            )
            return True
        return False

    def list_pending_approvals(self) -> list[str]:
        return list(self._pending_approvals.keys())

    # -------------------------------------------------------------------------
    # WebSocket Connection Management
    # -------------------------------------------------------------------------

    async def connect_ws(self, websocket: WebSocket) -> None:
        """Register a new WebSocket client."""
        await websocket.accept()
        self._active_connections.append(websocket)
        logger.debug(
            "WebSocket client connected. Total clients: %d",
            len(self._active_connections),
        )

    def disconnect_ws(self, websocket: WebSocket) -> None:
        """Unregister a WebSocket client."""
        if websocket in self._active_connections:
            self._active_connections.remove(websocket)
            logger.debug(
                "WebSocket client disconnected. Remaining: %d",
                len(self._active_connections),
            )

    async def broadcast_ws(self, message: dict[str, Any]) -> None:
        """Broadcast JSON payload to all connected WebSockets."""
        safe_message = to_json_serializable(message)
        disconnected = []
        for ws in self._active_connections:
            try:
                await ws.send_json(safe_message)
            except Exception:  # noqa: BLE001
                disconnected.append(ws)

        for ws in disconnected:
            self.disconnect_ws(ws)


# Global singleton instance
session_manager = SessionManager()
