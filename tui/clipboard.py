"""
Cross-platform system clipboard integration for Mini Agent TUI.
"""

from __future__ import annotations

import shutil
import subprocess
import sys


def copy_to_clipboard(text: str) -> bool:
    """
    Copy a given string into the system clipboard across Windows, macOS, and Linux.
    Returns True if successfully copied, False otherwise.
    """
    if not text:
        return False

    # 1. Try pyperclip if installed
    try:
        import pyperclip  # type: ignore[import-untyped]

        pyperclip.copy(text)
        return True
    except Exception:  # noqa: BLE001, S110
        pass

    # 2. Windows platform
    if sys.platform == "win32":
        # A. Try PowerShell Set-Clipboard (handles UTF-8 and multiline markdown cleanly)
        ps_exe = shutil.which("pwsh") or shutil.which("powershell")
        if ps_exe:
            try:
                proc = subprocess.run(
                    [ps_exe, "-NoProfile", "-Command", "$input | Set-Clipboard"],
                    input=text.encode("utf-8"),
                    capture_output=True,
                    check=False,
                )
                if proc.returncode == 0:
                    return True
            except Exception:  # noqa: BLE001, S110
                pass

        # B. Fallback to clip.exe
        try:
            proc = subprocess.run(
                ["clip"],
                input=text.encode("utf-16"),
                capture_output=True,
                check=False,
            )
            if proc.returncode == 0:
                return True
        except Exception:  # noqa: BLE001, S110
            pass

    # 3. macOS platform
    elif sys.platform == "darwin":
        if shutil.which("pbcopy"):
            try:
                proc = subprocess.run(
                    ["pbcopy"],
                    input=text.encode("utf-8"),
                    capture_output=True,
                    check=False,
                )
                if proc.returncode == 0:
                    return True
            except Exception:  # noqa: BLE001, S110
                pass

    # 4. Linux / Wayland / X11 platform
    else:
        candidates = [
            ("wl-copy", []),
            ("xclip", ["-selection", "clipboard"]),
            ("xsel", ["--clipboard", "--input"]),
        ]
        for tool, args in candidates:
            if shutil.which(tool):
                try:
                    proc = subprocess.run(
                        [tool, *args],
                        input=text.encode("utf-8"),
                        capture_output=True,
                        check=False,
                    )
                    if proc.returncode == 0:
                        return True
                except Exception:  # noqa: BLE001, S110
                    pass

    return False
