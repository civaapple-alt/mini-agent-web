"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, WebSocket/SSE broadcasting,
thread metadata caching (titles, summaries), and runtime user settings.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
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
    """Manages the backend MiniAgentClient, frontend connections, and metadata."""

    def __init__(self) -> None:
        self._client: MiniAgentClient | None = None
        self._active_connections: list[WebSocket] = []
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._remembered_approvals: set[str] = set()
        self._lock = asyncio.Lock()
        self._initialized = False

        # In-memory thread metadata store: thread_id -> metadata
        self._thread_metadata: dict[str, dict[str, Any]] = {
            "default": {
                "title": "默认会话 (Default Session)",
                "summary": "Main interactive coding workspace",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "pinned": True,
            }
        }

        # Runtime system settings
        self._settings: dict[str, Any] = {
            "host": settings.host,
            "port": settings.port,
            "profile": settings.profile,
            "approval_policy": "per_action",  # per_action | auto_approve | strict
            "default_mode": "chat",  # chat | plan | goal
            "reasoning_effort": "medium",
            "theme": "light",
            "auto_scroll": True,
            "word_wrap": True,
            "font_size": 13,
        }

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
                log_level=settings.log_level,
                approval_handler=self._handle_approval_request,
            )
            await self._client.__aenter__()
            init_res = await self._client.initialize(profile=self._settings["profile"])
            logger.info(
                "MiniAgentClient initialized successfully: %s v%s",
                init_res.get("serverName"),
                init_res.get("serverVersion"),
            )
            self._initialized = True

    async def stop(self) -> None:
        """Stop the background MiniAgentClient and close WebSocket connections."""
        async with self._lock:
            # 1. Gracefully close active WebSocket connections
            for ws in list(self._active_connections):
                try:
                    await ws.close(code=1001, reason="Server shutting down")
                except Exception:  # noqa: BLE001, S110
                    pass
            self._active_connections.clear()

            # 2. Cancel any pending approval futures
            for fut in self._pending_approvals.values():
                if not fut.done():
                    fut.cancel()
            self._pending_approvals.clear()

            # 3. Terminate MiniAgentClient
            if self._client is not None:
                try:
                    await asyncio.wait_for(self._client.stop(), timeout=3.0)
                except (asyncio.TimeoutError, Exception):  # noqa: BLE001, S110
                    pass
                self._client = None
                self._initialized = False
                logger.info("MiniAgentClient terminated cleanly.")

    # -------------------------------------------------------------------------
    # Thread Metadata Management
    # -------------------------------------------------------------------------

    def get_thread_meta(self, thread_id: str) -> dict[str, Any]:
        """Get metadata for a specific thread."""
        if thread_id not in self._thread_metadata:
            self._thread_metadata[thread_id] = {
                "title": f"会话 {thread_id}",
                "summary": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "pinned": False,
            }
        return self._thread_metadata[thread_id]

    def set_thread_meta(
        self, thread_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Update metadata for a thread."""
        meta = self.get_thread_meta(thread_id)
        meta.update(updates)
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._thread_metadata[thread_id] = meta
        return meta

    def list_all_thread_meta(self) -> dict[str, dict[str, Any]]:
        """Return full thread metadata mapping."""
        return dict(self._thread_metadata)

    # -------------------------------------------------------------------------
    # Settings Management
    # -------------------------------------------------------------------------

    def get_settings(self) -> dict[str, Any]:
        """Get current server & UI settings."""
        return dict(self._settings)

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update system settings."""
        self._settings.update(updates)
        logger.info("Updated system settings: %s", updates)
        return dict(self._settings)

    # -------------------------------------------------------------------------
    # Approval Handshake Management
    # -------------------------------------------------------------------------

    async def _handle_approval_request(
        self, req: dict[str, Any] | str, action: str | None = None
    ) -> dict[str, Any]:
        """
        Called asynchronously by MiniAgentClient when the App Server encounters
        a sensitive tool invocation requiring human approval.
        """
        if isinstance(req, dict):
            req_data = req
            req_id = str(
                req.get("id") or req.get("actionId") or req.get("requestId", "req")
            )
            action_name = str(req.get("action") or req.get("tool") or "")
        else:
            req_data = {"requestId": req, "action": action or ""}
            req_id = str(req)
            action_name = action or ""

        # 1. Policy check: Auto-approve
        policy = self._settings.get("approval_policy", "per_action")
        if policy == "auto_approve":
            logger.info("Policy auto-approved action: %s (%s)", action_name, req_id)
            return {"decision": "approved", "reason": "Auto-approved by policy"}

        # 2. Policy check: Strict deny
        if policy == "strict":
            logger.warning(
                "Policy strictly denied action: %s (%s)", action_name, req_id
            )
            return {"decision": "denied", "reason": "Denied by strict security policy"}

        # 3. Check remembered approvals
        if action_name and action_name in self._remembered_approvals:
            logger.info("Action remembered as approved: %s (%s)", action_name, req_id)
            return {"decision": "approved", "reason": "Remembered user approval"}

        logger.info("Approval requested by server: %s", req_data)

        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending_approvals[req_id] = future

        # Broadcast approval request to all connected UI clients
        payload = {
            "type": "approval_request",
            "requestId": req_id,
            "data": req_data,
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
        self,
        request_id: str,
        decision: str,
        reason: str | None = None,
        remember: bool = False,
        action_name: str | None = None,
    ) -> bool:
        """Resolve a pending approval future with human decision."""
        if remember and action_name and decision.lower() in ("approved", "allow"):
            self._remembered_approvals.add(action_name)

        fut = self._pending_approvals.get(request_id)
        if fut and not fut.done():
            fut.set_result(
                {
                    "decision": decision,
                    "reason": reason or "",
                    "remember": remember,
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
