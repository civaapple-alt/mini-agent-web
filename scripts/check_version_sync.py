#!/usr/bin/env python3
"""
Check version synchronization across all package targets in mini-agent-web.

Validates that the 6 canonical version declarations match exactly:
1. Root pyproject.toml
2. SDK pyproject.toml (sdk/python/pyproject.toml)
3. Python SDK __init__.py (sdk/python/src/mini_agent/__init__.py)
4. Gateway FastAPI App (server/app.py)
5. Web Studio package.json (frontend/package.json)
6. Web Studio package-lock.json (frontend/package-lock.json)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def get_versions() -> dict[str, str]:
    versions: dict[str, str] = {}

    # 1. Root pyproject.toml
    root_toml = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    m_root = re.search(r'version\s*=\s*"([^"]+)"', root_toml)
    if not m_root:
        raise ValueError("Could not find version in pyproject.toml")
    versions["pyproject.toml"] = m_root.group(1)

    # 2. SDK pyproject.toml
    sdk_toml = (ROOT / "sdk" / "python" / "pyproject.toml").read_text(encoding="utf-8")
    m_sdk_toml = re.search(r'version\s*=\s*"([^"]+)"', sdk_toml)
    if not m_sdk_toml:
        raise ValueError("Could not find version in sdk/python/pyproject.toml")
    versions["sdk/python/pyproject.toml"] = m_sdk_toml.group(1)

    # 3. SDK __init__.py
    sdk_init = (
        ROOT / "sdk" / "python" / "src" / "mini_agent" / "__init__.py"
    ).read_text(encoding="utf-8")
    m_sdk_init = re.search(r'__version__\s*=\s*"([^"]+)"', sdk_init)
    if not m_sdk_init:
        raise ValueError(
            "Could not find __version__ in sdk/python/src/mini_agent/__init__.py"
        )
    versions["sdk/python/src/mini_agent/__init__.py"] = m_sdk_init.group(1)

    # 4. server/app.py
    server_app = (ROOT / "server" / "app.py").read_text(encoding="utf-8")
    m_server = re.search(r'version\s*=\s*"([^"]+)"', server_app)
    if not m_server:
        raise ValueError("Could not find version in server/app.py")
    versions["server/app.py"] = m_server.group(1)

    # 5. frontend/package.json
    frontend_pkg = json.loads(
        (ROOT / "frontend" / "package.json").read_text(encoding="utf-8")
    )
    if "version" not in frontend_pkg:
        raise ValueError("Could not find version in frontend/package.json")
    versions["frontend/package.json"] = frontend_pkg["version"]

    # 6. frontend/package-lock.json
    frontend_lock = json.loads(
        (ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8")
    )
    if "version" not in frontend_lock:
        raise ValueError("Could not find version in frontend/package-lock.json")
    versions["frontend/package-lock.json"] = frontend_lock["version"]

    return versions


def main() -> int:
    try:
        versions = get_versions()
    except (ValueError, OSError, json.JSONDecodeError) as err:
        print(f"[ERROR] Failed to extract versions: {err}", file=sys.stderr)
        return 1

    distinct = set(versions.values())
    if len(distinct) != 1:
        print(
            f"[ERROR] Version drift detected! Expected all targets to match, found {len(distinct)} distinct versions:",
            file=sys.stderr,
        )
        for target, ver in versions.items():
            print(f"  - {target}: {ver}", file=sys.stderr)
        return 1

    matched_version = distinct.pop()
    print(f"[OK] All 6 targets are cleanly synchronized at version: {matched_version}")
    for target, ver in versions.items():
        print(f"  [+] {target} == {ver}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
