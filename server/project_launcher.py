"""Allowlisted desktop application launchers for registered Project workspaces."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LaunchTarget:
    target_id: str
    label: str
    command: tuple[str, ...] | None
    creationflags: int = 0

    @property
    def available(self) -> bool:
        return self.command is not None


def _which(*names: str) -> str | None:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def _mac_application(*names: str) -> str | None:
    candidates = [Path("/Applications") / name for name in names] + [
        Path.home() / "Applications" / name for name in names
    ]
    return next((str(path) for path in candidates if path.is_dir()), None)


def _windows_idea() -> str | None:
    direct = _which("idea64.exe", "idea.exe")
    if direct:
        return direct
    launcher = _which("idea.bat", "idea.cmd")
    if launcher:
        bin_dir = Path(launcher).resolve().parent
        executable = next(
            (
                bin_dir / name
                for name in ("idea64.exe", "idea.exe")
                if (bin_dir / name).is_file()
            ),
            None,
        )
        if executable:
            return str(executable)
    local_app_data = Path(
        os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local"
    )
    roots = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "JetBrains",
        local_app_data / "Programs",
    ]
    candidates = [
        path
        for root in roots
        if root.is_dir()
        for pattern in ("IntelliJ IDEA*/bin/idea64.exe", "IntelliJ IDEA*/bin/idea.exe")
        for path in root.glob(pattern)
    ]
    toolbox = local_app_data / "JetBrains/Toolbox/apps/IDEA-U/ch-0"
    if toolbox.is_dir():
        candidates.extend(toolbox.glob("*/bin/idea64.exe"))
    return str(candidates[0]) if candidates else None


def _targets() -> tuple[LaunchTarget, ...]:
    if sys.platform == "darwin":
        opener = _which("open") or (
            "/usr/bin/open" if Path("/usr/bin/open").is_file() else None
        )
        vscode = _which("code")
        if not vscode:
            app_path = _mac_application(
                "Visual Studio Code.app", "Visual Studio Code - Insiders.app"
            )
            vscode = ("/usr/bin/open", "-a", app_path) if app_path else None
        idea = _which("idea")
        if not idea:
            app_path = _mac_application("IntelliJ IDEA.app", "IntelliJ IDEA CE.app")
            idea = ("/usr/bin/open", "-a", app_path) if app_path else None
        terminal_script = (
            "on run argv\n"
            '  tell application "Terminal"\n'
            "    activate\n"
            '    do script "cd " & quoted form of (item 1 of argv)\n'
            "  end tell\n"
            "end run"
        )
        return (
            LaunchTarget("file_manager", "Finder", (opener,) if opener else None),
            LaunchTarget(
                "vscode", "VS Code", (vscode,) if isinstance(vscode, str) else vscode
            ),
            LaunchTarget(
                "intellij", "IntelliJ IDEA", (idea,) if isinstance(idea, str) else idea
            ),
            LaunchTarget(
                "terminal",
                "Terminal",
                ("/usr/bin/osascript", "-e", terminal_script)
                if Path("/usr/bin/osascript").is_file()
                else None,
            ),
        )

    if sys.platform == "win32":
        explorer = _which("explorer.exe") or str(
            Path(os.environ.get("WINDIR", r"C:\Windows")) / "explorer.exe"
        )
        if not Path(explorer).is_file():
            explorer = None
        vscode = _which("Code.exe", "code.exe")
        if not vscode:
            code_script = _which("code.cmd", "code.bat")
            if code_script:
                candidate = Path(code_script).resolve().parent.parent / "Code.exe"
                vscode = str(candidate) if candidate.is_file() else None
        if not vscode:
            local_app_data = Path(
                os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local"
            )
            candidates = [
                local_app_data / "Programs/Microsoft VS Code/Code.exe",
                Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
                / "Microsoft VS Code/Code.exe",
                Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
                / "Microsoft VS Code/Code.exe",
            ]
            vscode = next((str(path) for path in candidates if path.is_file()), None)
        idea = _windows_idea()
        terminal = _which("wt.exe")
        terminal_label = "Windows Terminal"
        terminal_flags = 0
        if not terminal:
            terminal = _which("powershell.exe", "pwsh.exe")
            terminal_label = "PowerShell"
            terminal_flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        return (
            LaunchTarget(
                "file_manager", "文件资源管理器", (explorer,) if explorer else None
            ),
            LaunchTarget("vscode", "VS Code", (vscode,) if vscode else None),
            LaunchTarget("intellij", "IntelliJ IDEA", (idea,) if idea else None),
            LaunchTarget(
                "terminal",
                terminal_label,
                (terminal,) if terminal else None,
                creationflags=terminal_flags,
            ),
        )

    file_manager = _which("xdg-open")
    vscode = _which("code", "code-insiders")
    idea = _which("idea", "idea64")
    terminal = _which(
        "gnome-terminal", "konsole", "xfce4-terminal", "kgx", "x-terminal-emulator"
    )
    return (
        LaunchTarget(
            "file_manager", "文件管理器", (file_manager,) if file_manager else None
        ),
        LaunchTarget("vscode", "VS Code", (vscode,) if vscode else None),
        LaunchTarget("intellij", "IntelliJ IDEA", (idea,) if idea else None),
        LaunchTarget("terminal", "终端", (terminal,) if terminal else None),
    )


def available_project_open_targets() -> dict[str, object]:
    """Return fixed target metadata without exposing executable paths."""
    return {
        "platform": sys.platform,
        "targets": [
            {
                "id": target.target_id,
                "label": target.label,
                "available": target.available,
            }
            for target in _targets()
        ],
    }


def open_project_in_target(target_id: str, project_path: Path) -> str:
    """Launch one allowlisted application with a trusted registered workspace path."""
    path = project_path.resolve(strict=True)
    if not path.is_dir():
        raise NotADirectoryError(str(path))
    target = next((item for item in _targets() if item.target_id == target_id), None)
    if target is None:
        raise ValueError(f"Unsupported project open target: {target_id}")
    if not target.command:
        raise FileNotFoundError(f"本机未检测到 {target.label}")

    command = target.command
    if sys.platform == "darwin" and target_id == "file_manager":
        args = [*command, str(path)]
    elif sys.platform == "darwin" and target_id in {"vscode", "intellij"}:
        executable = command[0]
        args = (
            [*command, str(path)]
            if executable == "/usr/bin/open"
            else [executable, str(path)]
        )
    elif sys.platform == "darwin" and target_id == "terminal":
        args = [*command, str(path)]
    elif (
        sys.platform == "win32"
        and target_id == "terminal"
        and target.label == "Windows Terminal"
    ):
        args = [*command, "-d", str(path)]
    elif sys.platform == "win32" and target_id == "terminal":
        args = command
    elif sys.platform.startswith("linux") and target_id == "terminal":
        executable_name = Path(command[0]).name
        if executable_name in {
            "gnome-terminal",
            "gnome-terminal.wrapper",
            "xfce4-terminal",
            "kgx",
        }:
            args = [*command, f"--working-directory={path}"]
        elif executable_name == "konsole":
            args = [*command, "--workdir", str(path)]
        else:
            args = command
    else:
        args = [*command, str(path)]

    subprocess.Popen(
        args,
        cwd=str(path),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        start_new_session=sys.platform != "win32",
        creationflags=target.creationflags,
    )
    return target.label
