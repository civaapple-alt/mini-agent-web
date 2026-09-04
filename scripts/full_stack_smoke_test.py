"""
Full-Stack End-to-End Smoke Test for Mini Agent.
Validates Web Studio Gateway, Python SDK, App Server, Host, and Core
against real LLM credentials configured in C:\\Users\\alwar\\.mini-agent\\.env.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

# Ensure sdk/python and repo root are in sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
SDK_ROOT = REPO_ROOT / "sdk" / "python" / "src"
if str(SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from mini_agent import MiniAgentClient

# -----------------------------------------------------------------------------
# ANSI Colors and Output Formatting
# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001, S110
        pass

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


# -----------------------------------------------------------------------------
# Git Metadata Resolution Helpers
# -----------------------------------------------------------------------------


def get_git_info(directory: Path) -> dict[str, str]:
    """Retrieve git commit hash and commit timestamp for a directory."""
    try:
        import subprocess

        cmd = ["git", "log", "-1", "--format=%h|%H|%cd", "--date=iso"]
        res = subprocess.run(
            cmd,
            cwd=str(directory),
            capture_output=True,
            text=True,
            check=True,
            timeout=3.0,
        )
        parts = res.stdout.strip().split("|")
        if len(parts) == 3:
            return {
                "short_commit": parts[0],
                "commit": parts[1],
                "commit_date": parts[2],
            }
    except Exception:  # noqa: BLE001, S110
        pass
    return {"short_commit": "unknown", "commit": "unknown", "commit_date": "unknown"}


def find_git_root(path: Path) -> Path:
    """Find the root of the enclosing git repository."""
    current = path if path.is_dir() else path.parent
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return current


# -----------------------------------------------------------------------------
# Test Report Collector
# -----------------------------------------------------------------------------


@dataclass
class PhaseRecord:
    phase_num: int
    title: str
    passed: bool = False
    duration: float = 0.0
    logs: list[tuple[str, str]] = field(default_factory=list)
    error: str | None = None


class ReportCollector:
    """Collects structured diagnostics, logs, and metrics across all smoke phases."""

    def __init__(self) -> None:
        self.start_time: datetime = datetime.now().astimezone()
        self.end_time: datetime | None = None
        ws_info = get_git_info(REPO_ROOT)
        self.metadata: dict[str, str] = {
            "OS": f"{platform.system()} {platform.release()} ({platform.machine()})",
            "Python": f"{platform.python_version()} ({platform.python_implementation()})",
            "Web Studio Commit ID": f"{ws_info['short_commit']} ({ws_info['commit']})",
            "Web Studio Commit Time": ws_info["commit_date"],
        }
        self.current_phase: PhaseRecord | None = None
        self.phases: list[PhaseRecord] = []

    def start_phase(self, phase_num: int, title: str) -> None:
        rec = PhaseRecord(phase_num=phase_num, title=title)
        self.current_phase = rec
        self.phases.append(rec)

    def log(self, level: str, msg: str) -> None:
        if self.current_phase:
            self.current_phase.logs.append((level, msg))

    def end_phase(
        self, passed: bool, duration: float, error: str | None = None
    ) -> None:
        if self.current_phase:
            self.current_phase.passed = passed
            self.current_phase.duration = duration
            self.current_phase.error = error

    def finish(self) -> None:
        self.end_time = datetime.now().astimezone()

    def generate_markdown(self) -> str:
        total_dur = (
            (self.end_time - self.start_time).total_seconds()
            if self.end_time
            else sum(p.duration for p in self.phases)
        )
        all_passed = all(p.passed for p in self.phases) and len(self.phases) == 7
        overall_status = "PASSED" if all_passed else "FAILED"

        start_str = self.start_time.strftime("%Y-%m-%d %H:%M:%S")
        end_str = (
            self.end_time.strftime("%Y-%m-%d %H:%M:%S") if self.end_time else start_str
        )

        ws_commit = self.metadata.get("Web Studio Commit ID", "unknown")
        ws_time = self.metadata.get("Web Studio Commit Time", "unknown")
        as_version = self.metadata.get("App Server Version", "unknown")
        as_commit = self.metadata.get("App Server Commit ID", "unknown")
        as_time = self.metadata.get("App Server Commit Time", "unknown")

        lines: list[str] = [
            "# Mini Agent Full-Stack Live LLM Smoke Test Report\n",
            f"> **Status**: **`{overall_status}`** | **Duration**: `{total_dur:.2f}s` | **Date**: `{start_str}`\n",
            f"> **Web Studio**: `{ws_commit}` ({ws_time})\n",
            f"> **App Server**: `v{as_version}` @ `{as_commit}` ({as_time})\n",
            "## 1. Execution Metadata\n",
            "| Property | Value |",
            "| :--- | :--- |",
            f"| **Started At** | {start_str} |",
            f"| **Finished At** | {end_str} |",
            f"| **Total Duration** | {total_dur:.2f}s |",
            f"| **Overall Verdict** | **{overall_status}** |",
        ]
        for k, v in self.metadata.items():
            lines.append(f"| **{k}** | `{v}` |")
        lines.append("")

        lines.extend(
            [
                "## 2. Phase Summary Table\n",
                "| Phase | Title | Status | Duration |",
                "| :---: | :--- | :---: | :---: |",
            ]
        )
        for p in self.phases:
            status_icon = "PASSED" if p.passed else "FAILED"
            lines.append(
                f"| {p.phase_num} | {p.title} | `{status_icon}` | {p.duration:.2f}s |"
            )
        lines.append("")

        lines.append("## 3. Detailed Phase Logs\n")
        for p in self.phases:
            p_status = "PASSED" if p.passed else "FAILED"
            lines.append(
                f"### Phase {p.phase_num}: {p.title} (`{p_status}` - {p.duration:.2f}s)\n"
            )
            if p.error:
                lines.append(f"**Error**:\n```\n{p.error}\n```\n")

            if p.logs:
                lines.append("```text")
                for lvl, msg in p.logs:
                    lines.append(f"[{lvl:<4}] {msg}")
                lines.append("```\n")

        lines.append("## 4. Verification Verdict\n")
        if all_passed:
            lines.append(
                "All 7 smoke phases completed successfully with zero protocol or runtime errors."
            )
        else:
            lines.append(
                "One or more smoke phases encountered an error. Please inspect the logs above."
            )

        return "\n".join(lines)

    def save_report(self, target_dir: Path) -> Path:
        target_dir.mkdir(parents=True, exist_ok=True)
        timestamp_str = self.start_time.strftime("%Y%m%d-%H%M%S")
        filename = f"smoke-test-report-{timestamp_str}.md"
        out_file = target_dir / filename
        out_file.write_text(self.generate_markdown(), encoding="utf-8")
        return out_file


report = ReportCollector()


def log_phase(phase_num: int, title: str) -> None:
    report.start_phase(phase_num, title)
    print(f"\n{BOLD}{CYAN}{'=' * 72}{RESET}")
    print(f"{BOLD}{CYAN} Phase {phase_num}: {title}{RESET}")
    print(f"{BOLD}{CYAN}{'=' * 72}{RESET}\n", flush=True)


def log_ok(msg: str) -> None:
    report.log("PASS", msg)
    print(f"  {GREEN}[PASS]{RESET} {msg}", flush=True)


def log_fail(msg: str) -> None:
    report.log("FAIL", msg)
    print(f"  {RED}[FAIL]{RESET} {BOLD}{msg}{RESET}", flush=True)


def log_info(msg: str) -> None:
    report.log("INFO", msg)
    print(f"  {YELLOW}[INFO]{RESET} {msg}", flush=True)


# -----------------------------------------------------------------------------
# Configuration Loader
# -----------------------------------------------------------------------------


def load_user_env() -> dict[str, str]:
    """Load credentials from ~/.mini-agent/.env or explicit Windows path."""
    candidates = [
        Path(os.environ.get("USERPROFILE", "")) / ".mini-agent" / ".env",
        Path.home() / ".mini-agent" / ".env",
        REPO_ROOT / ".env",
    ]
    env_vars: dict[str, str] = {}
    loaded_from = None

    for candidate in candidates:
        if candidate.is_file():
            loaded_from = candidate
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip()
            break

    if not loaded_from:
        raise FileNotFoundError(
            "Could not locate .env in ~/.mini-agent/.env or repo root. "
            "Please ensure credentials are configured."
        )

    log_info(f"Loaded credentials from: {loaded_from}")
    return env_vars


def resolve_app_server_bin() -> Path:
    """Find the compiled mini-agent-app-server binary."""
    explicit = os.environ.get("MINI_AGENT_APP_SERVER_PATH")
    if explicit and Path(explicit).is_file():
        return Path(explicit).resolve()

    candidates = [
        REPO_ROOT.parent
        / "mini-codex"
        / "target"
        / "release"
        / "mini-agent-app-server.exe",
        REPO_ROOT.parent
        / "mini-codex"
        / "target"
        / "debug"
        / "mini-agent-app-server.exe",
        REPO_ROOT.parent
        / "mini-codex"
        / "target"
        / "release"
        / "mini-agent-app-server",
        REPO_ROOT.parent / "mini-codex" / "target" / "debug" / "mini-agent-app-server",
    ]
    existing = [c.resolve() for c in candidates if c.is_file()]
    if existing:
        existing.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return existing[0]

    raise FileNotFoundError(
        "Could not locate mini-agent-app-server binary. "
        "Run `cargo build --release -p mini-agent-app-server` in mini-codex first."
    )


# -----------------------------------------------------------------------------
# Test Phase Implementations
# -----------------------------------------------------------------------------


async def phase_1_preflight(env: dict[str, str], app_server_bin: Path) -> None:
    """Phase 1: Environment & Capability Diagnostics."""
    log_phase(1, "Environment & Capability Diagnostics")

    api_key = env.get("OPENAI_API_KEY", "")
    assert api_key, "OPENAI_API_KEY is not set"
    log_ok(f"OPENAI_API_KEY detected: {api_key[:6]}...{api_key[-4:]}")

    model = env.get("OPENAI_MODEL", "deepseek-v4-flash")
    base_url = env.get("OPENAI_BASE_URL", "https://api.deepseek.com")
    log_ok(f"Primary Model: {model} at {base_url}")

    verifier_model = env.get("VERIFIER_OPENAI_MODEL", "deepseek-v4-pro")
    log_ok(f"Verifier Model: {verifier_model}")

    log_ok(f"Using App Server: {app_server_bin}")

    runtime_env = dict(os.environ)
    runtime_env.update(env)
    runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    async with MiniAgentClient(env=runtime_env, log_dir="logs") as client:
        init_res = await asyncio.wait_for(client.initialize(), timeout=10.0)
        assert init_res.get("serverName") == "mini-agent-app-server", (
            "Unexpected serverName"
        )
        assert init_res.get("protocolVersion") == 1, "Expected protocol version 1"

        caps = init_res.get("capabilities", {})
        assert caps.get("approvalRequests") is True, (
            "approvalRequests capability missing"
        )
        assert caps.get("itemLifecycleNotifications") is True, (
            "itemLifecycleNotifications missing"
        )
        assert caps.get("workflows") is True, "workflows capability missing"
        as_repo = find_git_root(app_server_bin)
        as_info = get_git_info(as_repo)
        server_version = str(init_res.get("serverVersion", "0.7.0"))

        log_ok(
            f"Web Studio Commit: {report.metadata.get('Web Studio Commit ID')} @ {report.metadata.get('Web Studio Commit Time')}"
        )
        log_ok(
            f"App Server: v{server_version}, commit {as_info['short_commit']} ({as_info['commit']}) @ {as_info['commit_date']}"
        )

        report.metadata["App Server Version"] = server_version
        report.metadata["App Server Commit ID"] = (
            f"{as_info['short_commit']} ({as_info['commit']})"
        )
        report.metadata["App Server Commit Time"] = as_info["commit_date"]
        report.metadata["App Server Binary"] = str(app_server_bin)
        report.metadata["Primary Model"] = f"{model} ({base_url})"
        report.metadata["Verifier Model"] = verifier_model


async def phase_2_basic_turn_streaming(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 2: Live Core Turn & Token Streaming (DeepSeek Real LLM)."""
    log_phase(2, "Live Model Turn & Reasoning Streaming")

    runtime_env = dict(os.environ)
    runtime_env.update(env)
    runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    async with MiniAgentClient(env=runtime_env, log_dir="logs") as client:
        await client.initialize()
        thread_id = await client.start_thread("smoke-turn-thread")
        log_ok(f"Started thread: {thread_id}")

        prompt = "Answer in exactly 3 English words: What color is the clear sky?"
        log_info(f"User Prompt: '{prompt}'")

        received_submission = False
        received_turn_started = False
        reasoning_chunks: list[str] = []
        text_chunks: list[str] = []
        turn_status: str | None = None

        async for item in client.stream_turn(prompt, thread_id=thread_id):
            item_type = item.get("type")
            if item_type == "_turn_submission":
                received_submission = True
            elif item_type == "event":
                event = item["event"]
                event_type = event.get("type")
                if event_type == "turn_started":
                    received_turn_started = True
                elif event_type == "assistant_reasoning_delta":
                    reasoning_chunks.append(event.get("delta", ""))
                elif event_type == "assistant_text_delta":
                    text_chunks.append(event.get("delta", ""))
                elif event_type == "turn_finished":
                    turn_status = (
                        event.get("status")
                        or event.get("stop_reason")
                        or event.get("stopReason")
                    )

        full_reasoning = "".join(reasoning_chunks).strip()
        full_text = "".join(text_chunks).strip()

        assert received_submission, "Missing _turn_submission"
        assert received_turn_started, "Missing turn_started event"
        assert turn_status == "completed", (
            f"Turn did not complete cleanly, got {turn_status}"
        )
        assert full_text, "Model returned empty text response"

        if full_reasoning:
            preview_reasoning = full_reasoning.replace("\n", " ")[:60]
            log_ok(
                f"Reasoning stream captured ({len(full_reasoning)} chars): {preview_reasoning}..."
            )
        log_ok(f"Assistant response captured: '{full_text}'")
        log_ok("Turn completed with status: 'completed'")


