"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, WebSocket/SSE broadcasting,
thread metadata caching (titles, summaries), and runtime user settings.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
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
    """Manages the backend MiniAgentClient, frontend connections, projects, and metadata."""

    def __init__(self) -> None:
        self._client: MiniAgentClient | None = None
        self._active_connections: list[WebSocket] = []
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._remembered_approvals: set[str] = set()
        self._lock = asyncio.Lock()
        self._initialized = False

        # Persistence state file path: ~/.mini-agent/state.json
        self._state_dir = Path.home() / ".mini-agent"
        self._state_file = self._state_dir / "state.json"

        # Structured project registry: project_id -> project dict
        self._current_project_path: Path = Path.cwd().resolve()
        self._current_project_id: str = self._current_project_path.name
        self._projects_registry: dict[str, dict[str, Any]] = {}
        self._thread_metadata: dict[str, dict[str, Any]] = {}

        # Load persisted state or initialize clean default with only the active workspace
        self._load_state()

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

    def _load_state(self) -> None:
        """Load projects and session metadata from persistent JSON file."""
        if self._state_file.is_file():
            try:
                data = json.loads(self._state_file.read_text(encoding="utf-8"))
                self._projects_registry = data.get("projects", {})
                self._thread_metadata = data.get("thread_metadata", {})
                persisted_cur_id = data.get("current_project_id")
                if persisted_cur_id and persisted_cur_id in self._projects_registry:
                    self._current_project_id = persisted_cur_id
                    self._current_project_path = Path(
                        self._projects_registry[persisted_cur_id].get(
                            "primary_path", str(self._current_project_path)
                        )
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning("Failed to parse %s, initializing clean state: %s", self._state_file, err)

        # If no projects exist, initialize ONLY the current active workspace directory
        cur_name = self._current_project_path.name
        if not self._projects_registry:
            self._current_project_id = cur_name
            self._projects_registry = {
                cur_name: {
                    "id": cur_name,
                    "name": cur_name,
                    "pinned": False,
                    "primary_path": str(self._current_project_path),
                    "source_folders": [
                        {
                            "name": cur_name,
                            "path": str(self._current_project_path),
                            "is_primary": True,
                        }
                    ],
                }
            }

        # Ensure default thread exists
        if not self._thread_metadata:
            self._thread_metadata = {
                "default": {
                    "title": "默认会话 (Default Session)",
                    "project": self._current_project_id,
                    "summary": "Main interactive coding workspace",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "pinned": True,
                }
            }
        self._save_state()

    def _save_state(self) -> None:
        """Persist current projects and session metadata to disk."""
        try:
            self._state_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "current_project_id": self._current_project_id,
                "projects": self._projects_registry,
                "thread_metadata": self._thread_metadata,
            }
            self._state_file.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception as err:  # noqa: BLE001
            logger.warning("Failed to persist state to %s: %s", self._state_file, err)

    def get_projects(self) -> dict[str, Any]:
        """Get all projects with active threads summary."""
        projects_list = []
        for p in self._projects_registry.values():
            proj_id = p["id"]
            p_threads = [
                t for t in self._thread_metadata.values() if t.get("project") == proj_id or t.get("project") == p.get("name")
            ]
            projects_list.append(
                {
                    **p,
                    "threads_count": len(p_threads),
                    "active_threads_count": max(1, len(p_threads)),
                }
            )

        cur_proj = self._projects_registry.get(
            self._current_project_id,
            next(iter(self._projects_registry.values())),
        )
        return {
            "current_project": cur_proj,
            "projects": projects_list,
            "recent_projects": projects_list,
        }

    def create_project(
        self,
        name: str,
        path: str | None = None,
        source_folders: list[dict[str, Any]] | None = None,
        init_readme: bool = True,
    ) -> dict[str, Any]:
        proj_id = name.lower().replace(" ", "-")
        target_dir = (
            Path(path).resolve()
            if path
            else (self._current_project_path.parent / name).resolve()
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        if init_readme:
            readme_path = target_dir / "README.md"
            if not readme_path.exists():
                readme_path.write_text(
                    f"# {name}\n\nProject initialized via Mini Agent Codex Studio.\n",
                    encoding="utf-8",
                )

        sources = source_folders or [
            {"name": name, "path": str(target_dir), "is_primary": True}
        ]
        proj_info = {
            "id": proj_id,
            "name": name,
            "pinned": False,
            "primary_path": str(target_dir),
            "source_folders": sources,
        }
        self._projects_registry[proj_id] = proj_info
        self._current_project_id = proj_id
        self._current_project_path = target_dir
        self._save_state()
        return proj_info

    def update_project(
        self, project_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Update project name, primary path, source folders, or pinned state."""
        proj = self._projects_registry.get(project_id)
        if not proj:
            # Fallback by name
            for k, v in self._projects_registry.items():
                if v.get("name") == project_id:
                    proj = v
                    project_id = k
                    break
        if not proj:
            raise KeyError(f"Project '{project_id}' not found")

        if updates.get("name"):
            proj["name"] = updates["name"]
        if "pinned" in updates:
            proj["pinned"] = bool(updates["pinned"])
        if "source_folders" in updates and isinstance(updates["source_folders"], list):
            proj["source_folders"] = updates["source_folders"]
            # Find primary folder
            primary = next(
                (f["path"] for f in proj["source_folders"] if f.get("is_primary")),
                proj["source_folders"][0]["path"] if proj["source_folders"] else proj["primary_path"],
            )
            proj["primary_path"] = primary

        self._save_state()
        return proj

    def delete_project(self, project_id: str) -> bool:
        """Remove a project from the workspace registry."""
        if project_id in self._projects_registry:
            del self._projects_registry[project_id]
            if self._current_project_id == project_id and self._projects_registry:
                self._current_project_id = next(iter(self._projects_registry.keys()))
            self._save_state()
            return True
        return False

    def toggle_pin_project(self, project_id: str) -> dict[str, Any]:
        proj = self._projects_registry.get(project_id)
        if not proj:
            raise KeyError(f"Project '{project_id}' not found")
        proj["pinned"] = not proj.get("pinned", False)
        self._save_state()
        return proj

    def switch_project(self, project_id_or_path: str) -> dict[str, Any]:
        # 1. Match by project ID
        if project_id_or_path in self._projects_registry:
            self._current_project_id = project_id_or_path
            proj = self._projects_registry[project_id_or_path]
            self._current_project_path = Path(proj["primary_path"])
            self._save_state()
            return proj

        # 2. Match by path
        for pid, p in self._projects_registry.items():
            if p.get("primary_path") == project_id_or_path or any(
                f.get("path") == project_id_or_path for f in p.get("source_folders", [])
            ):
                self._current_project_id = pid
                self._current_project_path = Path(p["primary_path"])
                self._save_state()
                return p

        # 3. Arbitrary new directory path
        p = Path(project_id_or_path).resolve()
        if not p.is_dir():
            raise FileNotFoundError(f"Project directory not found: {project_id_or_path}")
        self._current_project_path = p
        proj_id = p.name.lower()
        proj_info = {
            "id": proj_id,
            "name": p.name,
            "pinned": False,
            "primary_path": str(p),
            "source_folders": [{"name": p.name, "path": str(p), "is_primary": True}],
        }
        self._projects_registry[proj_id] = proj_info
        self._current_project_id = proj_id
        self._save_state()
        return proj_info

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
                "project": self._current_project_id,
                "summary": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "pinned": False,
            }
            self._save_state()
        return self._thread_metadata[thread_id]

    def set_thread_meta(
        self, thread_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Update metadata for a thread."""
        meta = self.get_thread_meta(thread_id)
        meta.update(updates)
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._thread_metadata[thread_id] = meta
        self._save_state()
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
