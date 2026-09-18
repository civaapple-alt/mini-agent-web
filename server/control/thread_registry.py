"""Project-qualified Thread metadata and canonical SessionStore projections."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from server.session_catalog import session_catalog
from server.thread_titles import is_default_thread_title


class _ThreadOwner(Protocol):
    _active_thread_projects: dict[str, str]
    _client_projects: dict[str, str]
    _current_project_id: str
    _current_project_path: Path
    _projects_registry: dict[str, dict[str, Any]]
    _thread_metadata: dict[str, dict[str, Any]]
    _thread_metadata_by_project: dict[tuple[str, str], dict[str, Any]]

    def _save_thread_for_id(self, thread_id: str) -> None: ...

    def _save_project_threads(self, project_id: str) -> None: ...


class ThreadRegistry:
    """Own Thread identity/metadata projections without owning execution."""

    def __init__(self, owner: _ThreadOwner) -> None:
        self._owner = owner

    def project_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        owner = self._owner
        candidate = (
            project_id
            or owner._active_thread_projects.get(thread_id)
            or owner._thread_metadata.get(thread_id, {}).get("project")
        )
        if candidate in owner._projects_registry:
            return owner._projects_registry[candidate]
        for project in owner._projects_registry.values():
            if project.get("name") == candidate:
                return project
        canonical = self.read_any_project_thread(thread_id)
        if canonical:
            canonical_project = canonical.get("session", {}).get("project_id")
            if canonical_project in owner._projects_registry:
                return owner._projects_registry[canonical_project]
        return owner._projects_registry[owner._current_project_id]

    def resolve_thread_project(
        self, thread_id: str, project_id: str | None = None
    ) -> str:
        owner = self._owner
        if project_id:
            return str(project_id)
        bound_project = owner._active_thread_projects.get(
            thread_id
        ) or owner._client_projects.get(thread_id)
        if bound_project:
            return str(bound_project)
        project = self.project_for_thread(thread_id)
        return str(project.get("id") or owner._current_project_id)

    def canonical_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        owner = self._owner
        if project_id:
            project = self.project_for_thread(thread_id, project_id)
            return owner.read_project_thread(thread_id, project.get("id"))
        active_project = owner._active_thread_projects.get(thread_id)
        if active_project:
            return owner.read_project_thread(thread_id, active_project)
        return owner.read_any_project_thread(thread_id)

    def metadata_project_id(self, thread_id: str, project_id: str | None = None) -> str:
        owner = self._owner
        candidate = (
            project_id
            or owner._active_thread_projects.get(thread_id)
            or owner._thread_metadata.get(thread_id, {}).get("project")
            or owner._current_project_id
        )
        if candidate in owner._projects_registry:
            return str(candidate)
        for pid, project in owner._projects_registry.items():
            if project.get("name") == candidate:
                return pid
        return str(candidate)

    def get_thread_meta(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        owner = self._owner
        resolved_project_id = self.metadata_project_id(thread_id, project_id)
        key = (resolved_project_id, thread_id)
        meta = owner._thread_metadata_by_project.get(key)
        if meta is None:
            legacy = owner._thread_metadata.get(thread_id)
            if (
                legacy
                and self.metadata_project_id(thread_id, str(legacy.get("project")))
                == resolved_project_id
            ):
                meta = legacy
            else:
                now = datetime.now(timezone.utc).isoformat()
                meta = {
                    "title": f"会话 {thread_id}",
                    "project": resolved_project_id,
                    "summary": "",
                    "created_at": now,
                    "updated_at": now,
                    "pinned": False,
                }
            owner._thread_metadata_by_project[key] = meta
            if project_id is None:
                owner._thread_metadata[thread_id] = meta
                owner._save_thread_for_id(thread_id)
        if project_id is None:
            owner._thread_metadata[thread_id] = meta
        return meta

    def set_thread_meta(
        self, thread_id: str, updates: dict[str, Any], project_id: str | None = None
    ) -> dict[str, Any]:
        owner = self._owner
        requested_project = project_id or updates.get("project")
        resolved_project_id = self.metadata_project_id(thread_id, requested_project)
        meta = self.get_thread_meta(thread_id, resolved_project_id)
        old_project = meta.get("project")
        normalized_updates = dict(updates)
        if "project" in normalized_updates:
            normalized_updates["project"] = self.metadata_project_id(
                thread_id, str(normalized_updates["project"])
            )
        meta.update(normalized_updates)
        meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        if old_project and old_project != meta.get("project"):
            owner._thread_metadata_by_project.pop((str(old_project), thread_id), None)
        owner._thread_metadata_by_project[(str(meta.get("project")), thread_id)] = meta
        owner._thread_metadata[thread_id] = meta
        new_project = meta.get("project")
        if old_project and old_project != new_project:
            owner._save_project_threads(old_project)
        if new_project:
            owner._save_project_threads(new_project)
        else:
            owner._save_thread_for_id(thread_id)
        return meta

    def list_all_thread_meta(self) -> dict[str, dict[str, Any]]:
        return dict(self._owner._thread_metadata)

    def list_project_sessions(
        self, project_id: str | None = None, limit: int = 64, cursor: str | None = None
    ) -> dict[str, Any]:
        owner = self._owner
        target_id = project_id or owner._current_project_id
        project = owner._projects_registry.get(target_id)
        if not project:
            raise KeyError(f"Project '{target_id}' not found")
        result = session_catalog.list_sessions(
            Path(project["primary_path"]), target_id, limit=limit, cursor=cursor
        )
        for session in result["data"]:
            meta = self.get_thread_meta(session["thread_id"], target_id)
            metadata_title = meta.get("title")
            if not is_default_thread_title(metadata_title, session["thread_id"]):
                session["title"] = metadata_title
            session["summary"] = meta.get("summary") or session["summary"]
        return result

    def list_all_project_sessions(self, limit: int = 128) -> list[dict[str, Any]]:
        owner = self._owner
        sessions_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for project_id in owner._projects_registry:
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
        owner = self._owner
        target_id = project_id or owner._current_project_id
        project = owner._projects_registry.get(target_id)
        if not project:
            return None
        return session_catalog.read_thread(
            Path(project["primary_path"]), target_id, thread_id
        )

    def read_any_project_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        owner = self._owner
        if project_id:
            project = self.project_for_thread(thread_id, project_id)
            return owner.read_project_thread(thread_id, project.get("id"))
        metadata_project = owner._active_thread_projects.get(
            thread_id
        ) or owner._thread_metadata.get(thread_id, {}).get("project")
        ordered_ids: list[str] = []
        if metadata_project in owner._projects_registry:
            ordered_ids.append(metadata_project)
        ordered_ids.extend(
            candidate
            for candidate in owner._projects_registry
            if candidate not in ordered_ids
        )
        seen_workspaces: set[str] = set()
        for candidate_project_id in ordered_ids:
            project = owner._projects_registry[candidate_project_id]
            workspace_key = str(Path(project["primary_path"]).resolve()).casefold()
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            result = owner.read_project_thread(thread_id, candidate_project_id)
            if result:
                return result
        return None

    def list_project_thread_items(
        self,
        thread_id: str,
        project_id: str | None = None,
        turn_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> dict[str, Any] | None:
        owner = self._owner
        target_id = project_id or owner._current_project_id
        project = owner._projects_registry.get(target_id)
        if not project:
            return None
        return session_catalog.list_thread_items(
            Path(project["primary_path"]),
            target_id,
            thread_id,
            turn_id,
            cursor,
            limit,
            sort_direction,
        )

    def list_any_project_thread_items(
        self,
        thread_id: str,
        project_id: str | None = None,
        turn_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> dict[str, Any] | None:
        owner = self._owner
        if project_id:
            project = self.project_for_thread(thread_id, project_id)
            return self.list_project_thread_items(
                thread_id,
                project.get("id"),
                turn_id,
                cursor,
                limit,
                sort_direction,
            )
        metadata_project = owner._active_thread_projects.get(
            thread_id
        ) or owner._thread_metadata.get(thread_id, {}).get("project")
        ordered_ids: list[str] = []
        if metadata_project in owner._projects_registry:
            ordered_ids.append(metadata_project)
        ordered_ids.extend(
            candidate
            for candidate in owner._projects_registry
            if candidate not in ordered_ids
        )
        seen_workspaces: set[str] = set()
        for candidate_project_id in ordered_ids:
            project = owner._projects_registry[candidate_project_id]
            workspace_key = str(Path(project["primary_path"]).resolve()).casefold()
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            result = self.list_project_thread_items(
                thread_id,
                candidate_project_id,
                turn_id,
                cursor,
                limit,
                sort_direction,
            )
            if result:
                return result
        return None

    def session_path_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> Path | None:
        owner = self._owner
        metadata_project = (
            project_id
            or owner._active_thread_projects.get(thread_id)
            or owner._thread_metadata.get(thread_id, {}).get("project")
        )
        ordered_ids: list[str] = []
        if metadata_project in owner._projects_registry:
            ordered_ids.append(metadata_project)
        ordered_ids.extend(
            candidate
            for candidate in owner._projects_registry
            if candidate not in ordered_ids
        )
        seen_workspaces: set[str] = set()
        for candidate_project_id in ordered_ids:
            project = owner._projects_registry[candidate_project_id]
            workspace = Path(project["primary_path"])
            workspace_key = str(workspace.resolve()).casefold()
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            path = session_catalog.find_session_path(workspace, thread_id)
            if path:
                return path
        return None

    def project_path_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> Path:
        owner = self._owner
        if project_id:
            project = self.project_for_thread(thread_id or "default", project_id)
            return Path(project["primary_path"]).resolve()
        if thread_id:
            bound_project = owner._active_thread_projects.get(thread_id)
            if bound_project and bound_project in owner._projects_registry:
                return Path(
                    owner._projects_registry[bound_project]["primary_path"]
                ).resolve()
        return owner._current_project_path.resolve()
