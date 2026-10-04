"""Check release versions across the mini-agent-web workspace."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def capture(label: str, source: str, pattern: str) -> str:
    match = re.search(pattern, source, re.MULTILINE | re.DOTALL)
    if not match:
        raise ValueError(f"Could not find {label}")
    return match.group(1)


def project_version(relative_path: str) -> str:
    source = read_text(relative_path)
    section = capture(
        f"[project] section in {relative_path}",
        source,
        r"^\[project\]\s*(.*?)(?=^\[|\Z)",
    )
    return capture(
        f"project.version in {relative_path}",
        section,
        r'^version\s*=\s*"([^\"]+)"',
    )


def lock_package_version(lock_text: str, package_name: str) -> str:
    return capture(
        f"{package_name} package version in uv.lock",
        lock_text,
        rf'^\[\[package\]\]\s*\nname = "{re.escape(package_name)}"\s*\nversion = "([^\"]+)"',
    )


def get_versions() -> dict[str, str]:
    versions = {
        "pyproject.toml": project_version("pyproject.toml"),
        "sdk/python/pyproject.toml": project_version("sdk/python/pyproject.toml"),
        "sdk/python/src/mini_agent/__init__.py": capture(
            "SDK __version__",
            read_text("sdk/python/src/mini_agent/__init__.py"),
            r'^__version__\s*=\s*"([^\"]+)"',
        ),
        "sdk/python/src/mini_agent/client.py (_client_version)": capture(
            "SDK client version",
            read_text("sdk/python/src/mini_agent/client.py"),
            r'^\s*self\._client_version\s*=\s*"([^\"]+)"',
        ),
        "sdk/python/src/mini_agent/client.py (client_version default)": capture(
            "SDK initialize client_version default",
            read_text("sdk/python/src/mini_agent/client.py"),
            r'^\s*client_version:\s*str\s*=\s*"([^\"]+)"',
        ),
        "server/__init__.py": capture(
            "server __version__",
            read_text("server/__init__.py"),
            r'^__version__\s*=\s*"([^\"]+)"',
        ),
        "server/app.py (FastAPI metadata)": capture(
            "FastAPI version",
            read_text("server/app.py"),
            r'^\s*version\s*=\s*"([^\"]+)"',
        ),
        "server/app.py (/health)": capture(
            "health response version",
            read_text("server/app.py"),
            r'^\s*"version"\s*:\s*"([^\"]+)"',
        ),
    }

    frontend_package = json.loads(read_text("frontend/package.json"))
    frontend_lock = json.loads(read_text("frontend/package-lock.json"))
    versions["frontend/package.json"] = frontend_package["version"]
    versions["frontend/package-lock.json"] = frontend_lock["version"]
    versions['frontend/package-lock.json (packages[""])'] = frontend_lock["packages"][
        ""
    ]["version"]

    uv_lock = read_text("uv.lock")
    versions["uv.lock (mini-agent)"] = lock_package_version(uv_lock, "mini-agent")
    versions["uv.lock (mini-agent-web)"] = lock_package_version(
        uv_lock, "mini-agent-web"
    )

    versions["README.md"] = capture(
        "current release in README.md",
        read_text("README.md"),
        r"当前发布版本为 `([^`]+)`",
    )
    return versions


def main() -> int:
    try:
        versions = get_versions()
    except (KeyError, ValueError, OSError, json.JSONDecodeError) as err:
        print(f"[ERROR] Failed to extract versions: {err}", file=sys.stderr)
        return 1

    distinct = set(versions.values())
    if len(distinct) != 1:
        print(
            f"[ERROR] Version drift detected across {len(versions)} targets:",
            file=sys.stderr,
        )
        for target, version in versions.items():
            print(f"  - {target}: {version}", file=sys.stderr)
        return 1

    matched_version = distinct.pop()
    print(f"[OK] All {len(versions)} targets are synchronized at {matched_version}")
    for target, version in versions.items():
        print(f"  [+] {target} == {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
