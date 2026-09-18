"""Project registry and Web Studio manifest persistence.

This module owns the Gateway's project/UI manifest. Canonical SessionStore
history remains in ``session_catalog`` and execution remains in App Server.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.persistence import atomic_write_json
from server.session_catalog import session_catalog

logger = logging.getLogger("mini_agent.server")


class ProjectRegistry:
    """Own project registration and Web-side manifest storage for one manager."""

    def __init__(self, owner: Any) -> None:
        self._owner = owner
        self._state_dir: Path | None = None

    @property
    def state_dir(self) -> Path:
        if self._state_dir is None:
            raise RuntimeError("ProjectRegistry state directory is not configured")
        return self._state_dir

    def set_state_paths(self, base_dir: Path) -> None:
        self._state_dir = base_dir
        self._settings_file = base_dir / "settings.json"
        self._projects_file = base_dir / "projects.json"
        self._projects_dir = base_dir / "projects"

    @staticmethod
    def _normalize_subagent_config(raw: Any) -> dict[str, int]:
        """Keep only the persisted project capacity policy."""
        if not isinstance(raw, dict):
            return {}
        max_children = raw.get("max_concurrent_children")
        if (
            isinstance(max_children, int)
            and not isinstance(max_children, bool)
            and 1 <= max_children <= 8
        ):
            return {"max_concurrent_children": max_children}
        return {}

    def load_state(self) -> None:
        """Load settings, projects and partitioned Thread metadata."""
        owner = self._owner
        if self._settings_file.is_file():
            try:
                s_data = json.loads(self._settings_file.read_text(encoding="utf-8"))
                if isinstance(s_data, dict):
                    allowed_settings = set(owner._settings)
                    owner._settings.update(
                        {
                            key: value
                            for key, value in s_data.items()
                            if key in allowed_settings
                        }
                    )
                    owner._settings["subagent"] = self._normalize_subagent_config(
                        owner._settings.get("subagent")
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "Failed to parse settings from %s: %s", self._settings_file, err
                )

        if self._projects_file.is_file():
            try:
                p_data = json.loads(self._projects_file.read_text(encoding="utf-8"))
                loaded_projects = p_data.get("projects", {})
                clean_projects = {}
                for pid, project in loaded_projects.items():
                    project.pop("approval", None)
                    project.setdefault("policy", "interactive")
                    project.setdefault("builtin_skill_groups", ["pstack"])
                    project["subagent"] = self._normalize_subagent_config(
                        project.get("subagent")
                    )
                    project.setdefault("notebook", {})
                    project_path = project.get("primary_path", "")
                    if (
                        "pytest" in project_path.lower()
                        or "temp" in project_path.lower()
                    ) and not Path(project_path).exists():
                        continue
                    clean_projects[pid] = project
                owner._projects_registry = clean_projects
                persisted_project_id = p_data.get("current_project_id")
                if (
                    persisted_project_id
                    and persisted_project_id in owner._projects_registry
                ):
                    owner._current_project_id = persisted_project_id
                    owner._current_project_path = Path(
                        owner._projects_registry[persisted_project_id].get(
                            "primary_path", str(owner._current_project_path)
                        )
                    )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "Failed to parse projects from %s: %s", self._projects_file, err
                )

        owner._thread_metadata = {}
        owner._thread_metadata_by_project = {}
        if self._projects_dir.is_dir():
            for project_dir in self._projects_dir.iterdir():
                threads_file = project_dir / "threads.json"
                if not project_dir.is_dir() or not threads_file.is_file():
                    continue
                try:
                    thread_data = json.loads(threads_file.read_text(encoding="utf-8"))
                    if not isinstance(thread_data, dict):
                        continue
                    for thread_id, metadata in thread_data.items():
                        if not isinstance(metadata, dict):
                            continue
                        metadata = dict(metadata)
                        project_id = str(metadata.get("project") or project_dir.name)
                        if (
                            project_id not in owner._projects_registry
                            and project_dir.name in owner._projects_registry
                        ):
                            project_id = project_dir.name
                        metadata["project"] = project_id
                        metadata.pop("continuation_mode", None)
                        owner._thread_metadata_by_project[(project_id, thread_id)] = (
                            metadata
                        )
                        owner._thread_metadata[thread_id] = metadata
                except Exception as err:  # noqa: BLE001
                    logger.warning(
                        "Failed to load threads from %s: %s", threads_file, err
                    )

        current_name = owner._current_project_path.name
        current_resolved = owner._current_project_path.resolve()
        already_registered = any(
            Path(project.get("primary_path", "")).resolve() == current_resolved
            for project in owner._projects_registry.values()
        )
        if not already_registered and current_name not in owner._projects_registry:
            owner._projects_registry[current_name] = {
                "id": current_name,
                "name": current_name,
                "pinned": False,
                "primary_path": str(owner._current_project_path),
                "source_folders": [
                    {
                        "name": current_name,
                        "path": str(owner._current_project_path),
                        "is_primary": True,
                    }
                ],
                "access": "project",
                "policy": "interactive",
                "builtin_skill_groups": ["pstack"],
                "subagent": {},
                "notebook": {},
            }

        if owner._current_project_id not in owner._projects_registry:
            matching_project = next(
                (
                    pid
                    for pid, project in owner._projects_registry.items()
                    if Path(project.get("primary_path", "")).resolve()
                    == current_resolved
                ),
                None,
            )
            owner._current_project_id = matching_project or current_name

        if not owner._thread_metadata:
            now = datetime.now(timezone.utc).isoformat()
            owner._thread_metadata = {
                "default": {
                    "title": "默认会话 (Default Session)",
                    "project": owner._current_project_id,
                    "summary": "Main interactive coding workspace",
                    "created_at": now,
                    "updated_at": now,
                    "pinned": True,
                }
            }

        self.save_projects()
        self.save_settings()
        if owner._current_project_id:
            self.save_project_threads(owner._current_project_id)

    def save_settings(self) -> None:
        try:
            atomic_write_json(self._settings_file, self._owner._settings)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist settings to %s: %s", self._settings_file, err
            )

    def save_projects(self) -> None:
        try:
            atomic_write_json(
                self._projects_file,
                {
                    "current_project_id": self._owner._current_project_id,
                    "projects": self._owner._projects_registry,
                },
            )
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist projects to %s: %s", self._projects_file, err
            )

    def save_project_threads(self, project_id: str) -> None:
        if not project_id:
            return
        owner = self._owner
        try:
            project_metadata = {
                thread_id: metadata
                for (
                    bound_project,
                    thread_id,
                ), metadata in owner._thread_metadata_by_project.items()
                if bound_project == project_id
            }
            for thread_id, metadata in owner._thread_metadata.items():
                if metadata.get("project") == project_id:
                    project_metadata.setdefault(thread_id, metadata)
            target_file = self._projects_dir / project_id / "threads.json"
            atomic_write_json(target_file, project_metadata)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to persist threads for project %s to %s: %s",
                project_id,
                self._projects_dir / project_id / "threads.json",
                err,
            )

    def save_thread_for_id(self, thread_id: str) -> None:
        metadata = self._owner._thread_metadata.get(thread_id, {})
        project_id = metadata.get("project") or self._owner._current_project_id
        if project_id:
            self.save_project_threads(project_id)

    def save_all_threads(self) -> None:
        owner = self._owner
        project_ids = set(owner._projects_registry) | {
            metadata.get("project")
            for metadata in owner._thread_metadata.values()
            if metadata.get("project")
        }
        for project_id in project_ids:
            if project_id:
                self.save_project_threads(project_id)

    def save_state(self) -> None:
        self.save_settings()
        self.save_projects()
        self.save_all_threads()

    def get_projects(self) -> dict[str, Any]:
        owner = self._owner
        projects = []
        for project in owner._projects_registry.values():
            project_id = project["id"]
            project_threads = [
                metadata
                for (
                    bound_project,
                    _thread_id,
                ), metadata in owner._thread_metadata_by_project.items()
                if bound_project == project_id
            ]
            if not project_threads:
                project_threads = [
                    metadata
                    for metadata in owner._thread_metadata.values()
                    if metadata.get("project") in (project_id, project.get("name"))
                ]
            sessions = session_catalog.list_sessions(
                Path(project["primary_path"]), project_id, limit=128
            )["data"]
            projects.append(
                {
                    **project,
                    "threads_count": len(project_threads),
                    "active_threads_count": sum(
                        item.get("turn_active", False) for item in sessions
                    ),
                    "sessions_count": len(sessions),
                }
            )
        current_project = owner._projects_registry.get(
            owner._current_project_id,
            next(iter(owner._projects_registry.values())),
        )
        return {
            "current_project": current_project,
            "projects": projects,
            "recent_projects": projects,
        }

    def create_project(
        self,
        name: str,
        path: str | None = None,
        source_folders: list[dict[str, Any]] | None = None,
        init_readme: bool = True,
    ) -> dict[str, Any]:
        owner = self._owner
        base_id = name.lower().replace(" ", "-")
        project_id = base_id
        count = 1
        while project_id in owner._projects_registry:
            project_id = f"{base_id}-{count}"
            count += 1

        target_dir = (
            Path(path).resolve()
            if path
            else (owner._current_project_path.parent / name).resolve()
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        if init_readme:
            readme_path = target_dir / "README.md"
            if not readme_path.exists():
                readme_path.write_text(
                    f"# {name}\n\nProject initialized via Mini Agent Studio.\n",
                    encoding="utf-8",
                )

        sources = source_folders or [
            {"name": name, "path": str(target_dir), "is_primary": True}
        ]
        project = {
            "id": project_id,
            "name": name,
            "pinned": False,
            "primary_path": str(target_dir),
            "source_folders": sources,
            "access": "project",
            "policy": "interactive",
            "builtin_skill_groups": ["pstack"],
            "subagent": {},
            "notebook": {},
        }
        owner._projects_registry[project_id] = project
        owner._current_project_id = project_id
        owner._current_project_path = target_dir
        self.save_projects()
        return project

    def update_project(
        self, project_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        owner = self._owner
        project = owner._projects_registry.get(project_id)
        if not project:
            for key, candidate in owner._projects_registry.items():
                if candidate.get("name") == project_id:
                    project = candidate
                    project_id = key
                    break
        if not project:
            raise KeyError(f"Project '{project_id}' not found")

        if updates.get("name"):
            project["name"] = updates["name"]
        if "pinned" in updates:
            project["pinned"] = bool(updates["pinned"])
        if updates.get("access") in ("project", "full_machine"):
            project["access"] = updates["access"]
        if updates.get("policy") in ("interactive", "automatic", "trusted"):
            project["policy"] = updates["policy"]
        if "builtin_skill_groups" in updates:
            groups = updates["builtin_skill_groups"]
            if isinstance(groups, list) and all(
                isinstance(group, str) and group.strip() for group in groups
            ):
                project["builtin_skill_groups"] = list(dict.fromkeys(groups))
        if isinstance(updates.get("subagent"), dict):
            project["subagent"] = self._normalize_subagent_config(
                updates["subagent"]
            )
        if isinstance(updates.get("notebook"), dict):
            raw = updates["notebook"]
            max_entries = raw.get("max_entries")
            max_entry_bytes = raw.get("max_entry_bytes")
            if max_entry_bytes is None:
                max_entry_bytes = raw.get("max_entry_chars")
            if (
                isinstance(max_entries, int)
                and not isinstance(max_entries, bool)
                and 1 <= max_entries <= 64
                and isinstance(max_entry_bytes, int)
                and not isinstance(max_entry_bytes, bool)
                and 256 <= max_entry_bytes <= 4096
            ):
                project["notebook"] = {
                    "max_entries": max_entries,
                    "max_entry_bytes": max_entry_bytes,
                }
        if isinstance(updates.get("source_folders"), list):
            project["source_folders"] = updates["source_folders"]
            primary = next(
                (
                    folder["path"]
                    for folder in project["source_folders"]
                    if folder.get("is_primary")
                ),
                project["source_folders"][0]["path"]
                if project["source_folders"]
                else project["primary_path"],
            )
            project["primary_path"] = primary
            if owner._current_project_id == project_id:
                owner._current_project_path = Path(primary)
        self.save_projects()
        return project

    def delete_project(self, project_id: str) -> bool:
        owner = self._owner
        if project_id not in owner._projects_registry:
            return False
        del owner._projects_registry[project_id]
        if owner._current_project_id == project_id and owner._projects_registry:
            owner._current_project_id = next(iter(owner._projects_registry))
            owner._current_project_path = Path(
                owner._projects_registry[owner._current_project_id]["primary_path"]
            )
        self.save_projects()
        project_dir = self._projects_dir / project_id
        if project_dir.is_dir():
            shutil.rmtree(project_dir, ignore_errors=True)
        owner._thread_metadata = {
            thread_id: metadata
            for thread_id, metadata in owner._thread_metadata.items()
            if metadata.get("project") != project_id
        }
        owner._thread_metadata_by_project = {
            key: metadata
            for key, metadata in owner._thread_metadata_by_project.items()
            if key[0] != project_id
        }
        owner._project_clients = {
            key: client
            for key, client in owner._project_clients.items()
            if key[0] != project_id
        }
        owner._active_thread_projects = {
            thread_id: bound_project
            for thread_id, bound_project in owner._active_thread_projects.items()
            if bound_project != project_id
        }
        return True

    def toggle_pin_project(self, project_id: str) -> dict[str, Any]:
        project = self._owner._projects_registry.get(project_id)
        if not project:
            raise KeyError(f"Project '{project_id}' not found")
        project["pinned"] = not project.get("pinned", False)
        self.save_projects()
        return project

    def switch_project(self, project_id_or_path: str) -> dict[str, Any]:
        owner = self._owner
        if project_id_or_path in owner._projects_registry:
            owner._current_project_id = project_id_or_path
            project = owner._projects_registry[project_id_or_path]
            owner._current_project_path = Path(project["primary_path"])
            self.save_projects()
            return project

        for project_id, project in owner._projects_registry.items():
            if project.get("primary_path") == project_id_or_path or any(
                folder.get("path") == project_id_or_path
                for folder in project.get("source_folders", [])
            ):
                owner._current_project_id = project_id
                owner._current_project_path = Path(project["primary_path"])
                self.save_projects()
                return project

        project_path = Path(project_id_or_path).resolve()
        if not project_path.is_dir():
            raise FileNotFoundError(
                f"Project directory not found: {project_id_or_path}"
            )
        owner._current_project_path = project_path
        project_id = project_path.name.lower()
        project = {
            "id": project_id,
            "name": project_path.name,
            "pinned": False,
            "primary_path": str(project_path),
            "source_folders": [
                {
                    "name": project_path.name,
                    "path": str(project_path),
                    "is_primary": True,
                }
            ],
            "access": "project",
            "policy": "interactive",
            "builtin_skill_groups": ["pstack"],
        }
        owner._projects_registry[project_id] = project
        owner._current_project_id = project_id
        self.save_projects()
        return project

    @property
    def current_project_path(self) -> Path:
        return self._owner._current_project_path

    @property
    def current_source_folders(self) -> list[dict[str, Any]]:
        owner = self._owner
        project = owner._projects_registry.get(owner._current_project_id)
        if project and isinstance(project.get("source_folders"), list):
            return project["source_folders"]
        return [
            {
                "name": owner._current_project_path.name,
                "path": str(owner._current_project_path),
                "is_primary": True,
            }
        ]

    def runtime_env(self, project: dict[str, Any] | None = None) -> dict[str, str]:
        owner = self._owner
        read_roots: list[str] = []
        write_roots: list[str] = []
        project = project or owner._projects_registry.get(owner._current_project_id, {})
        primary = Path(
            project.get("primary_path", owner._current_project_path)
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
            "MINI_AGENT_PROJECT_ID": str(project.get("id", owner._current_project_id)),
            "MINI_AGENT_BUILTIN_SKILL_GROUPS": ",".join(
                project.get("builtin_skill_groups", ["pstack"])
            ),
            "MINI_AGENT_EXTRA_READ_ROOTS": os.pathsep.join(read_roots),
            "MINI_AGENT_EXTRA_WRITE_ROOTS": os.pathsep.join(write_roots),
        }
        effective_settings = owner.get_settings(project.get("id"))
        notebook = effective_settings.get("notebook") or {}
        try:
            max_entries = int(notebook.get("max_entries", 64))
            max_entry_bytes = int(
                notebook.get(
                    "max_entry_bytes",
                    notebook.get("max_entry_chars", 4096),
                )
            )
        except (TypeError, ValueError):
            max_entries, max_entry_bytes = 64, 4096
        env["MINI_AGENT_NOTEBOOK_MAX_ENTRIES"] = str(max(1, min(max_entries, 64)))
        env["MINI_AGENT_NOTEBOOK_MAX_ENTRY_BYTES"] = str(
            max(256, min(max_entry_bytes, 4096))
        )
        # Older runtimes accept the legacy name; keep it during the rolling
        # upgrade so a project does not silently fall back to the default.
        env["MINI_AGENT_NOTEBOOK_MAX_ENTRY_CHARS"] = env[
            "MINI_AGENT_NOTEBOOK_MAX_ENTRY_BYTES"
        ]
        if project.get("name"):
            env["MINI_AGENT_PROJECT_NAME"] = str(project["name"])
        return env
