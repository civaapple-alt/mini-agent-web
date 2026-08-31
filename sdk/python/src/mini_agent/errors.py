"""
Custom Exceptions for the Mini Agent Python SDK.
"""

from __future__ import annotations

from typing import Any


class MiniAgentError(Exception):
    """Base exception for all Mini Agent SDK errors."""


class AppServerError(MiniAgentError):
    """Raised when the App Server returns a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(f"[{code}] {message} (data={data})")
        self.code = code
        self.message = message
        self.data = data


class ProtocolVersionMismatchError(MiniAgentError):
    """Raised when the App Server protocol version does not match expected version."""


class ServerProcessError(MiniAgentError):
    """Raised when the App Server subprocess fails to spawn or crashes unexpectedly."""


class TurnTimeoutError(MiniAgentError):
    """Raised when a turn execution exceeds the configured timeout."""
