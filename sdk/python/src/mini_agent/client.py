"""
Mini Agent Python Client SDK
Asynchronous JSON-RPC 2.0 Client over stdio transport.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Any, Self

from mini_agent.errors import (
    AppServerError,
    ProtocolVersionMismatchError,
    ServerProcessError,
)
from mini_agent.events import parse_event
from mini_agent.types import ThreadCheckpoint, TurnReadResult, TurnSubmissionResult

logger = logging.getLogger("mini_agent")


def setup_logging(
    log_dir: str | None = "logs",
    log_file: str | None = None,
    level: int | str = logging.DEBUG,
    console: bool = False,
    format_str: str | None = None,
    mode: str = "a",
) -> logging.FileHandler | None:
    """
    Configure detailed file (and optional console) logging for mini-agent.

    :param log_dir: Target directory for log files (default: 'logs').
    :param log_file: Specific log filename (default: '{log_dir}/mini-agent.log').
    :param level: Logging level (default: logging.DEBUG).
    :param console: Whether to also attach a console stream handler.
    :param format_str: Custom logging format string.
    :param mode: File open mode ('a' for append, 'w' for overwrite/refresh on start).
    :return: The FileHandler instance, or None if no file target specified.
    """
    if isinstance(level, str):
        level = getattr(logging, level.upper(), logging.DEBUG)

    target_file: str | None = None
    if log_file:
        target_file = log_file
        target_dir = os.path.dirname(target_file)
        if target_dir:
            os.makedirs(target_dir, exist_ok=True)
    elif log_dir:
        os.makedirs(log_dir, exist_ok=True)
        # Automatically derive script-specific log name (e.g. 01_basic_turn.log)
        script_name = "mini-agent"
        if sys.argv and sys.argv[0]:
            base = os.path.basename(sys.argv[0])
            name, _ = os.path.splitext(base)
            if name and name not in ("-c", "<stdin>", "__main__", "pytest", "python"):
                script_name = name
        target_file = os.path.join(log_dir, f"{script_name}.log")

    fmt = format_str or "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
    formatter = logging.Formatter(fmt)

    # Configure the mini_agent logger level
    logger.setLevel(level)

    handler = None
    if target_file:
        abs_target = os.path.abspath(target_file)
        for h in list(logger.handlers):
            if isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == abs_target:
                if mode == "w":
                    logger.removeHandler(h)
                    h.close()
                else:
                    handler = h
                break
        if handler is None:
            handler = logging.FileHandler(target_file, mode=mode, encoding="utf-8")
            handler.setLevel(level)
            handler.setFormatter(formatter)
            logger.addHandler(handler)

    if console:
        has_console = any(
            isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
            for h in logger.handlers
        )
        if not has_console:
            ch = logging.StreamHandler(sys.stderr)
            ch.setLevel(level)
            ch.setFormatter(formatter)
            logger.addHandler(ch)

    return handler


def _ensure_utf8_console() -> None:
    """Safely configure stdout/stderr for UTF-8 on Windows consoles."""
    if sys.platform == "win32":
        for stream_name in ("stdout", "stderr"):
            stream = getattr(sys, stream_name, None)
            if stream is not None and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8")
                except OSError:
                    pass


def _find_and_load_env(cwd: str) -> dict[str, str]:
    """Lightweight built-in .env parser without external dependencies."""
    env_vars: dict[str, str] = {}
    search_dirs = [
        cwd,
        os.path.dirname(cwd),
        os.path.dirname(os.path.abspath(__file__)),
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        os.path.expanduser("~/.mini-agent"),
    ]
    for d in search_dirs:
        env_path = os.path.join(d, ".env")
        if os.path.isfile(env_path):
            try:
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in env_vars:
                            env_vars[k] = v
            except OSError:
                pass
    return env_vars


class MiniAgentClient:
    """Asynchronous Client for mini-agent-app-server."""

    def __init__(
        self,
        executable: str = "mini-agent-app-server",
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        approval_handler: Callable[[str, str], Coroutine[Any, Any, bool]] | None = None,
        log_dir: str | None = None,
        log_file: str | None = None,
        log_level: str | int | None = None,
        log_mode: str | None = None,
    ):
        """
        Initialize the MiniAgentClient.

        :param executable: Path or command name for mini-agent-app-server binary.
        :param cwd: Working directory for the server process (defaults to current directory).
        :param env: Additional environment variables.
        :param approval_handler: Async callback `async def handler(request_id: str, action: str) -> bool`
                                 for handling sensitive tool approvals. Defaults to auto-approve.
        :param log_dir: Target directory for execution logs (e.g. 'logs').
        :param log_file: Specific log file path (e.g. 'logs/01_basic_turn.log').
        :param log_level: Logging level ('DEBUG', 'INFO', logging.DEBUG, etc.).
        :param log_mode: Log file open mode ('a' for append, 'w' for overwrite/fresh log).
        """
        _ensure_utf8_console()
        self.executable = executable
        self.cwd = cwd or os.getcwd()
        file_env = _find_and_load_env(self.cwd)
        # Priority: explicit env arg > process os.environ > .env file
        self.env = {**file_env, **os.environ, **(env or {})}
        self.approval_handler = approval_handler or self._default_auto_approve

        # Configure file logging if log_dir, log_file or env specified
        eff_dir = log_dir or self.env.get("MINI_AGENT_LOG_DIR")
        eff_file = log_file or self.env.get("MINI_AGENT_LOG_FILE")
        eff_level = log_level or self.env.get("MINI_AGENT_LOG_LEVEL", "DEBUG")
        eff_mode = log_mode or self.env.get("MINI_AGENT_LOG_MODE", "a")
        if eff_dir or eff_file:
            setup_logging(
                log_dir=eff_dir,
                log_file=eff_file,
                level=eff_level,
                mode=eff_mode,
            )

        self._proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._next_id: int = 1
        self._pending_requests: dict[int, asyncio.Future[Any]] = {}
        self._event_queues: list[asyncio.Queue[dict[str, Any]]] = []
        self._active_thread_id: str = "default"

    async def __aenter__(self) -> Self:
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        await self.stop()

    async def start(self) -> None:
        """Start the mini-agent-app-server subprocess and reader loop."""
        exe_path = shutil.which(self.executable, path=self.env.get("PATH"))
        if not exe_path:
            exe_path = self.executable

        try:
            self._proc = await asyncio.create_subprocess_exec(
                exe_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.cwd,
                env=self.env,
            )
        except OSError as err:
            raise ServerProcessError(
                f"Failed to spawn mini-agent-app-server executable '{exe_path}': {err}"
            ) from err

        self._reader_task = asyncio.create_task(self._read_loop())
        self._stderr_task = asyncio.create_task(self._stderr_loop())
        logger.debug("mini-agent-app-server started (PID: %d)", self._proc.pid)

    async def stop(self) -> None:
        """Gracefully stop the server process."""
        for task in (self._reader_task, self._stderr_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        if self._proc and self._proc.returncode is None:
            if self._proc.stdin and not self._proc.stdin.is_closing():
                self._proc.stdin.close()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                self._proc.kill()
                await self._proc.wait()

        # Reject any pending futures
        for fut in self._pending_requests.values():
            if not fut.done():
                fut.set_exception(RuntimeError("App Server stopped"))
        self._pending_requests.clear()

    # -------------------------------------------------------------------------
    # JSON-RPC Low-level Communication
    # -------------------------------------------------------------------------

    async def _send_request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a JSON-RPC request and wait for correlated response."""
        if not self._proc or not self._proc.stdin or self._proc.returncode is not None:
            raise ServerProcessError("App Server process is not running")

        req_id = self._next_id
        self._next_id += 1

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params if params is not None else {},
        }
        data = json.dumps(payload) + "\n"

        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending_requests[req_id] = future

        logger.debug(">>> SEND: %s", data.strip())
        self._proc.stdin.write(data.encode("utf-8"))
        await self._proc.stdin.drain()

        return await future

    async def _send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        if not self._proc or not self._proc.stdin or self._proc.returncode is not None:
            raise ServerProcessError("App Server process is not running")

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params if params is not None else {},
        }
        data = json.dumps(payload) + "\n"
        logger.debug(">>> NOTIFY: %s", data.strip())
        self._proc.stdin.write(data.encode("utf-8"))
        await self._proc.stdin.drain()

    async def _read_loop(self) -> None:
        """Background loop reading JSONL lines from server stdout."""
        assert self._proc and self._proc.stdout
        while True:
            line_bytes = await self._proc.stdout.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            logger.debug("<<< RECV: %s", line)
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("Failed to decode JSON from server: %s", line)
                continue

            # 1. Correlated response (has id)
            if "id" in msg and msg["id"] is not None:
                req_id = msg["id"]
                future = self._pending_requests.pop(req_id, None)
                if future and not future.done():
                    if "error" in msg:
                        err = msg["error"]
                        future.set_exception(
                            AppServerError(
                                err.get("code", -32603),
                                err.get("message", "Unknown error"),
                                err.get("data"),
                            )
                        )
                    else:
                        future.set_result(msg.get("result"))

            # 2. Server notifications (has method, no id)
            elif "method" in msg:
                method = msg["method"]
                params = msg.get("params", {})

                if method == "turn/event":
                    for q in self._event_queues:
                        await q.put(params)

                elif method == "approval/request":
                    asyncio.create_task(self._handle_approval_request(params))

                else:
                    logger.debug("Received server notification: %s", method)

    async def _stderr_loop(self) -> None:
        """Background loop reading and logging any stderr output from the server."""
        assert self._proc and self._proc.stderr
        while True:
            line_bytes = await self._proc.stderr.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").strip()
            if line:
                logger.warning("[Server STDERR]: %s", line)

    async def _handle_approval_request(self, params: dict[str, Any]) -> None:
        """Handle server approval/request notification."""
        request_id = params.get("requestId", "")
        action = params.get("action", "")
        try:
            approved = await self.approval_handler(request_id, action)
        except Exception as err:  # noqa: BLE001
            logger.error("Approval handler error: %s. Denying by default.", err)
            approved = False

        try:
            await self._send_request(
                "approval/respond",
                {"requestId": request_id, "approved": approved},
            )
        except Exception as err:  # noqa: BLE001
            logger.error("Failed to send approval response: %s", err)

    @staticmethod
    async def _default_auto_approve(request_id: str, action: str) -> bool:
        logger.info("[Approval] Auto-approved action: %s (id=%s)", action, request_id)
        return True

    # -------------------------------------------------------------------------
    # High-level Protocol Methods
    # -------------------------------------------------------------------------

    async def initialize(
        self,
        profile: str | None = "interactive",
        client_name: str = "python-sdk",
        client_version: str = "0.5.0",
        providers: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Negotiate protocol version 1 and receive capability manifest."""
        params: dict[str, Any] = {
            "protocolVersion": 1,
            "clientName": client_name,
            "clientVersion": client_version,
        }
        if profile:
            params["profile"] = profile
        if providers:
            params["providers"] = providers

        res = await self._send_request("initialize", params)
        if res.get("protocolVersion") != 1:
            raise ProtocolVersionMismatchError(
                f"Unsupported protocol version {res.get('protocolVersion')}"
            )
        return res

    async def start_thread(self, thread_id: str = "default") -> str:
        """Start or attach to a conversation thread."""
        res = await self._send_request("thread/start", {"threadId": thread_id})
        self._active_thread_id = res.get("threadId", thread_id)
        return self._active_thread_id

    async def read_thread(self, thread_id: str | None = None) -> ThreadCheckpoint:
        """Read settled checkpoint for thread."""
        res = await self._send_request(
            "thread/read",
            {"threadId": thread_id or self._active_thread_id},
        )
        return ThreadCheckpoint.from_dict(res)

    async def close_thread(self, thread_id: str | None = None) -> None:
        """Close an active thread."""
        await self._send_request(
            "thread/close",
            {"threadId": thread_id or self._active_thread_id},
        )

    async def start_turn(
        self,
        prompt: str,
        mode: str = "start",
        thread_id: str | None = None,
    ) -> TurnSubmissionResult:
        """Submit a turn prompt to the App Server."""
        res = await self._send_request(
            "turn/start",
            {
                "threadId": thread_id or self._active_thread_id,
                "input": {
                    "mode": mode,
                    "text": prompt,
                },
            },
        )
        return TurnSubmissionResult.from_dict(res)

    async def steer_turn(
        self,
        turn_id: str,
        text: str,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """Steer an active turn with a corrective instruction."""
        return await self._send_request(
            "turn/steer",
            {
                "threadId": thread_id or self._active_thread_id,
                "turnId": turn_id,
                "text": text,
            },
        )

    async def interrupt_turn(
        self,
        turn_id: str,
        thread_id: str | None = None,
    ) -> None:
        """Cooperatively cancel/interrupt an active turn."""
        await self._send_request(
            "turn/interrupt",
            {
                "threadId": thread_id or self._active_thread_id,
                "turnId": turn_id,
            },
        )

    async def read_turn(self, turn_id: str) -> TurnReadResult:
        """Read settled result and history of a turn."""
        res = await self._send_request("turn/read", {"turnId": turn_id})
        return TurnReadResult.from_dict(res)

    async def wait_for_turn(
        self,
        turn_id: str,
        timeout: float = 60.0,
        poll_interval: float = 0.5,
    ) -> TurnReadResult:
        """
        Wait/poll until a turn settles (completes, cancels, or fails),
        and return its TurnReadResult.
        """
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            try:
                return await self.read_turn(turn_id)
            except AppServerError as err:
                # Code -32000 means thread is busy / turn is active
                if err.code == -32000 or "active turn" in str(err).lower():
                    if asyncio.get_running_loop().time() >= deadline:
                        raise TurnTimeoutError(
                            f"Turn {turn_id} did not settle within {timeout}s"
                        ) from err
                    await asyncio.sleep(poll_interval)
                else:
                    raise

    wait_turn = wait_for_turn

    async def stream_turn(
        self,
        prompt: str,
        mode: str = "start",
        thread_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Convenience generator that starts a turn and yields event payloads in real-time
        until the turn finishes.
        """
        target_thread = thread_id or self._active_thread_id
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._event_queues.append(queue)

        try:
            start_resp = await self.start_turn(prompt, mode=mode, thread_id=target_thread)
            yield {"type": "_turn_submission", "data": start_resp}

            while True:
                envelope = await queue.get()
                turn_id = envelope.get("turnId")
                event_dict = envelope.get("event", {})
                sequence = envelope.get("sequence", 0)

                yield {
                    "type": "event",
                    "threadId": envelope.get("threadId"),
                    "turnId": turn_id,
                    "sequence": sequence,
                    "event": event_dict,
                    "typed_event": parse_event(event_dict),
                }

                event_type = event_dict.get("type")
                if event_type in ("turn_finished", "run_failed"):
                    break
        finally:
            self._event_queues.remove(queue)

    # -------------------------------------------------------------------------
    # Management & Workflow Methods
    # -------------------------------------------------------------------------

    async def get_world_state(self) -> dict[str, Any]:
        """Get snapshot of current workspace, sandbox, and approval mode."""
        return await self._send_request("world/state", {})

    async def get_mcp_status(self) -> dict[str, Any]:
        """Get status of registered MCP servers and tools."""
        return await self._send_request("mcp/status", {})

    async def set_plan_mode(self, active: bool, prompt: str | None = None) -> dict[str, Any]:
        """Enable or disable Plan Mode (read-only exploration)."""
        return await self._send_request(
            "workflow/plan/set",
            {"active": active, "prompt": prompt},
        )


# Convenient alias matching Codex convention
AsyncMiniAgentClient = MiniAgentClient
