"""Check Web release versions and its editable Harness SDK source."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SDK_SOURCE = "../mini-agent-harness/sdk/python"


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


def lock_package_section(lock_text: str, package_name: str) -> str:
    return capture(
        f"{package_name} package in uv.lock",
        lock_text,
        rf'^\[\[package\]\]\s*\nname = "{re.escape(package_name)}"\s*\n(.*?)(?=^\[\[package\]\]|\Z)',
    )


def get_versions() -> dict[str, str]:
    versions = {
        "pyproject.toml": project_version("pyproject.toml"),
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

    lock_text = read_text("uv.lock")
    web_package = lock_package_section(lock_text, "mini-agent-web")
    sdk_package = lock_package_section(lock_text, "mini-agent")
    versions["uv.lock (mini-agent-web)"] = capture(
        "mini-agent-web locked version", web_package, r'^version = "([^\"]+)"'
    )

    versions["README.md"] = capture(
        "current release in README.md",
        read_text("README.md"),
        r"当前发布版本为 `([^`]+)`",
    )

    uv_sources = capture(
        "tool.uv.sources section",
        read_text("pyproject.toml"),
        r"^\[tool\.uv\.sources\]\s*(.*?)(?=^\[|\Z)",
    )
    sdk_path = capture(
        "mini-agent source path in pyproject.toml",
        uv_sources,
        r'^mini-agent\s*=\s*\{\s*path\s*=\s*"([^\"]+)"',
    )
    if sdk_path != SDK_SOURCE:
        raise ValueError(
            f"mini-agent must use the sibling Harness SDK path {SDK_SOURCE!r}"
        )

    lock_sdk_path = capture(
        "mini-agent editable source path in uv.lock",
        sdk_package,
        r'^source = \{ editable = "([^\"]+)" \}',
    )
    lock_sdk_version = capture(
        "mini-agent locked version", sdk_package, r'^version = "([^\"]+)"'
    )
    if sdk_path != lock_sdk_path:
        raise ValueError(
            "The SDK source path in pyproject.toml and uv.lock does not match"
        )

    sdk_project_path = (ROOT / sdk_path / "pyproject.toml").resolve()
    sdk_project = sdk_project_path.read_text(encoding="utf-8")
    sdk_project_section = capture(
        "[project] section in sibling Harness SDK pyproject.toml",
        sdk_project,
        r"^\[project\]\s*(.*?)(?=^\[|\Z)",
    )
    sdk_name = capture(
        "sibling SDK project name",
        sdk_project_section,
        r'^name\s*=\s*"([^\"]+)"',
    )
    sdk_version = capture(
        "sibling SDK project version",
        sdk_project_section,
        r'^version\s*=\s*"([^\"]+)"',
    )
    if sdk_name != "mini-agent" or lock_sdk_version != sdk_version:
        raise ValueError(
            "The sibling Harness SDK project name or version does not match uv.lock"
        )
    versions["Harness SDK (editable sibling source)"] = sdk_version
    return versions


def main() -> int:
    try:
        versions = get_versions()
    except (KeyError, ValueError, OSError, json.JSONDecodeError) as err:
        print(f"[ERROR] Failed to extract versions: {err}", file=sys.stderr)
        return 1

    web_targets = {
        target: version
        for target, version in versions.items()
        if target != "Harness SDK (editable sibling source)"
    }
    if len(set(web_targets.values())) != 1:
        print(
            f"[ERROR] Web release version drift across {len(web_targets)} targets:",
            file=sys.stderr,
        )
        for target, version in web_targets.items():
            print(f"  - {target}: {version}", file=sys.stderr)
        return 1

    matched_version = next(iter(web_targets.values()))
    print(
        f"[OK] Web release targets are synchronized at {matched_version}; "
        f"Harness SDK {versions['Harness SDK (editable sibling source)']} "
        f"is linked from {SDK_SOURCE}"
    )
    for target, version in versions.items():
        print(f"  [+] {target} == {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
