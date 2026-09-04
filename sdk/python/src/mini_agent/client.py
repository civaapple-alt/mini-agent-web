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
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Self

from mini_agent.errors import (
    AppServerError,
    ProtocolVersionMismatchError,
    ServerProcessError,
    TurnTimeoutError,
)
from mini_agent.events import parse_event
from mini_agent.types import (
    DEFAULT_BUILTIN_TOOLS,
    CollaborationMode,
    CollaborationModeKind,
    ItemLifecycleNotification,
    ItemSortDirection,
    McpRetryResult,
    McpStatusResult,
    SessionInfo,
    ThreadCheckpoint,
    ThreadForkResult,
    ThreadGoalClearResult,
    ThreadGoalGetResult,
    ThreadGoalSetResult,
    ThreadGoalStatus,
    ThreadItem,
    ThreadItemsListResult,
    ThreadListResult,
    ThreadResumeResult,
    ThreadSettingsResult,
    TurnReadResult,
    TurnSubmissionResult,
    WorkflowState,
    WorldRefreshResult,
    WorldSetExecutionResult,
    WorldStateResult,
)

logger = logging.getLogger("mini_agent")

DEFAULT_REQUEST_TIMEOUT_SECS = 30.0


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
            if (
                isinstance(h, logging.FileHandler)
                and getattr(h, "baseFilename", None) == abs_target
            ):
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
            isinstance(h, logging.StreamHandler)
            and not isinstance(h, logging.FileHandler)
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
        approval_handler: Callable[..., Awaitable[Any]] | None = None,
        notification_handler: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        log_dir: str | None = None,
        log_file: str | None = None,
        log_level: str | int | None = None,
        log_mode: str | None = None,
        request_timeout: float = DEFAULT_REQUEST_TIMEOUT_SECS,
    ):
        """
        Initialize the MiniAgentClient.

        :param executable: Path or command name for mini-agent-app-server binary.
        :param cwd: Working directory for the server process (defaults to current directory).
        :param env: Additional environment variables.
        :param approval_handler: Optional async callback for handling sensitive tool approvals.
                                 When omitted, the SDK denies approval requests by default
                                 while still exposing approval records in stream_turn().
        :param log_dir: Target directory for execution logs (e.g. 'logs').
        :param log_file: Specific log file path (e.g. 'logs/01_basic_turn.log').
        :param log_level: Logging level ('DEBUG', 'INFO', logging.DEBUG, etc.).
        :param log_mode: Log file open mode ('a' for append, 'w' for overwrite/fresh log).
        :param request_timeout: Timeout in seconds for one JSON-RPC request/response.
        """
        _ensure_utf8_console()
        self.executable = executable
        self.cwd = cwd or os.getcwd()
        file_env = _find_and_load_env(self.cwd)
        # Priority: explicit env arg > process os.environ > .env file
        self.env = {**file_env, **os.environ, **(env or {})}
        self.approval_handler = approval_handler
        self.notification_handler = notification_handler
        self._access_scope = "project"
        self._approval_mode = "per_action"

        # Configure file logging if log_dir, log_file or env specified
        eff_dir = log_dir or self.env.get("MINI_AGENT_LOG_DIR")
        eff_file = log_file or self.env.get("MINI_AGENT_LOG_FILE")
        eff_level = log_level or self.env.get("MINI_AGENT_LOG_LEVEL", "INFO")
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
        self._thread_settings: dict[str, ThreadSettingsResult] = {}
        if request_timeout <= 0:
            raise ValueError("request_timeout must be positive")
        self.request_timeout = request_timeout

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
        executable = self.executable
        if executable == "mini-agent-app-server":
            executable = self.env.get("MINI_AGENT_APP_SERVER_PATH", executable)
        exe_path = shutil.which(executable, path=self.env.get("PATH"))
        if not exe_path:
            exe_path = executable

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
        # 1. Terminate/kill the child process first so stdout/stderr receive EOF immediately
        if self._proc and self._proc.returncode is None:
            if self._proc.stdin and not self._proc.stdin.is_closing():
                try:
                    self._proc.stdin.close()
                except Exception:  # noqa: BLE001, S110
                    pass
            try:
                self._proc.terminate()
            except Exception:  # noqa: BLE001, S110
                pass
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=1.0)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                try:
                    self._proc.kill()
                    await asyncio.wait_for(self._proc.wait(), timeout=1.0)
                except Exception:  # noqa: BLE001, S110
                    pass

        # 2. Cancel and wait for reader/stderr tasks
        for task in (self._reader_task, self._stderr_task):
            if task and not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=0.5)
                except (asyncio.CancelledError, asyncio.TimeoutError, Exception):  # noqa: BLE001, S110
                    pass

        # 3. Reject any pending futures
        for fut in self._pending_requests.values():
            if not fut.done():
                fut.set_exception(RuntimeError("App Server stopped"))
        self._pending_requests.clear()

    @property
    def is_running(self) -> bool:
        """Return True if the underlying mini-agent-app-server subprocess is active."""
        return self._proc is not None and self._proc.returncode is None

    async def restart(self) -> dict[str, Any]:
        """Restart the server process and re-initialize session."""
        await self.stop()
        await self.start()
        res: dict[str, Any] = await self.initialize()
        if self._active_thread_id:
            await self.start_thread(self._active_thread_id)
        return res

    # -------------------------------------------------------------------------
    # JSON-RPC Low-level Communication
    # -------------------------------------------------------------------------

    async def _send_request(
        self, method: str, params: dict[str, Any] | None = None
    ) -> Any:
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
        try:
            await asyncio.wait_for(
                self._write_request(data), timeout=self.request_timeout
            )
            return await asyncio.wait_for(future, timeout=self.request_timeout)
        except asyncio.TimeoutError as err:
            raise ServerProcessError(
                f"App Server request '{method}' timed out after "
                f"{self.request_timeout:g}s"
            ) from err
        finally:
            # The reader normally removes completed requests. On a timeout or
            # transport failure there is no response left to correlate.
            if self._pending_requests.get(req_id) is future:
                self._pending_requests.pop(req_id, None)

    async def _write_request(self, data: str) -> None:
        """Write one bounded JSON-RPC request with the same timeout budget."""
        assert self._proc and self._proc.stdin
        self._proc.stdin.write(data.encode("utf-8"))
        await self._proc.stdin.drain()

    async def _send_notification(
        self, method: str, params: dict[str, Any] | None = None
    ) -> None:
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
                    await self._publish_approval(params, "requested")
                    asyncio.create_task(self._handle_approval_request(params))

                elif method == "approval/resolved":
                    await self._publish_approval(params, "resolved")

                else:
                    notification = {
                        "type": "notification",
                        "method": method,
                        "data": params,
                    }
                    if method in ("item/started", "item/completed"):
                        notification["typed_item_notification"] = (
                            ItemLifecycleNotification.from_dict(method, params)
                        )
                    for q in self._event_queues:
                        await q.put(notification)
                    if self.notification_handler is not None:
                        asyncio.create_task(self.notification_handler(notification))
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

    async def _publish_approval(self, params: dict[str, Any], phase: str) -> None:
        approval = {**params, "phase": phase}
        logger.info(
            "[Approval] %s action: %s (id=%s, outcome=%s)",
            phase,
            approval.get("actionSummary", ""),
            approval.get("requestId", ""),
            approval.get("outcome", "pending"),
        )
        for q in self._event_queues:
            await q.put({"type": "approval", "approval": approval})

    async def _handle_approval_request(self, params: dict[str, Any]) -> None:
        """Handle server approval/request notification."""
        request_id = str(params.get("requestId") or "")
        response: dict[str, Any] = {
            "requestId": request_id,
            "decision": "deny",
            "access": self._access_scope,
            "approval": self._approval_mode,
        }
        try:
            if self.approval_handler is not None:
                res = await self.approval_handler(params)

                if not isinstance(res, dict):
                    raise TypeError(
                        "approval handler must return a typed decision object"
                    )
                decision = str(res.get("decision", "")).lower()
                if decision not in ("approve", "deny"):
                    raise ValueError("approval decision must be approve or deny")
                response.update(res)
                response["requestId"] = request_id
                response["decision"] = decision
                if response["access"] != params.get("access"):
                    raise ValueError("approval access must match the request")
                if response["approval"] not in params.get("allowedApprovalModes", []):
                    raise ValueError("approval scope is not allowed for the request")
            else:
                response["reason"] = "No approval handler configured"
        except Exception as err:  # noqa: BLE001
            logger.error("Approval handler error: %s. Denying by default.", err)
            response["decision"] = "deny"
            response["reason"] = str(err)

        try:
            await self._send_request("approval/respond", response)
        except Exception as err:  # noqa: BLE001
            logger.error("Failed to send approval response: %s", err)

    # -------------------------------------------------------------------------
    # High-level Protocol Methods
    # -------------------------------------------------------------------------

    async def initialize(
        self,
        client_name: str = "python-sdk",
        client_version: str = "0.7.0",
        providers: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Negotiate protocol version 1 and receive capability manifest."""
        params: dict[str, Any] = {
            "protocolVersion": 1,
            "clientName": client_name,
            "clientVersion": client_version,
        }
        if providers:
            params["providers"] = providers

        res = await self._send_request("initialize", params)
        if res.get("protocolVersion") != 1:
            raise ProtocolVersionMismatchError(
                f"Unsupported protocol version {res.get('protocolVersion')}"
            )
        return res

    # -------------------------------------------------------------------------
    # Thread Management
    # -------------------------------------------------------------------------

    async def start_thread(self, thread_id: str = "default") -> str:
        """Start or attach to a conversation thread."""
        res = await self._send_request("thread/start", {"threadId": thread_id})
        self._active_thread_id = res.get("threadId", thread_id)
        return self._active_thread_id

    async def list_threads(
        self,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> ThreadListResult:
        """List active and persisted threads."""
        params: dict[str, Any] = {}
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        res = await self._send_request("thread/list", params)
        return ThreadListResult.from_dict(res)

    async def read_thread(self, thread_id: str | None = None) -> ThreadCheckpoint:
        """Read settled checkpoint for thread."""
        res = await self._send_request(
            "thread/read",
            {"threadId": thread_id or self._active_thread_id},
        )
        return ThreadCheckpoint.from_dict(res)

    async def list_thread_items(
        self,
        thread_id: str | None = None,
        turn_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: ItemSortDirection | None = None,
    ) -> ThreadItemsListResult:
        """Read the bounded Session-backed ThreadItem projection."""
        params: dict[str, Any] = {
            "threadId": thread_id or self._active_thread_id,
        }
        if turn_id is not None:
            params["turnId"] = turn_id
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit
        if sort_direction is not None:
            params["sortDirection"] = sort_direction
        res = await self._send_request("thread/items/list", params)
        return ThreadItemsListResult.from_dict(res)

    async def close_thread(self, thread_id: str | None = None) -> bool:
        """Close an active thread."""
        res = await self._send_request(
            "thread/close",
            {"threadId": thread_id or self._active_thread_id},
        )
        val = res.get("value", res) if isinstance(res, dict) else res
        return val.get("closed", True) if isinstance(val, dict) else True

    async def fork_thread(
        self,
        source_thread_id: str,
        new_thread_id: str,
    ) -> ThreadForkResult:
        """Fork an existing thread history into a new branched thread."""
        res = await self._send_request(
            "thread/fork",
            {
                "sourceThreadId": source_thread_id,
                "newThreadId": new_thread_id,
            },
        )
        return ThreadForkResult.from_dict(res)

    async def resume_thread(
        self,
        thread_id: str,
        checkpoint: ThreadCheckpoint | dict[str, Any],
    ) -> ThreadResumeResult:
        """Resume a thread from a serialized checkpoint."""
        cp_dict = (
            checkpoint.raw if isinstance(checkpoint, ThreadCheckpoint) else checkpoint
        )
        res = await self._send_request(
            "thread/resume",
            {
                "threadId": thread_id,
                "checkpoint": cp_dict,
            },
        )
        return ThreadResumeResult.from_dict(res)

    # -------------------------------------------------------------------------
    # Turn Execution & Real-Time Control
    # -------------------------------------------------------------------------

    async def start_turn(
        self,
        prompt: str,
        mode: str = "start",
        thread_id: str | None = None,
        effort: str | None = None,
    ) -> TurnSubmissionResult:
        """Submit a turn prompt to the App Server with optional reasoning effort ('low', 'medium', 'high')."""
        payload: dict[str, Any] = {
            "threadId": thread_id or self._active_thread_id,
            "input": {
                "mode": mode,
                "text": prompt,
            },
        }
        if effort is not None:
            payload["effort"] = effort
        res = await self._send_request("turn/start", payload)
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
                    if asyncio.get_running_loop().time() > deadline:
                        raise TurnTimeoutError(
                            f"Turn {turn_id} did not complete within {timeout}s"
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
        effort: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Convenience generator that starts a turn and yields event payloads in real-time
        until the turn finishes.

        :param prompt: User instruction or task prompt.
        :param mode: Turn mode ('start' or 'continue').
        :param thread_id: Conversation thread identifier.
        :param effort: Optional reasoning effort ('low', 'medium', 'high').
        """
        target_thread = thread_id or self._active_thread_id
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._event_queues.append(queue)

        try:
            if effort is not None:
                start_resp = await self.start_turn(
                    prompt, mode=mode, thread_id=target_thread, effort=effort
                )
            else:
                start_resp = await self.start_turn(
                    prompt, mode=mode, thread_id=target_thread
                )
            yield {
                "type": "_turn_submission",
                "data": {
                    "status": start_resp.status,
                    "turn_id": start_resp.turn_id,
                    "reason": start_resp.reason,
                },
                "submission": start_resp,
            }

            if not start_resp.turn_id:
                return

            active_turn_id = start_resp.turn_id
            steered = False

            while True:
                envelope = await queue.get()
                if envelope.get("type") == "approval":
                    approval = envelope.get("approval", {})
                    approval_thread = approval.get("threadId") or approval.get(
                        "thread_id"
                    )
                    if approval_thread and approval_thread != target_thread:
                        continue
                    yield envelope
                    continue
                if envelope.get("type") == "notification":
                    if (
                        envelope.get("method") in ("item/started", "item/completed")
                        and "typed_item_notification" not in envelope
                    ):
                        envelope = {
                            **envelope,
                            "typed_item_notification": ItemLifecycleNotification.from_dict(
                                envelope["method"], envelope.get("data", {})
                            ),
                        }
                    notification_data = envelope.get("data", {})
                    notification_thread = None
                    if isinstance(notification_data, dict):
                        notification_thread = notification_data.get(
                            "threadId"
                        ) or notification_data.get("thread_id")
                    if notification_thread and notification_thread != target_thread:
                        continue
                    yield envelope
                    continue
                if envelope.get("threadId") != target_thread:
                    continue
                turn_id = envelope.get("turnId")
                if active_turn_id and turn_id != active_turn_id:
                    if steered:
                        active_turn_id = turn_id
                        steered = False
                    else:
                        continue

                event_dict = envelope.get("event", {})
                sequence = envelope.get("sequence", 0)
                item_dicts = envelope.get("items", [])
                typed_items = [ThreadItem.from_dict(item) for item in item_dicts]

                yield {
                    "type": "event",
                    "threadId": envelope.get("threadId"),
                    "turnId": turn_id,
                    "sequence": sequence,
                    "event": event_dict,
                    "items": item_dicts,
                    "typed_items": typed_items,
                    "typed_event": parse_event(event_dict),
                }

                event_type = event_dict.get("type")
                stop_reason = event_dict.get("stop_reason")
                if event_type == "turn_finished":
                    if stop_reason == "steered":
                        steered = True
                        continue
                    break
                elif event_type == "run_failed":
                    break
        finally:
            self._event_queues.remove(queue)

    # -------------------------------------------------------------------------
    # Thread Settings, Goals, and Read-Only Workflow Projection
    # -------------------------------------------------------------------------

    async def get_workflow_state(self, thread_id: str | None = None) -> WorkflowState:
        """Get the read-only collaboration mode and active Thread Goal."""
        thread_id = thread_id or self._active_thread_id
        settings = self._thread_settings.get(thread_id)
        goal = await self.get_goal(thread_id=thread_id)
        mode = settings.collaboration_mode.mode if settings else "default"
        builtin_tools = (
            list(settings.builtin_tools)
            if settings is not None
            else list(DEFAULT_BUILTIN_TOOLS)
        )
        return WorkflowState(
            collaboration_mode=(
                settings.collaboration_mode
                if settings is not None
                else CollaborationMode()
            ),
            builtin_tools=builtin_tools,
            goal=goal.goal,
            raw={
                "value": {
                    "collaborationMode": {"mode": mode},
                    "builtinTools": builtin_tools,
                    "goal": goal.goal.raw if goal.goal else None,
                }
            },
        )

    async def update_thread_settings(
        self,
        mode: CollaborationModeKind,
        builtin_tools: list[str] | None = None,
        thread_id: str | None = None,
    ) -> ThreadSettingsResult:
        """Update Thread collaboration mode and optional Builtin selection."""
        params: dict[str, Any] = {
            "threadId": thread_id or self._active_thread_id,
            "collaborationMode": {"mode": mode},
        }
        if builtin_tools is not None:
            params["builtinTools"] = builtin_tools
        res = await self._send_request(
            "thread/settings/update",
            params,
        )
        result = ThreadSettingsResult.from_dict(res)
        self._thread_settings[params["threadId"]] = result
        return result

    async def set_collaboration_mode(
        self,
        mode: CollaborationModeKind,
        thread_id: str | None = None,
    ) -> ThreadSettingsResult:
        """Set the Thread collaboration mode to ``default`` or ``plan``."""
        return await self.update_thread_settings(mode, thread_id=thread_id)

    async def set_goal(
        self,
        objective: str | None = None,
        status: ThreadGoalStatus | None = None,
        token_budget: int | None = None,
        thread_id: str | None = None,
    ) -> ThreadGoalSetResult:
        """Set or replace the active Thread Goal."""
        params: dict[str, Any] = {
            "threadId": thread_id or self._active_thread_id,
        }
        if objective is not None:
            params["objective"] = objective
        if status is not None:
            params["status"] = status
        if token_budget is not None:
            params["tokenBudget"] = token_budget
        res = await self._send_request(
            "thread/goal/set",
            params,
        )
        return ThreadGoalSetResult.from_dict(res)

    async def update_goal(
        self,
        objective: str,
        token_budget: int | None = None,
        thread_id: str | None = None,
    ) -> ThreadGoalSetResult:
        """Update a Thread Goal objective without changing its active state."""
        current = await self.get_goal(thread_id=thread_id)
        return await self.set_goal(
            objective=objective,
            status=(current.goal.status if current.goal else "active"),
            token_budget=token_budget
            if token_budget is not None
            else (current.goal.token_budget if current.goal else None),
            thread_id=thread_id,
        )

    async def get_goal(self, thread_id: str | None = None) -> ThreadGoalGetResult:
        """Read the active Goal owned by a Thread."""
        res = await self._send_request(
            "thread/goal/get",
            {"threadId": thread_id or self._active_thread_id},
        )
        return ThreadGoalGetResult.from_dict(res)

    async def clear_goal(self, thread_id: str | None = None) -> ThreadGoalClearResult:
        """Clear the active Goal and stop future automatic continuation."""
        res = await self._send_request(
            "thread/goal/clear",
            {"threadId": thread_id or self._active_thread_id},
        )
        return ThreadGoalClearResult.from_dict(res)

    # -------------------------------------------------------------------------
    # Session, World Governance & MCP Management
    # -------------------------------------------------------------------------

    async def get_session_info(self) -> SessionInfo | None:
        """Get active session storage and identifier metadata."""
        res = await self._send_request("session/info", {})
        val = res.get("value", res) if isinstance(res, dict) else res
        if not val:
            return None
        return SessionInfo.from_dict(res)

    async def get_world_state(self) -> WorldStateResult:
        """Get snapshot of current workspace, sandbox, and approval mode."""
        res = await self._send_request("world/state", {})
        return WorldStateResult.from_dict(res)

    async def refresh_world(self) -> WorldRefreshResult:
        """Refresh workspace and detect newly installed commands or toolchains."""
        res = await self._send_request("world/refresh", {})
        return WorldRefreshResult.from_dict(res)

    async def set_world_execution(
        self,
        access: str = "project",
        approval: str = "per_action",
    ) -> WorldSetExecutionResult:
        """Set independent access and approval reuse scopes."""
        if access not in ("project", "full_machine"):
            raise ValueError("access must be project or full_machine")
        if approval not in ("per_action", "current_session", "current_project"):
            raise ValueError(
                "approval must be per_action, current_session, or current_project"
            )
        self._access_scope = access
        self._approval_mode = approval
        res = await self._send_request(
            "world/set_execution",
            {
                "access": access,
                "approval": approval,
            },
        )
        return WorldSetExecutionResult.from_dict(res)

    async def get_mcp_status(self) -> McpStatusResult:
        """Get status of registered MCP servers and tools."""
        res = await self._send_request("mcp/status", {})
        return McpStatusResult.from_dict(res)

    async def retry_mcp(self) -> McpRetryResult:
        """Retry connection to failed or inactive MCP servers."""
        res = await self._send_request("mcp/retry", {})
        return McpRetryResult.from_dict(res)


# Convenient alias matching Codex convention
AsyncMiniAgentClient = MiniAgentClient
