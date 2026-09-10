"""Project-scoped active Turn and stream-task tracking."""

from __future__ import annotations

import asyncio
from typing import Any, Protocol


class _TurnOwner(Protocol):
    _active_thread_projects: dict[str, str]
    _active_turns: dict[str, str]
    _active_tasks: dict[str, asyncio.Task[Any]]
    _active_turns_by_project: dict[tuple[str, str], str]
    _active_tasks_by_project: dict[tuple[str, str], asyncio.Task[Any]]


class TurnRegistry:
    """Own active Turn bookkeeping without owning execution or cancellation policy."""

    def __init__(self, owner: _TurnOwner) -> None:
        self._owner = owner

    def set_active_turn(
        self,
        thread_id: str,
        turn_id: str,
        task: asyncio.Task[Any] | None = None,
        project_id: str | None = None,
    ) -> None:
        owner = self._owner
        project_id = project_id or owner._active_thread_projects.get(thread_id)
        if project_id:
            key = (project_id, thread_id)
            owner._active_turns_by_project[key] = turn_id
            if task:
                owner._active_tasks_by_project[key] = task
            if owner._active_thread_projects.get(thread_id) != project_id:
                return
        owner._active_turns[thread_id] = turn_id
        if task:
            owner._active_tasks[thread_id] = task

    def clear_active_turn(
        self,
        thread_id: str,
        project_id: str | None = None,
        turn_id: str | None = None,
        task: asyncio.Task[Any] | None = None,
    ) -> None:
        owner = self._owner
        project_id = project_id or owner._active_thread_projects.get(thread_id)
        if project_id:
            key = (project_id, thread_id)
            if turn_id and owner._active_turns_by_project.get(key) not in (None, turn_id):
                return
            if task and owner._active_tasks_by_project.get(key) not in (None, task):
                return
            owner._active_turns_by_project.pop(key, None)
            owner._active_tasks_by_project.pop(key, None)
            if owner._active_thread_projects.get(thread_id) != project_id:
                return
        else:
            if turn_id and owner._active_turns.get(thread_id) not in (None, turn_id):
                return
            if task and owner._active_tasks.get(thread_id) not in (None, task):
                return
        owner._active_turns.pop(thread_id, None)
        owner._active_tasks.pop(thread_id, None)

    def get_active_turn(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> str | None:
        owner = self._owner
        if thread_id:
            project_id = project_id or owner._active_thread_projects.get(thread_id)
            if project_id:
                return owner._active_turns_by_project.get((project_id, thread_id))
            if thread_id in owner._active_turns:
                return owner._active_turns[thread_id]
        if owner._active_turns:
            return next(iter(owner._active_turns.values()))
        return None

    def cancel_active_task(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> None:
        owner = self._owner
        if thread_id:
            project_id = project_id or owner._active_thread_projects.get(thread_id)
            if project_id:
                key = (project_id, thread_id)
                task = owner._active_tasks_by_project.pop(key, None)
                if task and not task.done():
                    task.cancel()
                if owner._active_thread_projects.get(thread_id) != project_id:
                    return
                owner._active_tasks.pop(thread_id, None)
                return
        if thread_id and thread_id in owner._active_tasks:
            task = owner._active_tasks.pop(thread_id)
            if not task.done():
                task.cancel()
        elif not thread_id:
            for task in list(owner._active_tasks.values()):
                if not task.done():
                    task.cancel()
            for task in list(owner._active_tasks_by_project.values()):
                if not task.done():
                    task.cancel()
            owner._active_tasks.clear()
            owner._active_tasks_by_project.clear()
