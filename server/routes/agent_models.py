"""Request models shared by Agent routes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_TEXT_ATTACHMENT_BYTES = 128 * 1024
MAX_TEXT_ATTACHMENTS = 4


class SkillGroupWorkflow(BaseModel):
    kind: Literal["skill_group"]
    id: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    mode: Literal["auto"] = "auto"


class TextAttachment(BaseModel):
    """A bounded text payload that the Gateway stores as a session attachment."""

    name: str = Field(default="pasted-text.txt", min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=MAX_TEXT_ATTACHMENT_BYTES)


class StartTurnRequest(BaseModel):
    prompt: str = Field(..., description="Prompt or instruction for the agent")
    mode: str = Field(default="start", description="Input mode: start or start_if_idle")
    thread_id: str | None = Field(default=None, description="Target thread ID")
    images: list[str] | None = Field(
        default=None, description="Optional Base64 data URLs for attached images"
    )
    referenced_files: list[str] | None = Field(
        default=None, description="Optional relative file paths referenced in prompt"
    )
    text_attachments: list[TextAttachment] = Field(
        default_factory=list,
        max_length=MAX_TEXT_ATTACHMENTS,
        description="Optional bounded text attachments from the composer",
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )
    selected_skills: list[str] = Field(
        default_factory=list,
        max_length=8,
        description="Explicit Skill names to activate for this turn",
    )
    workflow: SkillGroupWorkflow | None = Field(
        default=None,
        description="Optional turn-level workflow activation",
    )


class SteerTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to steer")
    text: str = Field(..., description="Corrective steering instruction")
    text_attachments: list[TextAttachment] = Field(
        default_factory=list,
        max_length=MAX_TEXT_ATTACHMENTS,
        description="Optional bounded text attachments from the composer",
    )
    thread_id: str | None = Field(default=None, description="Target thread ID")
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class InterruptTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to interrupt/cancel")
    thread_id: str | None = Field(default=None, description="Target thread ID")
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class ApprovalResponseRequest(BaseModel):
    request_id: str = Field(
        ..., description="Approval request ID returned by approval_request event"
    )
    decision: Literal["approve", "deny"] = Field(
        ..., description="Decision: approve or deny"
    )
    grant_scope: Literal["once", "session", "project"] | None = Field(
        ..., description="Requested lifetime for the Host-owned action grant"
    )
    reason: str | None = Field(
        default=None, description="Optional explanation or restriction"
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )
    thread_id: str | None = Field(default=None, description="Target Thread ID")
    turn_id: str | None = Field(default=None, description="Target active Turn ID")
    call_id: str | None = Field(
        default=None,
        description="Stable tool call ID for duplicate request-id disambiguation",
    )