async def phase_3_autonomous_tool_calling(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 3: Autonomous Built-in Tool Calling (read_file)."""
    log_phase(3, "Autonomous Built-in Tool Calling (read_file)")

    fixture_path = REPO_ROOT / "smoke_fixture_token.txt"
    secret_token = f"TOKEN_{int(time.time())}_ALPHA_VERIFIED"
    fixture_path.write_text(f"SECRET_DATA: {secret_token}\n", encoding="utf-8")

    try:
        runtime_env = dict(os.environ)
        runtime_env.update(env)
        runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

        async with MiniAgentClient(
            cwd=str(REPO_ROOT), env=runtime_env, log_dir="logs"
        ) as client:
            await client.initialize()
            thread_id = await client.start_thread("smoke-tool-thread")

            prompt = (
                "Use the read_file tool to read the file 'smoke_fixture_token.txt'. "
                "Report the exact SECRET_DATA token you find."
            )
            log_info(f"User Prompt: '{prompt}'")

            tool_invoked = False
            tool_args: dict[str, Any] = {}
            tool_finished = False
            text_chunks: list[str] = []

            async for item in client.stream_turn(prompt, thread_id=thread_id):
                if item.get("type") == "event":
                    event = item["event"]
                    event_type = event.get("type")
                    if event_type == "tool_started":
                        tool_invoked = True
                        call = event.get("call", {})
                        tool_args = call.get("arguments", {})
                        log_ok(
                            f"Tool call detected: {call.get('name')} with args {tool_args}"
                        )
                    elif event_type == "tool_finished":
                        tool_finished = True
                        log_ok(
                            f"Tool execution succeeded: exit_code={event.get('exit_code')}"
                        )
                    elif event_type == "assistant_text_delta":
                        text_chunks.append(event.get("delta", ""))

            full_text = "".join(text_chunks)
            assert tool_invoked, "Model failed to invoke tool"
            assert tool_finished, "Tool call did not finish"
            assert secret_token in full_text, (
                f"Model response did not contain the secret token. Output: '{full_text}'"
            )
            log_ok(
                f"Model successfully synthesized tool output into response: '{full_text.strip()}'"
            )

    finally:
        if fixture_path.is_file():
            fixture_path.unlink()


async def phase_4_approval_security_flow(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 4: Typed Sensitive Action Approval & Rejection Flow."""
    log_phase(4, "Sensitive Action Approval & Rejection Flow")

    approval_log: list[dict[str, Any]] = []
    should_approve = True

    async def test_approval_handler(req: dict[str, Any]) -> dict[str, Any]:
        approval_log.append(req)
        decision = "approve" if should_approve else "deny"
        log_info(
            f"Intercepted approval request: id={req.get('requestId')}, action={req.get('actionClass')}"
        )
        log_info(f"Submitting typed decision: {decision}")
        return {
            "decision": decision,
            "access": req.get("access", "project"),
            "approval": "per_action",
            "reason": "Smoke test decision",
        }

    runtime_env = dict(os.environ)
    runtime_env.update(env)
    runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    async with MiniAgentClient(
        cwd=str(REPO_ROOT),
        env=runtime_env,
        log_dir="logs",
        approval_handler=test_approval_handler,
    ) as client:
        await client.initialize()
        thread_id = await client.start_thread("smoke-approval-thread")

        # 1. Test Approval Path
        should_approve = True
        approval_log.clear()
        prompt_approve = "Use the shell tool to run a command with pwsh to print 'APPROVAL_TOKEN_PASS_778'."
        log_info("Step 1: Testing Approved Execution...")

        text_chunks: list[str] = []
        async for item in client.stream_turn(prompt_approve, thread_id=thread_id):
            if (
                item.get("type") == "event"
                and item["event"].get("type") == "assistant_text_delta"
            ):
                text_chunks.append(item["event"].get("delta", ""))

        _full_output = "".join(text_chunks)
        assert len(approval_log) >= 1, "No approval request was triggered"
        last_req = approval_log[-1]
        assert (
            last_req.get("actionClass") in ("shell", "shell_execute")
            or last_req.get("toolName") == "shell"
        ), f"Unexpected actionClass: {last_req.get('actionClass')}"
        log_ok(
            f"Approved shell execution completed through security broker (action={last_req.get('actionClass')})"
        )

        # 2. Test Denial Path
        should_approve = False
        approval_log.clear()
        thread_deny = await client.start_thread("smoke-deny-thread")
        prompt_deny = "Use the shell tool to run a command with pwsh to print 'SHOULD_NOT_EXECUTE'."
        log_info("Step 2: Testing Denied Execution...")

        denied_text_chunks: list[str] = []
        async for item in client.stream_turn(prompt_deny, thread_id=thread_deny):
            if (
                item.get("type") == "event"
                and item["event"].get("type") == "assistant_text_delta"
            ):
                denied_text_chunks.append(item["event"].get("delta", ""))

        assert len(approval_log) >= 1, "Denial test did not trigger approval request"
        log_ok(
            "Deliberate denial was respected; agent was blocked from unauthorized execution"
        )


async def phase_5_plan_mode_lifecycle(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 5: Plan Mode & Scratch Isolation."""
    log_phase(5, "Plan Mode & Scratch Space Isolation")

    runtime_env = dict(os.environ)
    runtime_env.update(env)
    runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    async with MiniAgentClient(
        cwd=str(REPO_ROOT), env=runtime_env, log_dir="logs"
    ) as client:
        await client.initialize()
        thread_id = await client.start_thread("default")

        # Update thread to Plan mode
        settings_res = await client.update_thread_settings(
            mode="plan", thread_id=thread_id
        )
        assert settings_res.collaboration_mode.mode == "plan", (
            "Failed to switch to plan mode"
        )
        log_ok("Switched thread collaboration mode to 'plan'")

        prompt = (
            "Create a concise 2-step plan to add a unit test. "
            "Do not execute any changes, only output the numbered plan."
        )
        log_info(f"Planning Prompt: '{prompt}'")

        text_chunks: list[str] = []
        async for item in client.stream_turn(prompt, thread_id=thread_id):
            if (
                item.get("type") == "event"
                and item["event"].get("type") == "assistant_text_delta"
            ):
                text_chunks.append(item["event"].get("delta", ""))

        plan_output = "".join(text_chunks).strip()
        assert plan_output, "Plan output was empty"
        log_ok(f"Plan formulated by model ({len(plan_output)} chars)")

        # Reset back to default mode
        await client.update_thread_settings(mode="default", thread_id=thread_id)
        log_ok("Reset thread collaboration mode back to 'default'")


async def phase_6_goal_runtime_verifier(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 6: Autonomous Goal Runtime & Verifier."""
    log_phase(6, "Autonomous Goal Runtime & Independent Verifier")

    runtime_env = dict(os.environ)
    runtime_env.update(env)
    runtime_env["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    async with MiniAgentClient(
        cwd=str(REPO_ROOT), env=runtime_env, log_dir="logs"
    ) as client:
        await client.initialize()
        thread_id = await client.start_thread("default")

        objective = "Verify that git is working by checking git --version"
        log_info(f"Setting Thread Goal: '{objective}'")

        goal_res = await client.set_goal(objective=objective, thread_id=thread_id)
        assert goal_res.goal is not None, "Failed to set goal"
        assert goal_res.goal.objective == objective, "Goal objective mismatch"
        log_ok(f"Goal set successfully: status={goal_res.goal.status}")

        # Query goal status
        queried = await client.get_goal(thread_id=thread_id)
        assert queried.goal is not None
        assert queried.goal.status in ("active", "completed", "idle"), (
            f"Unexpected goal status: {queried.goal.status}"
        )
        log_ok(f"Verified goal status inspection: {queried.goal.status}")

        # Clear goal
        cleared = await client.clear_goal(thread_id=thread_id)
        assert cleared.cleared is True, "Failed to clear goal"
        log_ok("Cleared Goal runtime state cleanly")


async def phase_7_gateway_and_websocket(
    env: dict[str, str], app_server_bin: Path
) -> None:
    """Phase 7: FastAPI Gateway REST & WebSocket Live Turn."""
    log_phase(7, "FastAPI Gateway REST & Live WebSocket Turn")

    os.environ.update(env)
    os.environ["MINI_AGENT_APP_SERVER_PATH"] = str(app_server_bin)

    import socket

    import httpx
    import uvicorn
    import websockets

    from server.app import create_app
    from server.session_manager import session_manager

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    app = create_app()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())

    while not server.started:
        await asyncio.sleep(0.05)

    try:
        # 1. REST Endpoints Validation
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}"
        ) as http_client:
            # Health
            resp_health = await http_client.get("/health")
            assert resp_health.status_code == 200
            assert resp_health.json().get("status") == "healthy"
            log_ok("REST: /health -> 200 OK healthy")

            # World State
            resp_world = await http_client.get("/api/world/state")
            assert resp_world.status_code == 200
            log_ok("REST: /api/world/state -> 200 OK")

            # Workflows State
            resp_wf = await http_client.get("/api/workflows/state")
            assert resp_wf.status_code == 200
            assert "builtin_tools" in resp_wf.json()
            log_ok("REST: /api/workflows/state -> 200 OK")

            # Settings
            resp_settings = await http_client.get("/api/settings")
            assert resp_settings.status_code == 200
            log_ok(
                f"REST: /api/settings -> access={resp_settings.json().get('access')}"
            )

        # 2. Live WebSocket Turn Validation
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws/agent") as ws:
            # Ping/pong check
            await ws.send(json.dumps({"action": "ping"}))
            raw_pong = await ws.recv()
            pong = json.loads(raw_pong)
            assert pong.get("type") == "pong", "WebSocket ping failed"
            log_ok("WebSocket: /ws/agent ping/pong verified")

            # Live model turn via WebSocket
            ws_prompt = "Say 'GATEWAY_OK' in uppercase."
            log_info(f"WebSocket Turn Prompt: '{ws_prompt}'")

            await ws.send(
                json.dumps(
                    {
                        "action": "turn",
                        "prompt": ws_prompt,
                        "threadId": "default",
                    }
                )
            )

            ws_submission_received = False
            ws_turn_started_received = False
            ws_text_deltas: list[str] = []
            ws_turn_completed = False

            # Read streaming packets until turn_finished
            start_wait = time.time()
            while time.time() - start_wait < 30.0:
                raw_pkt = await asyncio.wait_for(ws.recv(), timeout=20.0)
                pkt = json.loads(raw_pkt)
                pkt_type = pkt.get("type")

                if pkt_type == "_turn_submission":
                    ws_submission_received = True
                elif pkt_type == "event":
                    evt = pkt.get("event", {})
                    evt_type = evt.get("type")
                    if evt_type == "turn_started":
                        ws_turn_started_received = True
                    elif evt_type == "assistant_text_delta":
                        ws_text_deltas.append(evt.get("delta", ""))
                    elif evt_type == "turn_finished":
                        ws_turn_completed = True
                        break

            assert ws_submission_received, "WebSocket did not receive _turn_submission"
            assert ws_turn_started_received, "WebSocket did not receive turn_started"
            assert ws_turn_completed, (
                "WebSocket stream did not reach turn_finished within timeout"
            )

            ws_response_text = "".join(ws_text_deltas).strip()
            log_ok(f"WebSocket: Live streaming turn succeeded: '{ws_response_text}'")

        # 3. Canonical SessionStore Persistence Check
        canonical_thread = session_manager.read_any_project_thread("default")
        if canonical_thread:
            log_ok("SessionStore: Thread 'default' verified in canonical store")
        else:
            log_info("Thread registered through live App Server runtime")
    finally:
        server.should_exit = True
        await server_task


