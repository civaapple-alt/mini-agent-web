"""Run the App Server's bounded Session diagnostic maintenance commands."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from server.session_manager import session_manager

MAX_DOCTOR_OUTPUT_BYTES = 1024 * 1024
DOCTOR_TIMEOUT_SECONDS = 60
MAX_DOCTOR_FINDINGS = 256


class SessionDoctorError(RuntimeError):
    def __init__(self, status_code: int, public_message: str) -> None:
        super().__init__(public_message)
        self.status_code = status_code
        self.public_message = public_message


def inspect_project_sessions(project_id: str) -> dict[str, Any]:
    workspace = _project_workspace(project_id)
    payload = _run_doctor(workspace, ["doctor", "--json"])
    _validate_report(payload)
    return payload


def repair_project_session(project_id: str, session_id: str) -> dict[str, Any]:
    if (
        not session_id
        or len(session_id) > 64
        or not all(
            char.isascii() and (char.isalnum() or char in "-_") for char in session_id
        )
    ):
        raise SessionDoctorError(400, "Session ID 格式无效")
    workspace = _project_workspace(project_id)
    payload = _run_doctor(
        workspace,
        ["doctor", "repair", "--session-id", session_id, "--json"],
    )
    if not isinstance(payload, dict) or payload.get("session_id") != session_id:
        raise SessionDoctorError(502, "Session 修复进程返回了无效结果")
    backup_path = payload.get("backup_path")
    if not isinstance(backup_path, str) or not _is_recovery_backup_path(backup_path):
        raise SessionDoctorError(502, "Session 修复结果缺少有效备份位置")
    finding = payload.get("finding")
    if not isinstance(finding, dict) or finding.get("session_id") != session_id:
        raise SessionDoctorError(502, "Session 修复进程返回了无效诊断结果")
    return payload


def _project_workspace(project_id: str) -> Path:
    try:
        workspace = session_manager.project_primary_path(project_id)
    except KeyError as error:
        raise SessionDoctorError(404, "项目不存在") from error
    if not workspace.is_dir():
        raise SessionDoctorError(404, "项目主工作区不可用")
    return workspace


def _run_doctor(workspace: Path, args: list[str]) -> dict[str, Any]:
    executable = _app_server_executable()
    try:
        result = subprocess.run(
            [executable, *args],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=DOCTOR_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise SessionDoctorError(504, "Session 检查超时，请稍后重试") from error
    except FileNotFoundError as error:
        raise SessionDoctorError(
            503, "找不到 mini-agent-app-server 可执行文件"
        ) from error
    except OSError as error:
        raise SessionDoctorError(503, "无法启动 Session 检查进程") from error
    stdout = result.stdout or ""
    if len(stdout.encode("utf-8")) > MAX_DOCTOR_OUTPUT_BYTES:
        raise SessionDoctorError(502, "Session 检查报告超过大小限制")
    if result.returncode != 0:
        raise SessionDoctorError(502, "Session 检查进程执行失败")
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise SessionDoctorError(502, "Session 检查进程返回了无效 JSON") from error
    if not isinstance(payload, dict):
        raise SessionDoctorError(502, "Session 检查进程返回了无效报告")
    return payload


def _app_server_executable() -> str:
    configured = os.environ.get("MINI_AGENT_APP_SERVER_PATH")
    if configured:
        if os.path.isabs(configured):
            return configured
        resolved = shutil.which(configured)
    else:
        resolved = shutil.which("mini-agent-app-server")
    if not resolved:
        raise SessionDoctorError(503, "找不到 mini-agent-app-server 可执行文件")
    return resolved


def _validate_report(payload: dict[str, Any]) -> None:
    counts = payload.get("counts")
    findings = payload.get("findings")
    if (
        payload.get("schema_version") != 1
        or not isinstance(payload.get("scanned_sessions"), int)
        or isinstance(payload.get("scanned_sessions"), bool)
        or not isinstance(counts, dict)
        or not isinstance(findings, list)
        or len(findings) > MAX_DOCTOR_FINDINGS
    ):
        raise SessionDoctorError(502, "Session 检查报告格式不受支持")
    if not all(
        isinstance(finding, dict)
        and isinstance(finding.get("session_id"), str)
        and isinstance(finding.get("issue_code"), str)
        and isinstance(finding.get("recommendation"), str)
        and isinstance(finding.get("repair_available"), bool)
        for finding in findings
    ):
        raise SessionDoctorError(502, "Session 检查报告包含无效记录")


def _is_recovery_backup_path(value: str) -> bool:
    posix_path = PurePosixPath(value)
    windows_path = PureWindowsPath(value)
    return (
        not posix_path.is_absolute()
        and not windows_path.is_absolute()
        and windows_path.drive == ""
        and posix_path.parts[:1] == ("recovery-backups",)
        and ".." not in posix_path.parts
    )
