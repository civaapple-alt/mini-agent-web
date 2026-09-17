"""Synchronize WebStudio-shipped built-in skills into Mini Agent's user root."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

BUILTIN_VERSION = "0.2.0"
GROUP_NAME = "pstack"
MARKER_NAME = ".mini-agent-builtin.json"


def _resource_group() -> Path:
    return Path(__file__).resolve().parents[1] / "resources" / "builtin-skills" / GROUP_NAME


def _target_group() -> Path:
    return Path.home() / ".mini-agent" / "skills" / "builtin" / GROUP_NAME


def _source_hash(source: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _marker_matches(target: Path, source_hash: str) -> bool:
    marker = target / MARKER_NAME
    if not target.is_dir() or not marker.is_file():
        return False
    try:
        value = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (
        value.get("group") == GROUP_NAME
        and value.get("version") == BUILTIN_VERSION
        and value.get("source_hash") == source_hash
    )


def sync_builtin_skills() -> dict[str, Any]:
    """Install the bundled pstack group with staging and an atomic directory swap."""
    source = _resource_group()
    if not source.is_dir():
        raise RuntimeError(f"bundled skill group is missing: {source}")
    source_hash = _source_hash(source)
    target = _target_group()
    if _marker_matches(target, source_hash):
        return {"group": GROUP_NAME, "version": BUILTIN_VERSION, "changed": False}

    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{GROUP_NAME}.staging-", dir=target.parent))
    backup: Path | None = None
    installed = False
    try:
        shutil.rmtree(staging)
        shutil.copytree(source, staging)
        (staging / MARKER_NAME).write_text(
            json.dumps(
                {
                    "group": GROUP_NAME,
                    "version": BUILTIN_VERSION,
                    "source_hash": source_hash,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if target.exists():
            backup = target.parent / f".{GROUP_NAME}.previous-{os.getpid()}"
            if backup.exists():
                shutil.rmtree(backup)
            os.replace(target, backup)
        os.replace(staging, target)
        installed = True
        return {"group": GROUP_NAME, "version": BUILTIN_VERSION, "changed": True}
    except Exception:
        if not target.exists() and backup is not None and backup.exists():
            os.replace(backup, target)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        if installed and backup is not None and backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
