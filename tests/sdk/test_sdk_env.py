"""Environment discovery contract for the Python SDK."""

from __future__ import annotations

from pathlib import Path

from mini_agent.client import _env_search_dirs


def test_sdk_searches_web_workspace_before_user_config() -> None:
    search_dirs = [
        Path(directory).resolve()
        for directory in _env_search_dirs("D:/external/project")
    ]
    web_workspace = Path(__file__).resolve().parents[2]
    user_config = Path.home() / ".mini-agent"

    assert web_workspace in search_dirs
    assert search_dirs.index(web_workspace) < search_dirs.index(user_config)
