"""Project-qualified App Server client pool and session attachment operations."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from mini_agent import MiniAgentClient

from server.config import settings

logger = logging.getLogger("mini_agent.server")


class ClientPool:
    """Own client binding and creation without duplicating Session authority."""

    def __init__(self, owner: Any) -> None:
        self.owner = owner

    def activate_thread_client(
        self, thread_id: str, project_id: str, client: MiniAgentClient
    ) -> None:
        owner = self.owner
        owner._project_clients[(project_id, thread_id)] = client
        owner._clients[thread_id] = client
        owner._client_projects[thread_id] = project_id
        owner._active_thread_projects[thread_id] = project_id
        if thread_id == "default":
            owner._client = client

    def all_clients(self) -> list[MiniAgentClient]:
        """Return all pooled clients once, including inactive project bindings."""
        owner = self.owner
        clients: list[MiniAgentClient] = []
        seen: set[int] = set()
        for client in [*owner._clients.values(), *owner._project_clients.values()]:
            if id(client) in seen:
                continue
            seen.add(id(client))
            clients.append(client)
        return clients

    def live_thread_bindings(self) -> list[tuple[str, str]]:
        """Return active ``(project_id, thread_id)`` bindings for the UI catalog."""
        owner = self.owner
        bindings = set(owner._project_clients)
        bindings.update(
            (project_id, thread_id)
            for thread_id, project_id in owner._client_projects.items()
        )
        return sorted(bindings)

    def builtin_tools_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> list[str] | None:
        owner = self.owner
        resolved_project_id = project_id or owner._active_thread_projects.get(thread_id)
        if resolved_project_id:
            selected = owner._thread_builtin_tools_by_project.get(
                (resolved_project_id, thread_id)
            )
            if selected is not None:
                return selected
        return owner._thread_builtin_tools.get(thread_id)

    def set_builtin_tools_for_thread(
        self,
        thread_id: str,
        builtin_tools: list[str],
        project_id: str | None = None,
    ) -> None:
        owner = self.owner
        resolved_project_id = project_id or owner._active_thread_projects.get(thread_id)
        if resolved_project_id:
            owner._thread_builtin_tools_by_project[(resolved_project_id, thread_id)] = (
                list(builtin_tools)
            )
        owner._thread_builtin_tools[thread_id] = list(builtin_tools)

    async def create_client(
        self,
        thread_id: str,
        project: dict[str, Any],
        session_mode: str,
        session_id: str | None = None,
    ) -> MiniAgentClient:
        owner = self.owner
        env = owner._runtime_env(project)
        env.update(
            {
                "MINI_AGENT_SESSION_MODE": session_mode,
                "MINI_AGENT_THREAD_ID": thread_id,
            }
        )
        if session_id:
            env["MINI_AGENT_SESSION_ID"] = session_id
        notification_project_id = str(project.get("id") or owner._current_project_id)
        runtime_id = uuid4().hex

        async def handle_approval(req: dict[str, Any]) -> dict[str, Any]:
            approval = dict(req)
            approval.setdefault("projectId", notification_project_id)
            approval.setdefault("threadId", thread_id)
            approval.setdefault(
                "turnId", owner.get_active_turn(thread_id, notification_project_id)
            )
            return await owner._handle_approval_request(
                approval, notification_project_id, thread_id, runtime_id
            )

        async def handle_notification(notification: dict[str, Any]) -> None:
            enriched = dict(notification)
            enriched.setdefault("projectId", notification_project_id)
            if enriched.get("type") == "runtime_error":
                enriched["_runtimeId"] = runtime_id
            if enriched.get("type") == "event":
                enriched.setdefault("threadId", thread_id)
            elif isinstance(enriched.get("data"), dict):
                enriched["data"] = {
                    **enriched["data"],
                    "projectId": enriched["data"].get(
                        "projectId", notification_project_id
                    ),
                    "threadId": enriched["data"].get("threadId", thread_id),
                }
            await owner._handle_runtime_notification(enriched, notification_project_id)

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
            await owner._apply_persisted_thread_continuation(
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

    async def get_client_for_thread_locked(
        self, thread_id: str, project_id: str | None = None
    ) -> MiniAgentClient:
        """Get or create a Thread client while the manager lock is held."""
        owner = self.owner
        target = thread_id or "default"
        project = owner._project_for_thread(target, project_id)
        resolved_project_id = str(project.get("id") or owner._current_project_id)
        binding_key = (resolved_project_id, target)
        existing = owner._project_clients.get(binding_key)
        if existing is None:
            legacy = owner._clients.get(target)
            legacy_project = owner._client_projects.get(target)
            if legacy is not None and (
                legacy_project in (None, resolved_project_id)
                or (not project_id and legacy_project is None)
            ):
                existing = legacy
                owner._project_clients[binding_key] = legacy
        if existing is not None:
            self.activate_thread_client(target, resolved_project_id, existing)
            return existing

        canonical = owner._canonical_thread(target, resolved_project_id)
        if canonical and canonical["session"]["session_status"] == "locked":
            raise RuntimeError(f"Session '{target}' is already running in another process")
        session = canonical.get("session") if canonical else None
        # Preserve the manager's instance-level seam used by route tests and
        # integrations that replace client creation with a deterministic stub.
        create_client = owner.__dict__.get("_create_client")
        if create_client is not None:
            client = await create_client(
                target,
                project,
                "resume" if session else "new",
                session.get("session_id") if session else None,
            )
        else:
            client = await self.create_client(
                target,
                project,
                "resume" if session else "new",
                session.get("session_id") if session else None,
            )
        self.activate_thread_client(target, resolved_project_id, client)
        return client

    async def get_client_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> MiniAgentClient:
        owner = self.owner
        async with owner._lock:
            return await self.get_client_for_thread_locked(
                thread_id or "default", project_id
            )

    async def get_client_for_project(
        self, project_id: str | None = None, thread_id: str | None = None
    ) -> MiniAgentClient:
        owner = self.owner
        target_project = project_id or owner._current_project_id
        if target_project not in owner._projects_registry:
            target_project = next(
                (
                    project_key
                    for project_key, project in owner._projects_registry.items()
                    if project.get("name") == target_project
                ),
                target_project,
            )
        if target_project not in owner._projects_registry:
            raise KeyError(f"Project '{target_project}' not found")
        if (
            owner._client is not None
            and owner._client_projects.get("default") == target_project
        ):
            return owner._client
        if thread_id:
            return await self.get_client_for_thread(thread_id, target_project)
        project_default = owner._project_clients.get((target_project, "default"))
        if project_default is not None:
            if target_project == owner._current_project_id:
                owner._client = project_default
            return project_default
        for (bound_project, _bound_thread), client in owner._project_clients.items():
            if bound_project == target_project:
                return client
        return await self.get_client_for_thread("default", target_project)

    def live_thread_ids(self) -> list[str]:
        return list(self.owner._clients)

    def bind_thread_client(
        self,
        thread_id: str,
        client: MiniAgentClient,
        project_id: str | None = None,
    ) -> None:
        owner = self.owner
        project = owner._project_for_thread(thread_id, project_id)
        resolved_project_id = str(project.get("id") or owner._current_project_id)
        binding_key = (resolved_project_id, thread_id)
        existing = owner._project_clients.get(binding_key)
        if existing is not None and (existing is not client):
            raise RuntimeError(
                f"Thread '{thread_id}' is already bound to Project "
                f"'{resolved_project_id}'"
            )
        self.activate_thread_client(thread_id, resolved_project_id, client)

    async def fork_thread(
        self,
        source_thread_id: str,
        new_thread_id: str,
        title: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        owner = self.owner
        async with owner._lock:
            client = await self.get_client_for_thread_locked(source_thread_id, project_id)
            source_project = owner._client_projects.get(source_thread_id)
            if not source_project:
                source_project = owner._active_thread_projects.get(source_thread_id)
            if not source_project:
                source_project = owner._project_for_thread(
                    source_thread_id, project_id
                ).get("id")
            existing_project = owner._active_thread_projects.get(new_thread_id)
            if existing_project and existing_project != source_project:
                raise RuntimeError(
                    f"Thread '{new_thread_id}' is already bound to Project "
                    f"'{existing_project}'"
                )
            result = await client.fork_thread(
                source_thread_id=source_thread_id,
                new_thread_id=new_thread_id,
            )
            source_meta = owner.get_thread_meta(source_thread_id, source_project)
            fork_title = title or f"{source_meta.get('title', source_thread_id)} (Fork)"
            owner.set_thread_meta(
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
        owner = self.owner
        if project_id:
            owner.set_thread_meta(thread_id, {"project": project_id})
        await self.get_client_for_thread(thread_id, project_id)
        return thread_id

    async def attach_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> dict[str, Any]:
        """Attach Studio to a resumable Session without stealing a live lock."""
        owner = self.owner
        async with owner._lock:
            target = thread_id or "default"
            project = owner._project_for_thread(target, project_id)
            resolved_project_id = str(project.get("id") or owner._current_project_id)
            if project_id:
                owner._active_thread_projects[target] = resolved_project_id
                canonical = owner._canonical_thread(target, resolved_project_id)
            else:
                canonical = owner._canonical_thread(target)
                canonical_project = (
                    canonical.get("session", {}).get("project_id")
                    if canonical
                    else None
                )
                if canonical_project in owner._projects_registry:
                    resolved_project_id = str(canonical_project)
                owner._active_thread_projects.setdefault(target, resolved_project_id)

            existing = owner._project_clients.get((resolved_project_id, target))
            if existing is None:
                legacy = owner._clients.get(target)
                legacy_project = owner._client_projects.get(target)
                if legacy is not None and legacy_project in (None, resolved_project_id):
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

            await self.get_client_for_thread_locked(target, resolved_project_id)
            refreshed = owner._canonical_thread(target, resolved_project_id)
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
