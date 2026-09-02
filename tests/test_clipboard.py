"""
Unit tests for cross-platform clipboard copy utility.
"""

from unittest.mock import MagicMock

from tui.clipboard import copy_to_clipboard


def test_copy_to_clipboard_empty_text():
    """Ensure empty text returns False immediately."""
    assert copy_to_clipboard("") is False
    assert copy_to_clipboard(None) is False


def test_copy_to_clipboard_windows_powershell(monkeypatch):
    """Test Windows PowerShell Set-Clipboard execution flow."""
    monkeypatch.setattr("sys.platform", "win32")
    monkeypatch.setattr(
        "shutil.which",
        lambda cmd: (
            "C:\\Windows\\System32\\powershell.exe" if "powershell" in cmd else None
        ),
    )

    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    monkeypatch.setattr("subprocess.run", mock_run)

    success = copy_to_clipboard("Test Markdown Output")
    assert success is True
    assert mock_run.called
    called_cmd = mock_run.call_args[0][0]
    assert "Set-Clipboard" in " ".join(called_cmd)


def test_copy_to_clipboard_macos_pbcopy(monkeypatch):
    """Test macOS pbcopy fallback flow."""
    monkeypatch.setattr("sys.platform", "darwin")
    monkeypatch.setattr(
        "shutil.which", lambda cmd: "/usr/bin/pbcopy" if cmd == "pbcopy" else None
    )

    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    monkeypatch.setattr("subprocess.run", mock_run)

    success = copy_to_clipboard("Mac OS Test")
    assert success is True
    assert mock_run.called
    called_cmd = mock_run.call_args[0][0]
    assert "pbcopy" in called_cmd


def test_copy_to_clipboard_linux_wl_copy(monkeypatch):
    """Test Linux Wayland wl-copy flow."""
    monkeypatch.setattr("sys.platform", "linux")
    monkeypatch.setattr(
        "shutil.which", lambda cmd: "/usr/bin/wl-copy" if cmd == "wl-copy" else None
    )

    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    monkeypatch.setattr("subprocess.run", mock_run)

    success = copy_to_clipboard("Linux Wayland Test")
    assert success is True
    assert mock_run.called
    called_cmd = mock_run.call_args[0][0]
    assert "wl-copy" in called_cmd