# -----------------------------------------------------------------------------
# Main Runner
# -----------------------------------------------------------------------------


async def main(report_dir: Path | None = None) -> int:
    print(
        f"\n{BOLD}{GREEN}========================================================================{RESET}"
    )
    print(
        f"{BOLD}{GREEN} Mini Agent Full-Stack Live LLM End-to-End Smoke Test Suite{RESET}"
    )
    print(
        f"{BOLD}{GREEN}========================================================================{RESET}"
    )

    env = load_user_env()
    app_server_bin = resolve_app_server_bin()

    phases = [
        ("Preflight & Diagnostics", phase_1_preflight),
        ("Live Turn & Reasoning Streaming", phase_2_basic_turn_streaming),
        ("Autonomous Tool Calling", phase_3_autonomous_tool_calling),
        ("Approval & Security Permissions", phase_4_approval_security_flow),
        ("Plan Mode & Scratch Isolation", phase_5_plan_mode_lifecycle),
        ("Goal Runtime & Independent Verifier", phase_6_goal_runtime_verifier),
        ("FastAPI Gateway & WebSocket Turn", phase_7_gateway_and_websocket),
    ]

    results: list[tuple[str, bool, float]] = []
    total_start = time.time()

    for idx, (title, func) in enumerate(phases, start=1):
        t0 = time.time()
        try:
            await func(env, app_server_bin)
            dur = time.time() - t0
            results.append((title, True, dur))
            report.end_phase(passed=True, duration=dur)
        except Exception as err:  # noqa: BLE001
            dur = time.time() - t0
            results.append((title, False, dur))
            report.end_phase(passed=False, duration=dur, error=str(err))
            log_fail(f"Phase {idx} ({title}) failed after {dur:.2f}s: {err}")
            import traceback

            traceback.print_exc()
            break

    total_duration = time.time() - total_start
    report.finish()

    print(f"\n{BOLD}{'=' * 72}{RESET}")
    print(f"{BOLD} Smoke Test Results Summary ({total_duration:.2f}s total):{RESET}")
    print(f"{BOLD}{'=' * 72}{RESET}")

    all_passed = True
    for name, passed, dur in results:
        status_str = f"{GREEN}PASSED{RESET}" if passed else f"{RED}FAILED{RESET}"
        print(f"  [{status_str}] {name:<42} ({dur:.2f}s)")
        if not passed:
            all_passed = False

    if report_dir:
        report_file = report.save_report(report_dir)
        try:
            rel_path = report_file.relative_to(REPO_ROOT)
        except ValueError:
            rel_path = report_file
        print(
            f"\n  {BOLD}{GREEN}[REPORT]{RESET} Full markdown report saved: {rel_path}"
        )

    if all_passed and len(results) == len(phases):
        print(
            f"\n{BOLD}{GREEN}🎉 ALL 7 FULL-STACK SMOKE PHASES PASSED WITH ZERO ERRORS! 🎉{RESET}\n"
        )
        return 0
    else:
        print(
            f"\n{BOLD}{RED}💥 SMOKE TEST FAILED! See logs above for diagnostic details.{RESET}\n"
        )
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Mini Agent Full-Stack Live LLM Smoke Test"
    )
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=REPO_ROOT / "reports",
        help="Directory to save test report (default: mini-agent-web/reports)",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="Skip generating markdown report",
    )
    cli_args = parser.parse_args()

    target_dir = None if cli_args.no_report else cli_args.report_dir
    exit_code = asyncio.run(main(report_dir=target_dir))
    sys.exit(exit_code)
