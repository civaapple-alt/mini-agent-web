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
import shutil
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import WebSocket
from mini_agent import MiniAgentClient

from server.config import settings
from server.session_catalog import session_catalog

logger = logging.getLogger("mini_agent.server")


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON data to path atomically using a temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    try:
        tmp_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp_path.replace(path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


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
        # ``_clients`` remains the active-thread compatibility view used by
        # existing routes/tests.  The real pool is project-qualified so two
        # projects may both own a ``default`` Thread.
        self._clients: dict[str, MiniAgentClient] = {}
        self._client_projects: dict[str, str] = {}
        self._project_clients: dict[tuple[str, str], MiniAgentClient] = {}
        self._active_thread_projects: dict[str, str] = {}
        self._active_connections: list[WebSocket] = []
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._pending_approval_details: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
        self._runtime_generation = 0

        # Web owns only this derived project/UI manifest. Session history,
        # checkpoints, and approval grants belong to the App Server SessionStore.
        state_dir_env = os.environ.get("MINI_AGENT_WEB_STATE_DIR")
        self._set_state_paths(
            Path(state_dir_env)
            if state_dir_env
            else (Path.home() / ".mini-agent" / "web")
        )

        # Structured project registry: project_id -> project dict
        self._current_project_path: Path = Path.cwd().resolve()
        self._current_project_id: str = self._current_project_path.name
        self._projects_registry: dict[str, dict[str, Any]] = {}
        self._thread_metadata: dict[str, dict[str, Any]] = {}
        self._thread_metadata_by_project: dict[tuple[str, str], dict[str, Any]] = {}

        # Active turn & task tracking for responsive interrupts
        self._active_turns: dict[str, str] = {}
        self._active_tasks: dict[str, asyncio.Task[Any]] = {}
        self._active_turns_by_project: dict[tuple[str, str], str] = {}
        self._active_tasks_by_project: dict[tuple[str, str], asyncio.Task[Any]] = {}
        self._thread_builtin_tools: dict[str, list[str]] = {}
        self._thread_builtin_tools_by_project: dict[tuple[str, str], list[str]] = {}

        # Runtime system settings
        self._settings: dict[str, Any] = {
            "host": settings.host,
            "port": settings.port,
            "default_mode": "chat",  # chat | plan | goal
            "reasoning_effort": "high",
            "theme": "light",
            "auto_scroll": True,
            "word_wrap": True,
            "font_size": 13,
        }

        # Load persisted state or initialize clean default with only the active workspace
        self._load_state()

    def _set_state_paths(self, base_dir: Path) -> None:
        """Configure directory layout for state persistence."""
        self.__state_dir = base_dir
        self._settings_file = base_dir / "settings.json"
        self._projects_file = base_dir / "projects.json"
        self._projects_dir = base_dir / "projects"

    @property
    def _state_dir(self) -> Path:
        return self.__state_dir

    @_state_dir.setter
    def _state_dir(self, val: Path) -> None:
        self._set_state_paths(val)

    def _load_state(self) -> None:
        """Load projects, settings, and session metadata from decoupled files."""
        # 1. Load settings
        if self._settings_file.is_file():
            try:
                s_data = json.loads(self._settings_file.read_text(encoding="utf-8"))
                if isinstance(s_data, dict):
                    allowed_settings = set(self._settings)
                    self._settings.update(
                        {k: v for k, v in s_data.items() if k in allowed_settings}
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "Failed to parse settings from %s: %s", self._settings_file, err
                )

        # 2. Load projects
        if self._projects_file.is_file():
            try:
                p_data = json.loads(self._projects_file.read_text(encoding="utf-8"))
                loaded_projects = p_data.get("projects", {})
                clean_projects = {}
                for pid, p in loaded_projects.items():
                    p.pop("approval", None)
                    p.setdefault("policy", "interactive")
                    p_path = p.get("primary_path", "")
                    if (
                        "pytest" in p_path.lower() or "temp" in p_path.lower()
                    ) and not Path(p_path).exists():
                        continue
                    clean_projects[pid] = p
                self._projects_registry = clean_projects
                persisted_cur_id = p_data.get("current_project_id")
                if persisted_cur_id and persisted_cur_id in self._projects_registry:
                    self._current_project_id = persisted_cur_id
                    self._current_project_path = Path(
                        self._projects_registry[persisted_cur_id].get(
                            "primary_path", str(self._current_project_path)
                        )
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "Failed to parse projects from %s: %s", self._projects_file, err
                )

        # 3. Load threads partitioned across projects/<pid>/threads.json
        self._thread_metadata = {}
        self._thread_metadata_by_project = {}
        if self._projects_dir.is_dir():
            for pdir in self._projects_dir.iterdir():
                t_file = pdir / "threads.json"
                if pdir.is_dir() and t_file.is_file():
                    try:
                        t_data = json.loads(t_file.read_text(encoding="utf-8"))
                        if isinstance(t_data, dict):
                            for tid, t_meta in t_data.items():
                                if isinstance(t_meta, dict):
                                    t_meta = dict(t_meta)
                                    project_id = str(t_meta.get("project") or pdir.name)
                                    if (
                                        project_id not in self._projects_registry
                                        and pdir.name in self._projects_registry
                                    ):
                                        project_id = pdir.name
                                    t_meta["project"] = project_id
                                    # Continuation is canonical SessionStore state;
                                    # discard the retired Web-side shadow field.
                                    t_meta.pop("continuation_mode", None)
                                    self._thread_metadata_by_project[
                                        (project_id, tid)
                                    ] = t_meta
                                    self._thread_metadata[tid] = t_meta
                    except Exception as err:  # noqa: BLE001
                        logger.warning(
                            "Failed to load threads from %s: %s", t_file, err
                        )

        # 4. Always ensure the active workspace directory is registered in projects
        cur_name = self._current_project_path.name
        cur_resolved = self._current_project_path.resolve()
        already_registered = any(
            Path(p.get("primary_path", "")).resolve() == cur_resolved
            for p in self._projects_registry.values()
        )
        if not already_registered and cur_name not in self._projects_registry:
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
                "policy": "interactive",
            }

        # If current project ID is missing from registry, default to the active workspace project
        if self._current_project_id not in self._projects_registry:
            matching_proj = next(
                (
                    pid
                    for pid, p in self._projects_registry.items()
                    if Path(p.get("primary_path", "")).resolve() == cur_resolved
                ),
                None,
            )
            self._current_project_id = matching_proj or cur_name

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

        self._save_projects()
        self._save_settings()
        if self._current_project_id:
            self._save_project_threads(self._current_project_id)

    def _save_settings(self) -> None:
        """Persist system and UI settings to settings.json atomically."""
        try:
            _atomic_write_json(self._settings_file, self._settings)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist settings to %s: %s", self._settings_file, err
            )

    def _save_projects(self) -> None:
        """Persist registered projects and current_project_id to projects.json atomically."""
        try:
            payload = {
                "current_project_id": self._current_project_id,
                "projects": self._projects_registry,
            }
            _atomic_write_json(self._projects_file, payload)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist projects to %s: %s", self._projects_file, err
            )

    def _save_project_threads(self, project_id: str) -> None:
        """Persist thread metadata for a specific project to projects/<project_id>/threads.json."""
        if not project_id:
            return
        try:
            proj_meta = {
                tid: meta
                for (pid, tid), meta in self._thread_metadata_by_project.items()
                if pid == project_id
            }
            # Preserve compatibility for tests/older callers that still write
            # directly to the legacy unqualified metadata mapping.
            for tid, meta in self._thread_metadata.items():
                if meta.get("project") == project_id:
                    proj_meta.setdefault(tid, meta)
            target_file = self._projects_dir / project_id / "threads.json"
            _atomic_write_json(target_file, proj_meta)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist threads for project %s to %s: %s",
                project_id,
                self._projects_dir / project_id / "threads.json",
                err,
            )

    def _save_thread_for_id(self, thread_id: str) -> None:
        """Save thread metadata for the project associated with thread_id."""
        meta = self._thread_metadata.get(thread_id, {})
        project_id = meta.get("project") or self._current_project_id
        if project_id:
            self._save_project_threads(project_id)

    def _save_all_threads(self) -> None:
        """Persist thread metadata for all projects."""
        all_pids = set(self._projects_registry.keys()) | {
            meta.get("project")
            for meta in self._thread_metadata.values()
            if meta.get("project")
        }
        for pid in all_pids:
            if pid:
                self._save_project_threads(pid)

    def _save_state(self) -> None:
        """Persist all state slices to their respective files."""
        self._save_settings()
        self._save_projects()
        self._save_all_threads()

    def get_projects(self) -> dict[str, Any]:
        """Get all projects with active threads summary."""
        projects_list = []
        for p in self._projects_registry.values():
            proj_id = p["id"]
            p_threads = [
                meta
                for (pid, _thread_id), meta in self._thread_metadata_by_project.items()
                if pid == proj_id
            ]
            if not p_threads:
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
                        item.get("turn_active", False) for item in sessions
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
            "policy": "interactive",
        }
        self._projects_registry[proj_id] = proj_info
        self._current_project_id = proj_id
        self._current_project_path = target_dir
        self._save_projects()
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
        if "policy" in updates and updates["policy"] in (
            "interactive",
            "automatic",
            "trusted",
        ):
            proj["policy"] = updates["policy"]
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

        self._save_projects()
        return proj

    def delete_project(self, project_id: str) -> bool:
        """Remove a project from the workspace registry."""
        if project_id in self._projects_registry:
            del self._projects_registry[project_id]
            if self._current_project_id == project_id and self._projects_registry:
                self._current_project_id = next(iter(self._projects_registry.keys()))
                next_proj = self._projects_registry[self._current_project_id]
                self._current_project_path = Path(next_proj["primary_path"])
            self._save_projects()
            proj_dir = self._projects_dir / project_id
            if proj_dir.is_dir():
                shutil.rmtree(proj_dir, ignore_errors=True)
            self._thread_metadata = {
                tid: meta
                for tid, meta in self._thread_metadata.items()
                if meta.get("project") != project_id
            }
            self._thread_metadata_by_project = {
                key: meta
                for key, meta in self._thread_metadata_by_project.items()
                if key[0] != project_id
            }
            self._project_clients = {
                key: client
                for key, client in self._project_clients.items()
                if key[0] != project_id
            }
            self._active_thread_projects = {
                tid: pid
                for tid, pid in self._active_thread_projects.items()
                if pid != project_id
            }
            return True
        return False

    def toggle_pin_project(self, project_id: str) -> dict[str, Any]:
        proj = self._projects_registry.get(project_id)
        if not proj:
            raise KeyError(f"Project '{project_id}' not found")
        proj["pinned"] = not proj.get("pinned", False)
        self._save_projects()
        return proj

    def switch_project(self, project_id_or_path: str) -> dict[str, Any]:
        # 1. Match by project ID
        if project_id_or_path in self._projects_registry:
            self._current_project_id = project_id_or_path
            proj = self._projects_registry[project_id_or_path]
            self._current_project_path = Path(proj["primary_path"])
            self._save_projects()
            return proj

        # 2. Match by path
        for pid, p in self._projects_registry.items():
            if p.get("primary_path") == project_id_or_path or any(
                f.get("path") == project_id_or_path for f in p.get("source_folders", [])
            ):
                self._current_project_id = pid
                self._current_project_path = Path(p["primary_path"])
                self._save_projects()
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
            "policy": "interactive",
        }
        self._projects_registry[proj_id] = proj_info
        self._current_project_id = proj_id
        self._save_projects()
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
        env = {
            "MINI_AGENT_PROJECT_ID": str(project.get("id", self._current_project_id)),
            "MINI_AGENT_EXTRA_READ_ROOTS": os.pathsep.join(read_roots),
            "MINI_AGENT_EXTRA_WRITE_ROOTS": os.pathsep.join(write_roots),
        }
        if project.get("name"):
            env["MINI_AGENT_PROJECT_NAME"] = str(project["name"])
        return env

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
        candidate = (
            project_id
            or self._active_thread_projects.get(thread_id)
            or self._thread_metadata.get(thread_id, {}).get("project")
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

    def _canonical_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        """Read one canonical Thread, honoring an explicit Project binding."""
        if project_id:
            project = self._project_for_thread(thread_id, project_id)
            return self.read_project_thread(thread_id, project.get("id"))
        active_project = self._active_thread_projects.get(thread_id)
        if active_project:
            return self.read_project_thread(thread_id, active_project)
        return self.read_any_project_thread(thread_id)

    def _activate_thread_client(
        self, thread_id: str, project_id: str, client: MiniAgentClient
    ) -> None:
        """Make one project-qualified client the active target for a Thread ID."""
        self._project_clients[(project_id, thread_id)] = client
        self._clients[thread_id] = client
        self._client_projects[thread_id] = project_id
        self._active_thread_projects[thread_id] = project_id
        if thread_id == "default":
            self._client = client

    def _all_clients(self) -> list[MiniAgentClient]:
        """Return all pooled clients once, including inactive project bindings."""
        clients: list[MiniAgentClient] = []
        seen: set[int] = set()
        for client in [*self._clients.values(), *self._project_clients.values()]:
            if id(client) in seen:
                continue
            seen.add(id(client))
            clients.append(client)
        return clients

    def live_thread_bindings(self) -> list[tuple[str, str]]:
        """Return active ``(project_id, thread_id)`` bindings for the UI catalog."""
        bindings = set(self._project_clients)
        bindings.update(
            (project_id, thread_id)
            for thread_id, project_id in self._client_projects.items()
        )
        return sorted(bindings)

    def builtin_tools_for_thread(self, thread_id: str) -> list[str] | None:
        """Read the active project's in-memory Builtin tool selection."""
        project_id = self._active_thread_projects.get(thread_id)
        if project_id:
            selected = self._thread_builtin_tools_by_project.get(
                (project_id, thread_id)
            )
            if selected is not None:
                return selected
        return self._thread_builtin_tools.get(thread_id)

    def set_builtin_tools_for_thread(
        self, thread_id: str, builtin_tools: list[str]
    ) -> None:
        """Store Builtin tool selection in the active project's namespace."""
        project_id = self._active_thread_projects.get(thread_id)
        if project_id:
            self._thread_builtin_tools_by_project[(project_id, thread_id)] = list(
                builtin_tools
            )
        self._thread_builtin_tools[thread_id] = list(builtin_tools)

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
        notification_project_id = str(project.get("id") or self._current_project_id)

        async def handle_approval(req: dict[str, Any]) -> dict[str, Any]:
            return await self._handle_approval_request(req, notification_project_id)

        async def handle_notification(notification: dict[str, Any]) -> None:
            await self._handle_runtime_notification(
                notification, notification_project_id
            )

        client = MiniAgentClient(
            cwd=str(Path(project["primary_path"]).resolve()),
            env=env,
            log_dir=settings.log_dir,
            log_level=settings.log_level,
            approval_handler=handle_approval,
            notification_handler=handle_notification,
        )
        await client.__aenter__()
        try:
            init_res = await client.initialize()
            access = str(project.get("access", "project"))
            policy = str(project.get("policy", "interactive"))
            await client.set_world_execution(access=access, policy=policy)
            await client.start_thread(thread_id)
            await self._apply_persisted_thread_continuation(
                thread_id, client, project.get("id", "")
            )
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

    async def _get_client_for_thread_locked(
        self, thread_id: str, project_id: str | None = None
    ) -> MiniAgentClient:
        """Get or create a Thread client while the manager lock is held."""
        target = thread_id or "default"
        project = self._project_for_thread(target, project_id)
        resolved_project_id = str(project.get("id") or self._current_project_id)
        binding_key = (resolved_project_id, target)
        existing = self._project_clients.get(binding_key)
        # Tests and older callers may have populated the compatibility view
        # directly. Adopt that client when its binding matches the target.
        if existing is None:
            legacy = self._clients.get(target)
            legacy_project = self._client_projects.get(target)
            if legacy is not None and (
                legacy_project in (None, resolved_project_id)
                or (not project_id and legacy_project is None)
            ):
                existing = legacy
                self._project_clients[binding_key] = legacy
        if existing is not None:
            self._activate_thread_client(target, resolved_project_id, existing)
            return existing

        canonical = self._canonical_thread(target, resolved_project_id)
        if canonical and canonical["session"]["session_status"] == "locked":
            raise RuntimeError(
                f"Session '{target}' is already running in another process"
            )
        session = canonical.get("session") if canonical else None
        client = await self._create_client(
            target,
            project,
            "resume" if session else "new",
            session.get("session_id") if session else None,
        )
        self._activate_thread_client(target, resolved_project_id, client)
        return client

    async def get_client_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> MiniAgentClient:
        """Get or create the App Server process bound to one canonical session."""
        async with self._lock:
            return await self._get_client_for_thread_locked(
                thread_id or "default", project_id
            )

    def live_thread_ids(self) -> list[str]:
        return list(self._clients)

    def bind_thread_client(
        self,
        thread_id: str,
        client: MiniAgentClient,
        project_id: str | None = None,
    ) -> None:
        """Bind a forked Thread without changing its source Project identity."""
        project = self._project_for_thread(thread_id, project_id)
        resolved_project_id = str(project.get("id") or self._current_project_id)
        binding_key = (resolved_project_id, thread_id)
        existing = self._project_clients.get(binding_key)
        if existing is not None and (existing is not client):
            raise RuntimeError(
                f"Thread '{thread_id}' is already bound to Project "
                f"'{resolved_project_id}'"
            )
        self._activate_thread_client(thread_id, resolved_project_id, client)

    async def fork_thread(
        self,
        source_thread_id: str,
        new_thread_id: str,
        title: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Fork and bind a child without exposing an attach race window."""
        async with self._lock:
            client = await self._get_client_for_thread_locked(
                source_thread_id, project_id
            )
            source_project = self._client_projects.get(source_thread_id)
            if not source_project:
                source_project = self._active_thread_projects.get(source_thread_id)
            if not source_project:
                source_project = self._project_for_thread(
                    source_thread_id, project_id
                ).get("id")
            existing_project = self._active_thread_projects.get(new_thread_id)
            if existing_project and existing_project != source_project:
                raise RuntimeError(
                    f"Thread '{new_thread_id}' is already bound to Project "
                    f"'{existing_project}'"
                )
            result = await client.fork_thread(
                source_thread_id=source_thread_id,
                new_thread_id=new_thread_id,
            )
            source_meta = self.get_thread_meta(source_thread_id)
            fork_title = title or f"{source_meta.get('title', source_thread_id)} (Fork)"
            self.set_thread_meta(
                result.thread_id,
                {
                    "title": fork_title,
                    "summary": f"Forked from {source_thread_id}",
                    "project": source_project,
                },
            )
            self.bind_thread_client(result.thread_id, client, source_project)
            return {
                "thread_id": result.thread_id,
                "status": "forked",
                "title": fork_title,
                "project": source_project,
            }

    async def start_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> str:
        if project_id:
            self.set_thread_meta(thread_id, {"project": project_id})
        await self.get_client_for_thread(thread_id, project_id)
        return thread_id

    async def attach_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> dict[str, Any]:
        """Attach Studio to a resumable Session without stealing a live lock."""
        async with self._lock:
            target = thread_id or "default"
            project = self._project_for_thread(target, project_id)
            resolved_project_id = str(project.get("id") or self._current_project_id)
            if project_id:
                # Selecting a project is also the routing context for subsequent
                # project-agnostic REST/WebSocket actions for this Thread ID.
                self._active_thread_projects[target] = resolved_project_id
                canonical = self._canonical_thread(target, resolved_project_id)
            else:
                # Preserve the legacy unqualified lookup path. In particular, a
                # caller may be asking about a locked Session that is not yet in
                # the local client pool.
                canonical = self._canonical_thread(target)
                canonical_project = (
                    canonical.get("session", {}).get("project_id")
                    if canonical
                    else None
                )
                if canonical_project in self._projects_registry:
                    resolved_project_id = str(canonical_project)
                self._active_thread_projects.setdefault(target, resolved_project_id)

            # The SessionStore lock also belongs to this gateway's local client.
            # Check the project-qualified pool before treating the catalog entry
            # as an external lock; otherwise selecting the already active Session
            # incorrectly puts Studio into read-only mode.
            existing = self._project_clients.get((resolved_project_id, target))
            if existing is None:
                legacy = self._clients.get(target)
                legacy_project = self._client_projects.get(target)
                if legacy is not None and legacy_project in (
                    None,
                    resolved_project_id,
                ):
                    existing = legacy
            if (
                existing is None
                and canonical
                and canonical["session"]["session_status"] == "locked"
            ):
                session = canonical["session"]
                return {
                    "thread_id": target,
                    "attached": False,
                    "project": session.get("project_id") or resolved_project_id,
                    "session_id": session.get("session_id"),
                    "session_status": session.get("session_status"),
                    "runtime_status": session.get("runtime_status"),
                    "locked_by": session.get("locked_by"),
                }

            # Keep the lock held through the lookup/create decision so a
            # concurrent attach cannot create a competing App Server process.
            await self._get_client_for_thread_locked(target, resolved_project_id)
            refreshed = self._canonical_thread(target, resolved_project_id)
            session = refreshed.get("session", {}) if refreshed else {}
            return {
                "thread_id": target,
                "attached": True,
                "project": session.get("project_id") or resolved_project_id,
                "session_id": session.get("session_id"),
                "session_status": session.get("session_status", "locked"),
                "runtime_status": session.get("runtime_status", "running"),
                "locked_by": session.get("locked_by"),
            }

    async def start(self) -> None:
        """Start and initialize the background MiniAgentClient."""
        async with self._lock:
            if self._client is not None:
                return
            canonical = self.read_project_thread("default")
            session = canonical.get("session") if canonical else None
            if session and session.get("session_status") == "locked":
                # A process restart must not create a fresh default Session just
                # because the previous gateway process still owns the lock. Keep
                # the catalog available in read-only mode and let an explicit
                # attach retry once the external process exits.
                self._active_thread_projects["default"] = self._current_project_id
                self._initialized = True
                logger.info(
                    "Default Session is locked by another process; starting Gateway in read-only mode"
                )
                return
            reusable_session = session
            self._client = await self._create_client(
                "default",
                self._projects_registry[self._current_project_id],
                "resume" if reusable_session else "new",
                session.get("session_id") if reusable_session else None,
            )
            self._activate_thread_client(
                "default", self._current_project_id, self._client
            )
            self._initialized = True

    async def restart_for_current_project(self) -> None:
        """Rebind the Host process after the active Project/workspace changes."""
        async with self._lock:
            clients = self._all_clients()
            self._clients.clear()
            self._client_projects.clear()
            self._project_clients.clear()
            self._active_thread_projects.clear()
            self._client = None
            self._initialized = False
            for task in [
                *self._active_tasks.values(),
                *self._active_tasks_by_project.values(),
            ]:
                task.cancel()
            self._active_tasks.clear()
            self._active_turns.clear()
            self._active_tasks_by_project.clear()
            self._active_turns_by_project.clear()
            for future in self._pending_approvals.values():
                if not future.done():
                    future.cancel()
            self._pending_approvals.clear()
            self._pending_approval_details.clear()
        for client in set(clients):
            await client.stop()
        await self.start()
        self._runtime_generation += 1
        await self.broadcast_ws(
            {
                "type": "notification",
                "method": "gateway/runtime/restarted",
                "data": {
                    "projectId": self._current_project_id,
                    "runtimeGeneration": self._runtime_generation,
                },
            }
        )

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
            clients = self._all_clients()
            self._clients.clear()
            self._client_projects.clear()
            self._project_clients.clear()
            self._active_thread_projects.clear()
            self._active_tasks.clear()
            self._active_turns.clear()
            self._active_tasks_by_project.clear()
            self._active_turns_by_project.clear()
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

    def _metadata_project_id(
        self, thread_id: str, project_id: str | None = None
    ) -> str:
        candidate = (
            project_id
            or self._active_thread_projects.get(thread_id)
            or self._thread_metadata.get(thread_id, {}).get("project")
            or self._current_project_id
        )
        if candidate in self._projects_registry:
            return str(candidate)
        for pid, project in self._projects_registry.items():
            if project.get("name") == candidate:
                return pid
        return str(candidate)

    def get_thread_meta(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Get metadata for a project-qualified thread."""
        resolved_project_id = self._metadata_project_id(thread_id, project_id)
        key = (resolved_project_id, thread_id)
        meta = self._thread_metadata_by_project.get(key)
        if meta is None:
            legacy = self._thread_metadata.get(thread_id)
            if (
                legacy
                and self._metadata_project_id(thread_id, str(legacy.get("project")))
                == resolved_project_id
            ):
                meta = legacy
            else:
                meta = {
                    "title": f"会话 {thread_id}",
                    "project": resolved_project_id,
                    "summary": "",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "pinned": False,
                }
            self._thread_metadata_by_project[key] = meta
            if project_id is None:
                self._thread_metadata[thread_id] = meta
                self._save_thread_for_id(thread_id)
        if project_id is None:
            self._thread_metadata[thread_id] = meta
        return meta

    def set_thread_meta(
        self, thread_id: str, updates: dict[str, Any], project_id: str | None = None
    ) -> dict[str, Any]:
        """Update metadata for a thread."""
        requested_project = project_id or updates.get("project")
        resolved_project_id = self._metadata_project_id(thread_id, requested_project)
        meta = self.get_thread_meta(thread_id, resolved_project_id)
        old_project = meta.get("project")
        normalized_updates = dict(updates)
        if "project" in normalized_updates:
            normalized_updates["project"] = self._metadata_project_id(
                thread_id, str(normalized_updates["project"])
            )
        meta.update(normalized_updates)
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        if old_project and old_project != meta.get("project"):
            self._thread_metadata_by_project.pop((str(old_project), thread_id), None)
        self._thread_metadata_by_project[(str(meta.get("project")), thread_id)] = meta
        self._thread_metadata[thread_id] = meta
        new_project = meta.get("project")
        if old_project and old_project != new_project:
            self._save_project_threads(old_project)
        if new_project:
            self._save_project_threads(new_project)
        else:
            self._save_thread_for_id(thread_id)
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
            meta = self.get_thread_meta(session["thread_id"], target_id)
            session["title"] = meta.get("title") or session["title"]
            session["summary"] = meta.get("summary") or session["summary"]
        return result

    def list_all_project_sessions(self, limit: int = 128) -> list[dict[str, Any]]:
        """Return a bounded cross-project SessionStore view for the sidebar."""
        sessions_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for project_id in self._projects_registry:
            project_sessions = self.list_project_sessions(project_id, limit=limit)[
                "data"
            ]
            for session in project_sessions:
                key = (
                    str(session.get("workspace_id") or project_id),
                    str(session.get("session_id") or ""),
                )
                sessions_by_key.setdefault(key, session)
        sessions = list(sessions_by_key.values())
        sessions.sort(
            key=lambda item: (
                item.get("updated_at") or "",
                str(item.get("project_id") or ""),
                str(item.get("session_id") or ""),
                str(item.get("thread_id") or ""),
            ),
            reverse=True,
        )
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
        metadata_project = self._active_thread_projects.get(
            thread_id
        ) or self._thread_metadata.get(thread_id, {}).get("project")
        ordered_ids: list[str] = []
        if metadata_project in self._projects_registry:
            ordered_ids.append(metadata_project)
        ordered_ids.extend(
            project_id
            for project_id in self._projects_registry
            if project_id not in ordered_ids
        )
        seen_workspaces: set[str] = set()
        for project_id in ordered_ids:
            project = self._projects_registry[project_id]
            workspace_key = str(Path(project["primary_path"]).resolve()).casefold()
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            result = self.read_project_thread(thread_id, project_id)
            if result:
                return result
        return None

    def session_path_for_thread(self, thread_id: str) -> Path | None:
        """Resolve a Thread to its canonical Session directory for read-only artifacts."""
        metadata_project = self._active_thread_projects.get(
            thread_id
        ) or self._thread_metadata.get(thread_id, {}).get("project")
        ordered_ids: list[str] = []
        if metadata_project in self._projects_registry:
            ordered_ids.append(metadata_project)
        ordered_ids.extend(
            project_id
            for project_id in self._projects_registry
            if project_id not in ordered_ids
        )
        seen_workspaces: set[str] = set()
        for project_id in ordered_ids:
            project = self._projects_registry[project_id]
            workspace = Path(project["primary_path"])
            workspace_key = str(workspace.resolve()).casefold()
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            path = session_catalog.find_session_path(workspace, thread_id)
            if path:
                return path
        return None

    def project_path_for_thread(self, thread_id: str | None = None) -> Path:
        """Resolve the active Thread's Project workspace for file inspection."""
        if thread_id:
            project_id = self._active_thread_projects.get(thread_id)
            if project_id and project_id in self._projects_registry:
                return Path(
                    self._projects_registry[project_id]["primary_path"]
                ).resolve()
        return self._current_project_path.resolve()

    # -------------------------------------------------------------------------
    # Settings Management
    # -------------------------------------------------------------------------

    def get_settings(self) -> dict[str, Any]:
        """Get current server & UI settings."""
        project = self._projects_registry.get(self._current_project_id, {})
        return {
            **self._settings,
            "access": project.get("access", "project"),
            "policy": project.get("policy", "interactive"),
        }

    def project_execution(self) -> tuple[str, str]:
        project = self._projects_registry.get(self._current_project_id, {})
        return (
            str(project.get("access", "project")),
            str(project.get("policy", "interactive")),
        )

    def set_project_execution(self, access: str, policy: str) -> None:
        if access not in ("project", "full_machine"):
            raise ValueError("invalid access scope")
        if policy not in ("interactive", "automatic", "trusted"):
            raise ValueError("invalid execution policy")
        project = self._projects_registry[self._current_project_id]
        project["access"] = access
        project["policy"] = policy
        self._save_projects()

    async def _apply_persisted_thread_continuation(
        self,
        thread_id: str,
        client: Any,
        project_id: str | None = None,
    ) -> bool:
        """Apply canonical SessionStore preference after client startup."""
        canonical = (
            self.read_project_thread(thread_id, project_id)
            if project_id
            else self.read_any_project_thread(thread_id)
        )
        session = canonical.get("session", {}) if canonical else {}
        if session.get("continuation_mode") != "continuous":
            return False
        goal = session.get("goal")
        if isinstance(goal, dict) and goal.get("status") in ("active", "running"):
            logger.info(
                "Deferring continuous continuation for active Goal thread %s",
                thread_id,
            )
            return False
        await client.update_thread_settings(
            mode="plan" if session.get("plan_active") else "default",
            continuation_mode="continuous",
            thread_id=thread_id,
        )
        return True

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update system settings."""
        self._settings.update(updates)
        self._save_settings()
        logger.info("Updated system settings: %s", updates)
        return dict(self._settings)

    # -------------------------------------------------------------------------
    # Approval Handshake Management
    # -------------------------------------------------------------------------

    async def _handle_approval_request(
        self,
        req: dict[str, Any],
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Called asynchronously by MiniAgentClient when the App Server encounters
        a sensitive tool invocation requiring human approval.
        """
        req_data = req
        req_id = str(req.get("requestId") or "")
        if not req_id:
            raise ValueError("approval request is missing requestId")
        action_name = str(req.get("actionSummary") or req.get("action") or "")
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
        if project_id:
            payload["projectId"] = project_id
            payload["data"] = {**req_data, "projectId": project_id}
        await self.broadcast_ws(payload)

        try:
            # Wait for human response from web UI (max 10 minutes timeout)
            decision = await asyncio.wait_for(future, timeout=600.0)
            logger.info("Approval resolved for %s: %s", req_id, decision)
            return decision
        except (asyncio.TimeoutError, asyncio.CancelledError):
            logger.warning("Approval request %s timed out or was cancelled", req_id)
            return {
                "decision": "deny",
                "grantScope": None,
                "reason": "Approval request timed out or cancelled",
            }
        finally:
            self._pending_approvals.pop(req_id, None)
            self._pending_approval_details.pop(req_id, None)

    async def _handle_runtime_notification(
        self, notification: dict[str, Any], project_id: str | None = None
    ) -> None:
        """Relay every App Server notification with its project context."""
        payload = dict(notification)
        if project_id:
            payload.setdefault("projectId", project_id)
            data = payload.get("data")
            if isinstance(data, dict):
                payload["data"] = {
                    **data,
                    "projectId": data.get("projectId", project_id),
                }
        await self.broadcast_ws(payload)
        if payload.get("type") == "event":
            return
        if payload.get("method") != "thread/goal/updated":
            return
        data = payload.get("data", {})
        goal = data.get("goal") if isinstance(data, dict) else None
        if not isinstance(goal, dict) or goal.get("status") in ("active", "running"):
            return
        thread_id = str(data.get("threadId") or "")
        client = (
            self._project_clients.get((project_id, thread_id))
            if project_id
            else self._clients.get(thread_id)
        )
        if not thread_id or client is None:
            return
        try:
            await self._apply_persisted_thread_continuation(thread_id, client)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to restore continuation after Goal settlement for %s: %s",
                thread_id,
                err,
            )

    def resolve_approval(
        self,
        request_id: str,
        decision: str,
        grant_scope: str | None,
        reason: str | None = None,
    ) -> bool:
        """Resolve a pending approval; grant authority remains in Host/Capabilities."""
        details = self._pending_approval_details.get(request_id)
        if not details:
            return False
        data = details.get("data", {})
        allowed_grant_scopes = data.get("allowedGrantScopes", [])
        if decision.lower() == "approve" and grant_scope not in allowed_grant_scopes:
            logger.warning("Rejected out-of-scope approval response: %s", request_id)
            return False
        if decision.lower() == "deny" and grant_scope is not None:
            return False
        if decision.lower() not in ("approve", "deny"):
            return False

        fut = self._pending_approvals.get(request_id)
        if fut and not fut.done():
            fut.set_result(
                {
                    "decision": decision,
                    "grantScope": grant_scope,
                    "reason": reason or "",
                }
            )
            return True
        return False

    def list_pending_approvals(self) -> list[str]:
        return list(self._pending_approvals.keys())

    def approval_snapshot(self) -> dict[str, Any]:
        """Expose project policy and pending requests without exposing grants."""
        access, policy = self.project_execution()
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
            "policy": policy,
            "pending_requests": pending,
            "grant_store": "host-capabilities",
            "revocable": True,
        }

    async def revoke_current_project_approvals(self) -> dict[str, Any]:
        """Restart the project-bound App Server; Host/Capabilities revoke grants."""
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
        self,
        thread_id: str,
        turn_id: str,
        task: asyncio.Task[Any] | None = None,
        project_id: str | None = None,
    ) -> None:
        """Track active turn ID and optional streaming task for responsive interrupts."""
        project_id = project_id or self._active_thread_projects.get(thread_id)
        if project_id:
            key = (project_id, thread_id)
            self._active_turns_by_project[key] = turn_id
            if task:
                self._active_tasks_by_project[key] = task
            if self._active_thread_projects.get(thread_id) != project_id:
                return
        self._active_turns[thread_id] = turn_id
        if task:
            self._active_tasks[thread_id] = task

    def clear_active_turn(self, thread_id: str, project_id: str | None = None) -> None:
        """Clear active turn tracking upon turn settlement."""
        project_id = project_id or self._active_thread_projects.get(thread_id)
        if project_id:
            key = (project_id, thread_id)
            self._active_turns_by_project.pop(key, None)
            self._active_tasks_by_project.pop(key, None)
            if self._active_thread_projects.get(thread_id) != project_id:
                return
        self._active_turns.pop(thread_id, None)
        self._active_tasks.pop(thread_id, None)

    def get_active_turn(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> str | None:
        """Retrieve current active turn ID for thread."""
        if thread_id:
            project_id = project_id or self._active_thread_projects.get(thread_id)
            if project_id:
                turn_id = self._active_turns_by_project.get((project_id, thread_id))
                if turn_id:
                    return turn_id
                return None
        if thread_id and thread_id in self._active_turns:
            return self._active_turns[thread_id]
        if self._active_turns:
            return next(iter(self._active_turns.values()))
        return None

    def cancel_active_task(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> None:
        """Cancel background stream tasks for thread or all threads."""
        if thread_id:
            project_id = project_id or self._active_thread_projects.get(thread_id)
            if project_id:
                key = (project_id, thread_id)
                task = self._active_tasks_by_project.pop(key, None)
                if task and not task.done():
                    task.cancel()
                if self._active_thread_projects.get(thread_id) != project_id:
                    return
                self._active_tasks.pop(thread_id, None)
                return
        if thread_id and thread_id in self._active_tasks:
            task = self._active_tasks.pop(thread_id)
            if not task.done():
                task.cancel()
        elif not thread_id:
            for task in list(self._active_tasks.values()):
                if not task.done():
                    task.cancel()
            for task in list(self._active_tasks_by_project.values()):
                if not task.done():
                    task.cancel()
            self._active_tasks.clear()
            self._active_tasks_by_project.clear()


# Global singleton instance
session_manager = SessionManager()
