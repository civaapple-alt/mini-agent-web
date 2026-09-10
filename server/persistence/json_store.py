"""Small, dependency-free JSON persistence primitives.

The Gateway keeps these helpers separate from SessionManager so storage
semantics remain reusable without making persistence a second source of
session or authorization state.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any


def atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON data to ``path`` through a same-directory temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    try:
        tmp_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp_path.replace(path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def to_json_serializable(obj: Any) -> Any:
    """Recursively convert dataclasses and objects into JSON-safe dictionaries."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return {
            key: to_json_serializable(value)
            for key, value in asdict(obj).items()
            if not key.startswith("_")
        }
    if isinstance(obj, dict):
        return {
            key: to_json_serializable(value)
            for key, value in obj.items()
            if key
            not in (
                "typed_event",
                "typed_items",
                "typed_item_notification",
                "submission",
            )
        }
    if isinstance(obj, (list, tuple)):
        return [to_json_serializable(value) for value in obj]
    return obj
