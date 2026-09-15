"""Typed Gateway errors for Session fork admission conflicts."""

from __future__ import annotations

from typing import Literal, TypedDict

from mini_agent.errors import SESSION_FORK_CONFLICT_CODE


class ContextPolicyConflictData(TypedDict):
    """Bounded machine-readable data for a local fork-policy conflict."""

    kind: Literal["contextPolicy"]
    childThreadId: str
    requestedContextPolicy: str
    existingContextPolicy: str


class SessionForkConflictError(Exception):
    """A Gateway binding conflicts with an existing child fork policy."""

    code = SESSION_FORK_CONFLICT_CODE
    message = "session fork conflicts with existing child"

    def __init__(
        self,
        *,
        child_thread_id: str,
        requested_context_policy: str,
        existing_context_policy: str,
    ) -> None:
        self.data: ContextPolicyConflictData = {
            "kind": "contextPolicy",
            "childThreadId": child_thread_id,
            "requestedContextPolicy": requested_context_policy,
            "existingContextPolicy": existing_context_policy,
        }
        super().__init__(self.message)
