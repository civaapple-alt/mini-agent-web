"""
Mini Agent App Server Python Client SDK
Asynchronous JSON-RPC 2.0 Client over stdio transport.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
from typing import Any, AsyncIterator, Callable, Coroutine, Dict, Optional

logger = logging.getLogger("mini_agent_client")


class AppServerError(Exception):
    """Raised when the App Server returns a JSON-RPC error."""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(f"[{code}] {message} (data={data})")
        self.code = code
        self.message = message
        self.data = data


class MiniAgentClient:
    """Asynchronous Client for mini-agent-app-server."""

    def __init__(
        self,
        executable: str = "mini-agent-app-server",
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        approval_handler: Optional[Callable[[str, str], Coroutine[Any, Any, bool]]] = None,
    ):
        """
        Initialize the MiniAgentClient.

        :param executable: Path or command name for mini-agent-app-server binary.
        :param cwd: Working directory for the server process (defaults to current directory).
        :param env: Additional environment variables.
        :param approval_handler: Async callback `async def handler(request_id: str, action: str) -> bool`
                                 for handling sensitive tool approvals. Defaults to auto-approve.
        """
        self.executable = executable
        self.cwd = cwd or os.getcwd()
        self.env = {**os.environ, **(env or {})}
        self.approval_handler = approval_handler or self._default_auto_approve

        self._proc: Optional[asyncio.subprocess.Process] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._next_id: int = 1
        self._pending_requests: Dict[int, asyncio.Future[Any]] = {}
        self._event_queues: list[asyncio.Queue[dict[str, Any]]] = []
        self._active_thread_id: str = "default"

    async def __aenter__(self) -> MiniAgentClient:
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.stop()

    async def start(self) -> None:
        """Start the mini-agent-app-server subprocess and reader loop."""
        exe_path = shutil.which(self.executable, path=self.env.get("PATH"))
        if not exe_path:
            # Fallback to direct executable if on Windows or absolute path
            exe_path = self.executable

        self._proc = await asyncio.create_subprocess_exec(
            exe_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.cwd,
            env=self.env,
        )

        self._reader_task = asyncio.create_task(self._read_loop())
        logger.debug("mini-agent-app-server started (PID: %d)", self._proc.pid)

    async def stop(self) -> None:
        """Gracefully stop the server process."""
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
            try:
                await self._reader_task
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

    async def _send_request(self, method: str, params: Optional[dict] = None) -> Any:
        """Send a JSON-RPC request and wait for correlated response."""
        if not self._proc or not self._proc.stdin or self._proc.returncode is not None:
            raise RuntimeError("App Server is not running")

        req_id = self._next_id
        self._next_id += 1

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params if params is not None else {},
        }

        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending_requests[req_id] = future

        line = json.dumps(payload) + "\n"
        self._proc.stdin.write(line.encode("utf-8"))
        await self._proc.stdin.drain()

        return await future

    async def _send_notification(self, method: str, params: Optional[dict] = None) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        if not self._proc or not self._proc.stdin or self._proc.returncode is not None:
            raise RuntimeError("App Server is not running")

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params if params is not None else {},
        }
        line = json.dumps(payload) + "\n"
        self._proc.stdin.write(line.encode("utf-8"))
        await self._proc.stdin.drain()

    async def _read_loop(self) -> None:
        """Background loop reading JSON-RPC lines from stdout."""
        assert self._proc and self._proc.stdout
        while True:
            line_bytes = await self._proc.stdout.readline()
            if not line_bytes:
                break

            line = line_bytes.decode("utf-8").strip()
            if not line:
                continue

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

    async def _handle_approval_request(self, params: dict) -> None:
        """Handle server approval/request notification."""
        request_id = params.get("requestId", "")
        action = params.get("action", "")
        try:
            approved = await self.approval_handler(request_id, action)
        except Exception as err:
            logger.error("Approval handler error: %s. Denying by default.", err)
            approved = False

        try:
            await self._send_request(
                "approval/respond",
                {"requestId": request_id, "approved": approved},
            )
        except Exception as err:
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
        profile: Optional[str] = "interactive",
        client_name: str = "python-sdk",
        client_version: str = "0.5.0",
        providers: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Negotiate protocol version 1 and receive capability manifest."""
        params: dict[str, Any] = {
            "protocolVersion": 1,
            "clientName": client_name,
            "clientVersion": client_version,
            "capabilities": {},
        }
        if profile:
            params["profile"] = profile
        if providers:
            params["providers"] = providers

        result = await self._send_request("initialize", params)
        await self._send_notification("initialized", {})
        return result

    async def start_thread(self, thread_id: str = "default") -> str:
        """Start or initialize default thread."""
        result = await self._send_request("thread/start", {})
        self._active_thread_id = result.get("threadId", thread_id)
        return self._active_thread_id

    async def read_thread(self, thread_id: Optional[str] = None) -> dict[str, Any]:
        """Read settled checkpoint for thread."""
        return await self._send_request(
            "thread/read",
            {"threadId": thread_id or self._active_thread_id},
        )

    async def fork_thread(self, source_thread_id: str, new_thread_id: str) -> str:
        """Fork a thread to a new independent branch."""
        result = await self._send_request(
            "thread/fork",
            {"sourceThreadId": source_thread_id, "newThreadId": new_thread_id},
        )
        return result.get("threadId", new_thread_id)

    async def start_turn(
        self,
        prompt: str,
        mode: str = "start",
        thread_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Submit a turn prompt to the App Server."""
        target_thread = thread_id or self._active_thread_id
        return await self._send_request(
            "turn/start",
            {
                "threadId": target_thread,
                "input": {"mode": mode, "text": prompt},
            },
        )

    async def steer_turn(
        self,
        turn_id: str,
        text: str,
        thread_id: Optional[str] = None,
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
        thread_id: Optional[str] = None,
    ) -> None:
        """Cooperatively cancel/interrupt an active turn."""
        await self._send_request(
            "turn/interrupt",
            {
                "threadId": thread_id or self._active_thread_id,
                "turnId": turn_id,
            },
        )

    async def read_turn(self, turn_id: str) -> dict[str, Any]:
        """Read settled result and history of a turn."""
        return await self._send_request("turn/read", {"turnId": turn_id})

    async def stream_turn(
        self,
        prompt: str,
        mode: str = "start",
        thread_id: Optional[str] = None,
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
            # Yield initial submission result
            yield {"type": "_turn_submission", "data": start_resp}

            while True:
                envelope = await queue.get()
                turn_id = envelope.get("turnId")
                event = envelope.get("event", {})
                sequence = envelope.get("sequence", 0)

                yield {
                    "type": "event",
                    "threadId": envelope.get("threadId"),
                    "turnId": turn_id,
                    "sequence": sequence,
                    "event": event,
                }

                if "turn_finished" in event or "run_failed" in event:
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

    async def set_plan_mode(self, active: bool, prompt: Optional[str] = None) -> dict[str, Any]:
        """Enable or disable Plan Mode (read-only exploration)."""
        return await self._send_request(
            "workflow/plan/set",
            {"active": active, "prompt": prompt},
        )

    async def start_goal(self, objective: str) -> dict[str, Any]:
        """Start autonomous Goal Mode with verification milestones."""
        return await self._send_request(
            "workflow/goal/start",
            {"objective": objective},
        )
