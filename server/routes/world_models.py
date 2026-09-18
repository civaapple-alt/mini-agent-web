"""Request models shared by the World route family."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SetExecutionRequest(BaseModel):
    access: Literal["project", "full_machine"] = Field(
        default="project", description="Project-scoped or machine-wide access"
    )
    policy: Literal["interactive", "automatic", "trusted"] = Field(
        default="interactive",
        description="Interactive approval, bounded automation, or trusted workspace execution",
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class UpdateThreadSettingsRequest(BaseModel):
    mode: Literal["default", "plan"] = Field(
        ..., description="Thread collaboration mode: default or plan"
    )
    builtin_tools: list[str] | None = Field(
        default=None,
        description="Optional bounded Builtin tool selection for this Thread",
    )
    continuation_mode: Literal["manual", "continuous"] | None = Field(
        default=None,
        description="Bounded one-turn execution or explicit continuous execution",
    )


class SetGoalRequest(BaseModel):
    objective: str = Field(
        ..., min_length=1, max_length=4096, description="Bounded Thread Goal objective"
    )
    status: (
        Literal[
            "active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"
        ]
        | None
    ) = Field(default=None, description="Optional Goal status")
    token_budget: int | None = Field(
        default=None, ge=1, description="Optional total token budget"
    )


class CreateProjectRequest(BaseModel):
    name: str = Field(..., description="Project folder name or identifier")
    path: str | None = Field(default=None, description="Optional custom directory path")
    source_folders: list[dict[str, Any]] | None = Field(
        default=None, description="List of source folders with is_primary flag"
    )
    init_readme: bool = Field(
        default=True, description="Create initial README.md and AGENTS.md"
    )


class UpdateProjectRequest(BaseModel):
    name: str | None = Field(default=None, description="Updated project display name")
    pinned: bool | None = Field(default=None, description="Pinned status")
    source_folders: list[dict[str, Any]] | None = Field(
        default=None, description="List of source folders with is_primary flag"
    )
    access: Literal["project", "full_machine"] | None = Field(
        default=None, description="Project access scope"
    )
    policy: Literal["interactive", "automatic", "trusted"] | None = Field(
        default=None, description="Project execution policy"
    )
    builtin_skill_groups: list[str] | None = Field(
        default=None,
        max_length=8,
        description="Enabled built-in Skill groups for this project",
    )
    subagent: dict[str, Any] | None = Field(
        default=None,
        description="Child Session concurrency and execution mode",
    )


class SwitchProjectRequest(BaseModel):
    path: str = Field(..., description="Target directory path")
