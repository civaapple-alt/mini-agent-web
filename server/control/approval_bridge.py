"""Approval wait/resolution bridge for Gateway-controlled runtimes."""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from typing import Any, Protocol

logger = logging.getLogger("mini_agent.server")


class _ApprovalOwner(Protocol):
    _pending_approvals: dict[str, asyncio.Future[dict[str, Any]]]
    _pending_approval_details: dict[str, dict[str, Any]]
    _interrupted_turns: OrderedDict[tuple[str, str, str], None]
    _current_project_id: str

    def get_active_turn(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> str | None: ...

    async def broadcast_ws(self, message: dict[str, Any]) -> None: ...

    def project_execution(self, project_id: str | None = None) -> tuple[str, str]: ...

    async def restart_for_current_project(self) -> None: ...


class ApprovalBridge:
    """Own approval wait state while leaving grant authority in Host/Capabilities."""

    def __init__(self, owner: _ApprovalOwner, max_interrupted_turns: int) -> None:
        self._owner = owner
        self._max_interrupted_turns = max_interrupted_turns

    @staticmethod
    def approval_identity(
        details: dict[str, Any],
    ) -> tuple[str | None, str | None, str | None]:
        data = details.get("data", {})
        return (
            details.get("projectId") or data.get("projectId") or data.get("project_id"),
            details.get("threadId") or data.get("threadId") or data.get("thread_id"),
            details.get("turnId") or data.get("turnId") or data.get("turn_id"),
        )

    @staticmethod
    def turn_identity(
        project_id: str | None, thread_id: str | None, turn_id: str | None
    ) -> tuple[str, str, str] | None:
        if not thread_id or not turn_id:
            return None
        return (str(project_id or ""), str(thread_id), str(turn_id))

    def mark_turn_interrupted(
        self,
        thread_id: str | None,
        turn_id: str | None,
        project_id: str | None = None,
    ) -> None:
        """Remember a stopped Turn so late approval requests are denied."""
        key = self.turn_identity(project_id, thread_id, turn_id)
        if key is None:
            return
        interrupted_turns = self._owner._interrupted_turns
        interrupted_turns[key] = None
        interrupted_turns.move_to_end(key)
        while len(interrupted_turns) > self._max_interrupted_turns:
            interrupted_turns.popitem(last=False)

    def is_turn_interrupted(
        self,
        thread_id: str | None,
        turn_id: str | None,
        project_id: str | None = None,
    ) -> bool:
        key = self.turn_identity(project_id, thread_id, turn_id)
        return key is not None and key in self._owner._interrupted_turns

    async def cancel_pending_approvals(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        runtime_id: str | None = None,
        reason: str = "当前 Turn 已停止，审批已失效",
    ) -> int:
        """Deny and remove approval waits matching one runtime/Turn identity."""
        owner = self._owner
        cancelled: list[tuple[str, dict[str, Any]]] = []
        for request_id, details in list(owner._pending_approval_details.items()):
            request_project, request_thread, request_turn = self.approval_identity(details)
            if project_id and request_project != project_id:
                continue
            if thread_id and request_thread != thread_id:
                continue
            if turn_id and request_turn not in (None, turn_id):
                continue
            if runtime_id and details.get("runtimeId") != runtime_id:
                continue
            future = owner._pending_approvals.pop(request_id, None)
            owner._pending_approval_details.pop(request_id, None)
            if future and not future.done():
                future.cancel()
            cancelled.append((request_id, details))

        for request_id, details in cancelled:
            approval = {
                **details.get("data", {}),
                "requestId": request_id,
                "phase": "resolved",
                "decision": "deny",
                "reason": reason,
            }
            await owner.broadcast_ws(
                {
                    "type": "approval",
                    "approval": approval,
                    "projectId": details.get("projectId"),
                    "threadId": details.get("threadId"),
                    "turnId": details.get("turnId"),
                }
            )
        return len(cancelled)

    async def handle_approval_request(
        self,
        req: dict[str, Any],
        project_id: str | None = None,
        thread_id: str | None = None,
        runtime_id: str | None = None,
    ) -> dict[str, Any]:
        """Wait for a UI decision without deciding tool authorization."""
        owner = self._owner
        req_data = dict(req)
        req_id = str(req.get("requestId") or "")
        if not req_id:
            raise ValueError("approval request is missing requestId")
        resolved_project_id = project_id or req_data.get("projectId")
        resolved_thread_id = (
            req_data.get("threadId") or req_data.get("thread_id") or thread_id
        )
        resolved_turn_id = req_data.get("turnId") or req_data.get("turn_id")
        if not resolved_turn_id and resolved_thread_id:
            resolved_turn_id = owner.get_active_turn(
                str(resolved_thread_id), resolved_project_id
            )
        if resolved_project_id:
            req_data["projectId"] = resolved_project_id
        if resolved_thread_id:
            req_data["threadId"] = str(resolved_thread_id)
        if resolved_turn_id:
            req_data["turnId"] = str(resolved_turn_id)
        if self.is_turn_interrupted(
            resolved_thread_id, resolved_turn_id, resolved_project_id
        ):
            logger.info(
                "Denied late approval request %s for interrupted Turn %s",
                req_id,
                resolved_turn_id,
            )
            return {
                "decision": "deny",
                "grantScope": None,
                "reason": "当前 Turn 已停止，审批已失效",
            }
        action_name = str(req.get("actionSummary") or req.get("action") or "")
        logger.info("Approval requested by server: %s", req_data)

        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        owner._pending_approvals[req_id] = future
        owner._pending_approval_details[req_id] = {
            "action_name": action_name,
            "data": req_data,
            "projectId": resolved_project_id,
            "threadId": str(resolved_thread_id) if resolved_thread_id else None,
            "turnId": str(resolved_turn_id) if resolved_turn_id else None,
            "runtimeId": runtime_id,
        }

        payload = {"type": "approval_request", "requestId": req_id, "data": req_data}
        if resolved_project_id:
            payload["projectId"] = resolved_project_id
        if resolved_thread_id:
            payload["threadId"] = str(resolved_thread_id)
        if resolved_turn_id:
            payload["turnId"] = str(resolved_turn_id)
        await owner.broadcast_ws(payload)

        try:
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
            owner._pending_approvals.pop(req_id, None)
            owner._pending_approval_details.pop(req_id, None)

    def resolve_approval(
        self,
        request_id: str,
        decision: str,
        grant_scope: str | None,
        reason: str | None = None,
        project_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
    ) -> bool:
        """Resolve a pending approval after validating its scoped identity."""
        owner = self._owner
        details = owner._pending_approval_details.get(request_id)
        if not details:
            return False
        data = details.get("data", {})
        request_project = details.get("projectId") or data.get("projectId")
        request_thread = details.get("threadId") or data.get("threadId")
        request_turn = details.get("turnId") or data.get("turnId")
        if project_id and project_id != request_project:
            return False
        if thread_id and thread_id != request_thread:
            return False
        if turn_id and turn_id != request_turn:
            return False
        allowed_grant_scopes = data.get("allowedGrantScopes", [])
        if decision.lower() == "approve" and grant_scope not in allowed_grant_scopes:
            logger.warning("Rejected out-of-scope approval response: %s", request_id)
            return False
        if decision.lower() == "deny" and grant_scope is not None:
            return False
        if decision.lower() not in ("approve", "deny"):
            return False

        future = owner._pending_approvals.get(request_id)
        if future and not future.done():
            future.set_result(
                {
                    "decision": decision,
                    "grantScope": grant_scope,
                    "reason": reason or "",
                }
            )
            return True
        return False

    async def broadcast_approval_resolution(
        self,
        request_id: str,
        decision: str,
        grant_scope: str | None,
        reason: str | None = None,
    ) -> bool:
        owner = self._owner
        details = owner._pending_approval_details.get(request_id)
        if not details:
            return False
        data = dict(details.get("data", {}))
        project_id = details.get("projectId") or data.get("projectId")
        thread_id = details.get("threadId") or data.get("threadId")
        turn_id = details.get("turnId") or data.get("turnId")
        approval = {
            **data,
            "requestId": request_id,
            "phase": "resolved",
            "decision": decision,
            "grantScope": grant_scope,
            "reason": reason or "",
        }
        await owner.broadcast_ws(
            {
                "type": "approval",
                "approval": approval,
                "projectId": project_id,
                "threadId": thread_id,
                "turnId": turn_id,
            }
        )
        return True

    def list_pending_approvals(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
    ) -> list[str]:
        owner = self._owner
        return [
            request_id
            for request_id in owner._pending_approvals
            if (
                not project_id
                or owner._pending_approval_details.get(request_id, {}).get("projectId")
                in (None, project_id)
            )
            and (
                not thread_id
                or owner._pending_approval_details.get(request_id, {}).get("threadId")
                == thread_id
            )
        ]

    def approval_snapshot(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """Expose policy and pending requests without exposing grant authority."""
        owner = self._owner
        resolved_project_id = project_id or owner._current_project_id
        access, policy = owner.project_execution(resolved_project_id)
        pending = []
        for request_id, details in owner._pending_approval_details.items():
            if project_id and details.get("projectId") not in (None, resolved_project_id):
                continue
            if thread_id and details.get("threadId") != thread_id:
                continue
            pending.append(
                {
                    "request_id": request_id,
                    "action_name": details.get("action_name", ""),
                    "project_id": details.get("projectId"),
                    "thread_id": details.get("threadId"),
                    "turn_id": details.get("turnId"),
                    "data": details.get("data", {}),
                }
            )
        return {
            "project_id": resolved_project_id,
            "access": access,
            "policy": policy,
            "pending_requests": pending,
            "grant_store": "host-capabilities",
            "revocable": True,
        }

    async def revoke_current_project_approvals(
        self, project_id: str | None = None
    ) -> dict[str, Any]:
        resolved_project_id = project_id or self._owner._current_project_id
        if resolved_project_id != self._owner._current_project_id:
            return {
                "project_id": resolved_project_id,
                "revoked": False,
                "reason": "Only the active project runtime can be restarted from this endpoint",
            }
        await self._owner.restart_for_current_project()
        return {"project_id": resolved_project_id, "revoked": True}
