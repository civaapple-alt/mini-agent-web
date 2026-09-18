"""Synchronize WebStudio-shipped built-in Skill groups into the user root."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

GROUP_METADATA_NAME = ".mini-agent-group.json"
MARKER_NAME = ".mini-agent-builtin.json"


def _resource_root() -> Path:
    return Path(__file__).resolve().parents[1] / "resources" / "builtin-skills"


def _target_root() -> Path:
    return Path.home() / ".mini-agent" / "skills" / "builtin"


def _resource_group(group_id: str) -> Path:
    return _resource_root() / group_id


def _target_group(group_id: str) -> Path:
    return _target_root() / group_id


def _group_specs() -> list[dict[str, Any]]:
    root = _resource_root()
    if not root.is_dir():
        raise RuntimeError(f"bundled Skill root is missing: {root}")

    specs: list[dict[str, Any]] = []
    for source in sorted(path for path in root.iterdir() if path.is_dir()):
        metadata_path = source / GROUP_METADATA_NAME
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except FileNotFoundError as err:
            raise RuntimeError(f"builtin Skill group metadata is missing: {metadata_path}") from err
        except (OSError, ValueError) as err:
            raise RuntimeError(f"builtin Skill group metadata is invalid: {metadata_path}") from err

        group_id = metadata.get("id")
        version = metadata.get("version")
        if group_id != source.name or not isinstance(version, str) or not version.strip():
            raise RuntimeError(f"builtin Skill group metadata does not match {source}")
        specs.append(
            {
                "id": group_id,
                "version": version,
                "source_commit": metadata.get("source_commit"),
            }
        )
    return specs


def builtin_skill_group_specs() -> list[dict[str, Any]]:
    """Return the bounded metadata for groups shipped with WebStudio."""
    return [spec.copy() for spec in _group_specs()]


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


def _marker_matches(target: Path, spec: dict[str, Any], source_hash: str) -> bool:
    marker = target / MARKER_NAME
    if not target.is_dir() or not marker.is_file():
        return False
    try:
        value = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return all(
        value.get(key) == expected
        for key, expected in {
            "group": spec["id"],
            "version": spec["version"],
            "source_hash": source_hash,
            "source_commit": spec.get("source_commit"),
        }.items()
    )


def sync_builtin_skills() -> dict[str, Any]:
    """Install every bundled Skill group with independent atomic swaps."""
    results = [_sync_group(spec) for spec in _group_specs()]
    return {
        "groups": results,
        "changed": any(result["changed"] for result in results),
    }


def _sync_group(spec: dict[str, Any]) -> dict[str, Any]:
    group_id = spec["id"]
    source = _resource_group(group_id)
    if not source.is_dir():
        raise RuntimeError(f"bundled skill group is missing: {source}")
    source_hash = _source_hash(source)
    target = _target_group(group_id)
    if _marker_matches(target, spec, source_hash):
        return {
            "group": group_id,
            "version": spec["version"],
            "source_commit": spec.get("source_commit"),
            "changed": False,
        }

    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{group_id}.staging-", dir=target.parent))
    backup: Path | None = None
    installed = False
    try:
        shutil.rmtree(staging)
        shutil.copytree(source, staging)
        (staging / MARKER_NAME).write_text(
            json.dumps(
                {
                    "group": group_id,
                    "version": spec["version"],
                    "source_hash": source_hash,
                    "source_commit": spec.get("source_commit"),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if target.exists():
            backup = target.parent / f".{group_id}.previous-{os.getpid()}"
            if backup.exists():
                shutil.rmtree(backup)
            os.replace(target, backup)
        os.replace(staging, target)
        installed = True
        return {
            "group": group_id,
            "version": spec["version"],
            "source_commit": spec.get("source_commit"),
            "changed": True,
        }
    except Exception:
        if not target.exists() and backup is not None and backup.exists():
            os.replace(backup, target)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        if installed and backup is not None and backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
