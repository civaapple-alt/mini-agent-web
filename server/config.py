"""
Server configuration and environment settings.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ServerSettings:
    """Configuration settings for Mini Agent Web API Gateway."""

    host: str = field(default_factory=lambda: os.getenv("MINI_AGENT_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("MINI_AGENT_PORT", "8000")))
    cors_origins: list[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv("MINI_AGENT_CORS_ORIGINS", "*").split(",")
            if origin.strip()
        ]
    )
    profile: str = field(
        default_factory=lambda: os.getenv("MINI_AGENT_PROFILE", "interactive")
    )
    log_dir: str = field(
        default_factory=lambda: os.getenv("MINI_AGENT_LOG_DIR", "logs")
    )
    static_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "web"
    )


settings = ServerSettings()
