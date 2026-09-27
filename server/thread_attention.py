"""Pure classification of Session states that merit a sidebar indicator."""

from __future__ import annotations

from typing import Any


def thread_attention_reasons(
    thread: dict[str, Any],
    *,
    pending_approval: bool = False,
    child_reasons: list[str] | None = None,
) -> list[str]:
    """Return bounded, display-independent reasons for one Session row."""
    reasons: list[str] = []

    def add(reason: str) -> None:
        if reason not in reasons:
            reasons.append(reason)

    if pending_approval:
        add("pending_approval")
    if thread.get("last_turn_status") == "in_progress" and not thread.get(
        "turn_active"
    ):
        add("execution_recovery")
    if thread.get("last_turn_status") in {"failed", "step_limit"} or thread.get(
        "last_turn_error"
    ):
        add("turn_failed")
    if thread.get("plan_review_pending"):
        add("plan_review_pending")
    if thread.get("cleanup_pending"):
        add("cleanup_pending")

    for reason in child_reasons or []:
        if reason in {
            "child_pending_approval",
            "child_task_failed",
            "child_report",
            "child_recovery",
        }:
            add(reason)
    return reasons
