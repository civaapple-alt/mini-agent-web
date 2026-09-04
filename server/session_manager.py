"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, WebSocket/SSE broadcasting,
thread metadata caching (titles, summaries), and runtime user settings.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import WebSocket
from mini_agent import MiniAgentClient

from server.config import settings
from server.session_catalog import session_catalog

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
            if k
            not in (
                "typed_event",
                "typed_items",
                "typed_item_notification",
                "submission",
            )
        }
    if isinstance(obj, (list, tuple)):
        return [to_json_serializable(v) for v in obj]
    return obj


class SessionManager:
    """Manages the backend MiniAgentClient, frontend connections, projects, and metadata."""

    def __init__(self) -> None:
        self._client: MiniAgentClient | None = None
        self._clients: dict[str, MiniAgentClient] = {}
        self._active_connections: list[WebSocket] = []
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._pending_approval_details: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

        # Web owns only this derived project/UI manifest. Session history,
        # checkpoints, and approval grants belong to the App Server SessionStore.
        state_dir_env = os.environ.get("MINI_AGENT_WEB_STATE_DIR")
        self._state_dir = (
            Path(state_dir_env)
            if state_dir_env
            else (Path.home() / ".mini-agent" / "web")
        )
        self._state_file = self._state_dir / "state.json"

        # Structured project registry: project_id -> project dict
        self._current_project_path: Path = Path.cwd().resolve()
        self._current_project_id: str = self._current_project_path.name
        self._projects_registry: dict[str, dict[str, Any]] = {}
        self._thread_metadata: dict[str, dict[str, Any]] = {}

        # Active turn & task tracking for responsive interrupts
        self._active_turns: dict[str, str] = {}
        self._active_tasks: dict[str, asyncio.Task[Any]] = {}
        self._thread_builtin_tools: dict[str, list[str]] = {}

        # Runtime system settings
        self._settings: dict[str, Any] = {
            "host": settings.host,
            "port": settings.port,
            "default_mode": "chat",  # chat | plan | goal
            "reasoning_effort": "medium",
            "theme": "light",
            "auto_scroll": True,
            "word_wrap": True,
            "font_size": 13,
        }

        # Load persisted state or initialize clean default with only the active workspace
        self._load_state()

    def _load_state(self) -> None:
        """Load projects and session metadata from persistent JSON file."""
        if self._state_file.is_file():
            try:
                data = json.loads(self._state_file.read_text(encoding="utf-8"))
                loaded_projects = data.get("projects", {})
                # Filter out stale temporary test projects that no longer exist on disk
                clean_projects: dict[str, dict[str, Any]] = {}
                for pid, p in loaded_projects.items():
                    p_path = p.get("primary_path", "")
                    if (
                        "pytest" in p_path.lower() or "temp" in p_path.lower()
                    ) and not Path(p_path).exists():
                        continue
                    clean_projects[pid] = p

                self._projects_registry = clean_projects
                self._thread_metadata = data.get("thread_metadata", {})
                if "settings" in data and isinstance(data["settings"], dict):
                    allowed_settings = set(self._settings)
                    self._settings.update(
                        {
                            key: value
                            for key, value in data["settings"].items()
                            if key in allowed_settings
                        }
                    )
                persisted_cur_id = data.get("current_project_id")
                if persisted_cur_id and persisted_cur_id in self._projects_registry:
                    self._current_project_id = persisted_cur_id
                    self._current_project_path = Path(
                        self._projects_registry[persisted_cur_id].get(
                            "primary_path", str(self._current_project_path)
                        )
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "Failed to parse %s, initializing clean state: %s",
                    self._state_file,
                    err,
                )

        # Always ensure the active workspace directory is registered in projects
        cur_name = self._current_project_path.name
        if cur_name not in self._projects_registry:
            self._projects_registry[cur_name] = {
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
                "access": "project",
                "approval": "per_action",
            }

        # If current project ID is missing from registry, default to the active workspace project
        if self._current_project_id not in self._projects_registry:
            self._current_project_id = cur_name

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
        """Persist current projects, settings, and session metadata to disk."""
        try:
            self._state_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "current_project_id": self._current_project_id,
                "projects": self._projects_registry,
                "thread_metadata": self._thread_metadata,
                "settings": self._settings,
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
                t
                for t in self._thread_metadata.values()
                if t.get("project") == proj_id or t.get("project") == p.get("name")
            ]
            sessions = session_catalog.list_sessions(
                Path(p["primary_path"]), proj_id, limit=128
            )["data"]
            projects_list.append(
                {
                    **p,
                    "threads_count": len(p_threads),
                    "active_threads_count": sum(
                        item["runtime_status"] == "running" for item in sessions
                    ),
                    "sessions_count": len(sessions),
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
        base_id = name.lower().replace(" ", "-")
        proj_id = base_id
        count = 1
        while proj_id in self._projects_registry:
            proj_id = f"{base_id}-{count}"
            count += 1

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
            "access": "project",
            "approval": "per_action",
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
        if "access" in updates and updates["access"] in ("project", "full_machine"):
            proj["access"] = updates["access"]
        if "approval" in updates and updates["approval"] in (
            "per_action",
            "current_session",
            "current_project",
        ):
            proj["approval"] = updates["approval"]
        if "source_folders" in updates and isinstance(updates["source_folders"], list):
            proj["source_folders"] = updates["source_folders"]
            # Find primary folder
            primary = next(
                (f["path"] for f in proj["source_folders"] if f.get("is_primary")),
                proj["source_folders"][0]["path"]
                if proj["source_folders"]
                else proj["primary_path"],
            )
            proj["primary_path"] = primary
            if self._current_project_id == project_id:
                self._current_project_path = Path(primary)

        self._save_state()
        return proj

    def delete_project(self, project_id: str) -> bool:
        """Remove a project from the workspace registry."""
        if project_id in self._projects_registry:
            del self._projects_registry[project_id]
            if self._current_project_id == project_id and self._projects_registry:
                self._current_project_id = next(iter(self._projects_registry.keys()))
                next_proj = self._projects_registry[self._current_project_id]
                self._current_project_path = Path(next_proj["primary_path"])
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
            raise FileNotFoundError(
                f"Project directory not found: {project_id_or_path}"
            )
        self._current_project_path = p
        proj_id = p.name.lower()
        proj_info = {
            "id": proj_id,
            "name": p.name,
            "pinned": False,
            "primary_path": str(p),
            "source_folders": [{"name": p.name, "path": str(p), "is_primary": True}],
            "access": "project",
            "approval": "per_action",
        }
        self._projects_registry[proj_id] = proj_info
        self._current_project_id = proj_id
        self._save_state()
        return proj_info

    @property
    def current_project_path(self) -> Path:
        """Active project working directory path."""
        return self._current_project_path

    @property
    def current_source_folders(self) -> list[dict[str, Any]]:
        """Active project configured multi-source folders."""
        proj = self._projects_registry.get(self._current_project_id)
        if (
            proj
            and "source_folders" in proj
            and isinstance(proj["source_folders"], list)
        ):
            return proj["source_folders"]
        return [
            {
                "name": self._current_project_path.name,
                "path": str(self._current_project_path),
                "is_primary": True,
            }
        ]

    def _runtime_env(self, project: dict[str, Any] | None = None) -> dict[str, str]:
        """Pass one Project's bounded workspace binding to the Host process."""
        read_roots: list[str] = []
        write_roots: list[str] = []
        project = project or self._projects_registry.get(self._current_project_id, {})
        primary = Path(
            project.get("primary_path", self._current_project_path)
        ).resolve()
        source_folders = project.get("source_folders") or [
            {"path": str(primary), "is_primary": True}
        ]
        for folder in source_folders:
            raw_path = folder.get("path") if isinstance(folder, dict) else None
            if not raw_path:
                continue
            path = Path(str(raw_path)).resolve()
            if path == primary or not path.is_dir():
                continue
            path_text = str(path)
            read_roots.append(path_text)
            if folder.get("editable", True):
                write_roots.append(path_text)
        return {
            "MINI_AGENT_PROJECT_ID": str(project.get("id", self._current_project_id)),
            "MINI_AGENT_EXTRA_READ_ROOTS": os.pathsep.join(read_roots),
            "MINI_AGENT_EXTRA_WRITE_ROOTS": os.pathsep.join(write_roots),
        }

    @property
    def client(self) -> MiniAgentClient:
        if self._client is None:
            raise RuntimeError(
                "SessionManager is not started. MiniAgentClient is None."
            )
        return self._client

    def _project_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        candidate = project_id or self._thread_metadata.get(thread_id, {}).get(
            "project"
        )
        if candidate in self._projects_registry:
            return self._projects_registry[candidate]
        for project in self._projects_registry.values():
            if project.get("name") == candidate:
                return project
        canonical = self.read_any_project_thread(thread_id)
        if canonical:
            canonical_project = canonical.get("session", {}).get("project_id")
            if canonical_project in self._projects_registry:
                return self._projects_registry[canonical_project]
        return self._projects_registry[self._current_project_id]

    async def _create_client(
        self,
        thread_id: str,
        project: dict[str, Any],
        session_mode: str,
        session_id: str | None = None,
    ) -> MiniAgentClient:
        env = self._runtime_env(project)
        env.update(
            {
                "MINI_AGENT_SESSION_MODE": session_mode,
                "MINI_AGENT_THREAD_ID": thread_id,
            }
        )
        if session_id:
            env["MINI_AGENT_SESSION_ID"] = session_id
        client = MiniAgentClient(
            cwd=str(Path(project["primary_path"]).resolve()),
            env=env,
            log_dir=settings.log_dir,
            log_level=settings.log_level,
            approval_handler=self._handle_approval_request,
            notification_handler=self._handle_runtime_notification,
        )
        await client.__aenter__()
        try:
            init_res = await client.initialize()
            access = str(project.get("access", "project"))
            approval = str(project.get("approval", "per_action"))
            await client.set_world_execution(access=access, approval=approval)
            await client.start_thread(thread_id)
            logger.info(
                "MiniAgentClient initialized for thread %s: %s v%s",
                thread_id,
                init_res.get("serverName"),
                init_res.get("serverVersion"),
            )
            return client
        except Exception:
            await client.stop()
            raise

    async def get_client_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> MiniAgentClient:
        """Get or create the App Server process bound to one canonical session."""
        target = thread_id or "default"
        existing = self._clients.get(target)
        if existing is not None:
            return existing
        canonical = self.read_any_project_thread(target)
        if canonical and canonical["session"]["session_status"] == "locked":
            raise RuntimeError(
                f"Session '{target}' is already running in another process"
            )
        project = self._project_for_thread(target, project_id)
        session = canonical.get("session") if canonical else None
        client = await self._create_client(
            target,
            project,
            "resume" if session else "new",
            session.get("session_id") if session else None,
        )
        self._clients[target] = client
        if target == "default":
            self._client = client
        return client

    def live_thread_ids(self) -> list[str]:
        return list(self._clients)

    def bind_thread_client(self, thread_id: str, client: MiniAgentClient) -> None:
        """Associate an App Server's forked in-memory thread with its client."""
        self._clients[thread_id] = client

    async def start_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> str:
        if project_id:
            self.set_thread_meta(thread_id, {"project": project_id})
        await self.get_client_for_thread(thread_id, project_id)
        return thread_id

    async def start(self) -> None:
        """Start and initialize the background MiniAgentClient."""
        async with self._lock:
            if self._client is not None:
                return
            canonical = self.read_project_thread("default")
            session = canonical.get("session") if canonical else None
            reusable_session = session and session.get("session_status") != "locked"
            self._client = await self._create_client(
                "default",
                self._projects_registry[self._current_project_id],
                "resume" if reusable_session else "new",
                session.get("session_id") if reusable_session else None,
            )
            self._clients["default"] = self._client
            self._initialized = True

    async def restart_for_current_project(self) -> None:
        """Rebind the Host process after the active Project/workspace changes."""
        async with self._lock:
            clients = list(self._clients.values())
            self._clients.clear()
            self._client = None
            self._initialized = False
            for task in self._active_tasks.values():
                task.cancel()
            self._active_tasks.clear()
            self._active_turns.clear()
            for future in self._pending_approvals.values():
                if not future.done():
                    future.cancel()
            self._pending_approvals.clear()
            self._pending_approval_details.clear()
        for client in set(clients):
            await client.stop()
        await self.start()

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

            # 3. Terminate all per-session App Server processes
            clients = list(self._clients.values())
            self._clients.clear()
            self._client = None
            for client in set(clients):
                try:
                    await asyncio.wait_for(client.stop(), timeout=3.0)
                except (asyncio.TimeoutError, Exception):  # noqa: BLE001, S110
                    pass
            self._initialized = False
            logger.info("MiniAgentClient processes terminated cleanly.")

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

    def list_project_sessions(
        self, project_id: str | None = None, limit: int = 64, cursor: str | None = None
    ) -> dict[str, Any]:
        """Read the canonical SessionStore projection for one registered Project."""
        target_id = project_id or self._current_project_id
        project = self._projects_registry.get(target_id)
        if not project:
            raise KeyError(f"Project '{target_id}' not found")
        result = session_catalog.list_sessions(
            Path(project["primary_path"]), target_id, limit=limit, cursor=cursor
        )
        for session in result["data"]:
            meta = self._thread_metadata.get(session["thread_id"], {})
            session["title"] = meta.get("title") or session["title"]
            session["summary"] = meta.get("summary") or session["summary"]
        return result

    def list_all_project_sessions(self, limit: int = 128) -> list[dict[str, Any]]:
        """Return a bounded cross-project SessionStore view for the sidebar."""
        sessions: list[dict[str, Any]] = []
        for project_id in self._projects_registry:
            sessions.extend(self.list_project_sessions(project_id, limit=limit)["data"])
        sessions.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        return sessions[: max(1, min(limit, 128))]

    def read_project_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        """Read a settled Thread projection without creating a Web checkpoint."""
        target_id = project_id or self._current_project_id
        project = self._projects_registry.get(target_id)
        if not project:
            return None
        return session_catalog.read_thread(
            Path(project["primary_path"]), target_id, thread_id
        )

    def read_any_project_thread(self, thread_id: str) -> dict[str, Any] | None:
        """Find one canonical SessionStore thread without changing the active Project."""
        for project_id in self._projects_registry:
            result = self.read_project_thread(thread_id, project_id)
            if result:
                return result
        return None

    # -------------------------------------------------------------------------
    # Settings Management
    # -------------------------------------------------------------------------

    def get_settings(self) -> dict[str, Any]:
        """Get current server & UI settings."""
        project = self._projects_registry.get(self._current_project_id, {})
        return {
            **self._settings,
            "access": project.get("access", "project"),
            "approval": project.get("approval", "per_action"),
        }

    def project_execution(self) -> tuple[str, str]:
        project = self._projects_registry.get(self._current_project_id, {})
        return (
            str(project.get("access", "project")),
            str(project.get("approval", "per_action")),
        )

    def set_project_execution(self, access: str, approval: str) -> None:
        if access not in ("project", "full_machine"):
            raise ValueError("invalid access scope")
        if approval not in ("per_action", "current_session", "current_project"):
            raise ValueError("invalid approval scope")
        project = self._projects_registry[self._current_project_id]
        project["access"] = access
        project["approval"] = approval
        self._save_state()

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update system settings."""
        self._settings.update(updates)
        self._save_state()
        logger.info("Updated system settings: %s", updates)
        return dict(self._settings)

    # -------------------------------------------------------------------------
    # Approval Handshake Management
    # -------------------------------------------------------------------------

    async def _handle_approval_request(
        self,
        req: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Called asynchronously by MiniAgentClient when the App Server encounters
        a sensitive tool invocation requiring human approval.
        """
        req_data = req
        req_id = str(req.get("requestId") or "")
        if not req_id:
            raise ValueError("approval request is missing requestId")
        action_name = str(req_data.get("actionSummary") or req_data.get("action") or "")

        logger.info("Approval requested by server: %s", req_data)

        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending_approvals[req_id] = future
        self._pending_approval_details[req_id] = {
            "action_name": action_name,
            "data": req_data,
        }

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
            access, approval = self.project_execution()
            return {
                "decision": "deny",
                "access": req_data.get("access", access),
                "approval": approval,
                "reason": "Approval request timed out or cancelled",
            }
        finally:
            self._pending_approvals.pop(req_id, None)
            self._pending_approval_details.pop(req_id, None)

    async def _handle_runtime_notification(self, notification: dict[str, Any]) -> None:
        """Relay App Server Goal/settings notifications to connected Studio clients."""
        await self.broadcast_ws(notification)

    def resolve_approval(
        self,
        request_id: str,
        decision: str,
        access: str,
        approval: str,
        reason: str | None = None,
    ) -> bool:
        """Resolve a pending typed approval without storing Web-side grants."""
        details = self._pending_approval_details.get(request_id)
        if not details:
            return False
        data = details.get("data", {})
        if access != data.get("access") or approval not in data.get(
            "allowedApprovalModes", []
        ):
            logger.warning("Rejected out-of-scope approval response: %s", request_id)
            return False
        if decision.lower() not in ("approve", "deny"):
            return False

        fut = self._pending_approvals.get(request_id)
        if fut and not fut.done():
            fut.set_result(
                {
                    "decision": decision,
                    "access": access,
                    "approval": approval,
                    "reason": reason or "",
                }
            )
            return True
        return False

    def list_pending_approvals(self) -> list[str]:
        return list(self._pending_approvals.keys())

    def approval_snapshot(self) -> dict[str, Any]:
        """Expose project policy and pending requests without exposing grants."""
        access, approval = self.project_execution()
        pending = []
        for request_id, details in self._pending_approval_details.items():
            pending.append(
                {
                    "request_id": request_id,
                    "action_name": details.get("action_name", ""),
                    "data": details.get("data", {}),
                }
            )
        return {
            "project_id": self._current_project_id,
            "access": access,
            "approval": approval,
            "pending_requests": pending,
            "grant_store": "app-server-memory",
            "revocable": True,
        }

    async def revoke_current_project_approvals(self) -> dict[str, Any]:
        """Restart the project-bound App Server, clearing its in-memory grants."""
        project_id = self._current_project_id
        self.cancel_active_task()
        await self.restart_for_current_project()
        return {"project_id": project_id, "revoked": True}

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

    # -------------------------------------------------------------------------
    # Active Turn & Stream Task Tracking
    # -------------------------------------------------------------------------

    def set_active_turn(
        self, thread_id: str, turn_id: str, task: asyncio.Task[Any] | None = None
    ) -> None:
        """Track active turn ID and optional streaming task for responsive interrupts."""
        self._active_turns[thread_id] = turn_id
        if task:
            self._active_tasks[thread_id] = task

    def clear_active_turn(self, thread_id: str) -> None:
        """Clear active turn tracking upon turn settlement."""
        self._active_turns.pop(thread_id, None)
        self._active_tasks.pop(thread_id, None)

    def get_active_turn(self, thread_id: str | None = None) -> str | None:
        """Retrieve current active turn ID for thread."""
        if thread_id and thread_id in self._active_turns:
            return self._active_turns[thread_id]
        if self._active_turns:
            return next(iter(self._active_turns.values()))
        return None

    def cancel_active_task(self, thread_id: str | None = None) -> None:
        """Cancel background stream tasks for thread or all threads."""
        if thread_id and thread_id in self._active_tasks:
            task = self._active_tasks.pop(thread_id)
            if not task.done():
                task.cancel()
        elif not thread_id:
            for task in list(self._active_tasks.values()):
                if not task.done():
                    task.cancel()
            self._active_tasks.clear()


# Global singleton instance
session_manager = SessionManager()
