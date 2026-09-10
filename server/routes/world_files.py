"""Workflow artifact, Git, and workspace file inspection routes."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])

@router.get("/workflows/files", summary="List workflow and plan files")
async def list_workflow_files(
    thread_id: str | None = None,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Scan workspace for plan/goal files like plan.md, goal/plan.md, etc."""
    cwd = (
        session_manager.project_path_for_thread(thread_id, project_id)
        if project_id
        else session_manager.project_path_for_thread(thread_id)
    )
    candidate_paths: list[tuple[str, Path]] = [
        ("plan.md", cwd / "plan.md"),
        ("goal/plan.md", cwd / "goal" / "plan.md"),
        ("goal/verifier_verdict.md", cwd / "goal" / "verifier_verdict.md"),
        ("goal/state.json", cwd / "goal" / "state.json"),
        ("goal/milestones.json", cwd / "goal" / "milestones.json"),
        ("AGENTS.md", cwd / "AGENTS.md"),
        ("README.md", cwd / "README.md"),
    ]
    if thread_id:
        session_dir = (
            session_manager.session_path_for_thread(thread_id, project_id)
            if project_id
            else session_manager.session_path_for_thread(thread_id)
        )
        if session_dir:
            candidate_paths = [
                ("plan/plan.md", session_dir / "plan" / "plan.md"),
                ("goal/plan.md", session_dir / "goal" / "plan.md"),
                (
                    "goal/verifier_verdict.md",
                    session_dir / "goal" / "verifier_verdict.md",
                ),
                ("goal/state.json", session_dir / "goal" / "state.json"),
            ] + candidate_paths
    discovered = []
    seen_paths: set[str] = set()
    for rel, p in candidate_paths:
        if rel in seen_paths:
            continue
        seen_paths.add(rel)
        if p.is_file():
            discovered.append(
                {
                    "path": rel,
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                }
            )

    return {"files": discovered, "workspace": str(cwd)}


@router.get("/workflows/file/content", summary="Read workflow file content")
async def read_workflow_file_content(
    path: str = Query(..., description="Relative file path"),
    thread_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Read full text content of a workflow/plan file."""
    normalized_path = path.replace("\\", "/")
    cwd = (
        session_manager.project_path_for_thread(thread_id, project_id)
        if project_id
        else session_manager.project_path_for_thread(thread_id)
    ).resolve()
    root = cwd
    if thread_id and normalized_path in {
        "plan/plan.md",
        "goal/plan.md",
        "goal/verifier_verdict.md",
        "goal/state.json",
    }:
        session_dir = (
            session_manager.session_path_for_thread(thread_id, project_id)
            if project_id
            else session_manager.session_path_for_thread(thread_id)
        )
        if session_dir:
            root = session_dir.resolve()
    target = (root / normalized_path).resolve()
    if not target.is_relative_to(root):
        raise HTTPException(status_code=403, detail="File path is outside workspace")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        return {"path": normalized_path, "content": content, "size": len(content)}
    except Exception as err:
        raise HTTPException(
            status_code=500, detail=f"Failed to read file: {err}"
        ) from err


# -----------------------------------------------------------------------------
# Git & Workspace Files Inspection
# -----------------------------------------------------------------------------


def _get_git_status_sync(project_id: str | None = None) -> dict[str, Any]:
    cwd = str(session_manager.project_path_for_thread(project_id=project_id))
    try:
        branch_proc = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        branch = branch_proc.stdout.strip() or "main"

        status_proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        lines = [
            line.strip() for line in status_proc.stdout.splitlines() if line.strip()
        ]

        modified = []
        untracked = []
        for line in lines:
            if line.startswith("??"):
                untracked.append(line[3:])
            else:
                modified.append(line)

        return {
            "branch": branch,
            "dirty": len(lines) > 0,
            "modified": modified,
            "untracked": untracked,
            "total_changes": len(lines),
            "workspace": cwd,
        }
    except Exception as err:  # noqa: BLE001
        return {
            "branch": "unknown",
            "dirty": False,
            "modified": [],
            "untracked": [],
            "error": str(err),
            "workspace": cwd,
        }


@router.get("/world/git/status", summary="Get git status and branch")
async def get_git_status(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Retrieve Git repository status, current branch, and changed files."""
    return await asyncio.to_thread(_get_git_status_sync, project_id)


@router.get(
    "/world/workspace-files", summary="List files in workspace for autocomplete"
)
async def list_workspace_files(
    query: str = Query("", description="Optional search filter"),
    limit: int = Query(80, description="Max files to return"),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Fast list of workspace relative file paths for @-mention autocomplete."""
    cwd = session_manager.project_path_for_thread(project_id=project_id).resolve()
    ignore_dirs = {
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        ".pytest_cache",
        ".ruff_cache",
        "dist",
        "build",
        "target",
        ".gemini",
        ".mini-agent",
    }

    q = query.lower().strip()

    def _scan_sync() -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []

        def _scan_dir(base_dir: Path, prefix: str = "", depth: int = 0) -> None:
            if depth > 7 or not base_dir.is_dir():
                return
            try:
                for entry in base_dir.iterdir():
                    if entry.name in ignore_dirs or (
                        entry.name.startswith(".") and entry.name != ".env.example"
                    ):
                        continue
                    rel_path = f"{prefix}/{entry.name}" if prefix else entry.name
                    if entry.is_dir():
                        _scan_dir(entry, rel_path, depth + 1)
                    elif entry.is_file() and (
                        not q or q in rel_path.lower() or q in entry.name.lower()
                    ):
                        results.append(
                            {
                                "name": entry.name,
                                "path": rel_path,
                                "abs_path": str(entry.resolve()),
                            }
                        )
                        if len(results) >= limit:
                            return
            except Exception:  # noqa: BLE001, S110
                pass

        _scan_dir(cwd)
        return results[:limit]

    files = await asyncio.to_thread(_scan_sync)
    return {"files": files, "workspace": str(cwd)}
