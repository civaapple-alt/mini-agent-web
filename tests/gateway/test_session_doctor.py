"""Project Session diagnostics route and maintenance-process boundaries."""

import json
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.control.project_registry import ProjectRegistry
from server.session_doctor import SessionDoctorError, inspect_project_sessions
from server.session_manager import session_manager


def diagnostic_report() -> dict:
    return {
        "schema_version": 1,
        "scanned_sessions": 1,
        "sessions_truncated": False,
        "findings_truncated": False,
        "counts": {
            "inspection": {"inspected": 1, "locked_unverified": 0, "unreadable": 0},
            "integrity": {
                "complete": 0,
                "history_incomplete": 1,
                "invalid": 0,
                "unknown": 0,
            },
            "recovery": {"resumable": 1, "unavailable": 0, "unknown": 0},
            "repairable_tails": 1,
        },
        "findings": [
            {
                "session_id": "s-1",
                "issue_code": "incomplete_tail",
                "inspection": "inspected",
                "integrity": "history_incomplete",
                "recovery": "resumable",
                "incomplete_tail": True,
                "repair_available": True,
                "recommendation": "先备份，再截去不完整尾部。",
            }
        ],
    }


@pytest.mark.asyncio
async def test_project_session_doctor_uses_registered_workspace_and_app_server(
    tmp_path, monkeypatch
):
    calls = []
    monkeypatch.setenv("MINI_AGENT_APP_SERVER_PATH", "/opt/mini-agent-app-server")
    monkeypatch.setattr(
        session_manager,
        "_project_registry",
        ProjectRegistry(
            SimpleNamespace(
                _projects_registry={
                    "project-1": {"primary_path": str(tmp_path)},
                }
            )
        ),
    )

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps(diagnostic_report()),
            stderr="",
        )

    monkeypatch.setattr("server.session_doctor.subprocess.run", run)
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/threads/project/project-1/sessions/doctor")

    assert response.status_code == 200
    assert response.json() == diagnostic_report()
    assert calls[0][0] == [
        "/opt/mini-agent-app-server",
        "doctor",
        "--json",
    ]
    assert calls[0][1]["cwd"] == tmp_path
    assert calls[0][1]["timeout"] == 60
    assert "shell" not in calls[0][1]


@pytest.mark.asyncio
async def test_repair_route_only_accepts_bounded_session_identity(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("MINI_AGENT_APP_SERVER_PATH", "/opt/mini-agent-app-server")
    monkeypatch.setattr(
        session_manager,
        "_project_registry",
        ProjectRegistry(
            SimpleNamespace(
                _projects_registry={
                    "project-1": {"primary_path": str(tmp_path)},
                }
            )
        ),
    )
    calls = []
    finding = diagnostic_report()["findings"][0]
    repair_result = {
        "session_id": "s-1",
        "backup_path": "recovery-backups/workspace/s-1/backup.jsonl",
        "finding": {**finding, "issue_code": "healthy", "repair_available": False},
    }

    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(
            returncode=0, stdout=json.dumps(repair_result), stderr=""
        )

    monkeypatch.setattr("server.session_doctor.subprocess.run", run)
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        repaired = await client.post(
            "/api/threads/project/project-1/sessions/s-1/doctor/repair"
        )
        invalid = await client.post(
            "/api/threads/project/project-1/sessions/s-1%3Btouch%20bad/doctor/repair"
        )

    assert repaired.status_code == 200
    assert repaired.json() == repair_result
    assert invalid.status_code == 400
    assert calls == [
        [
            "/opt/mini-agent-app-server",
            "doctor",
            "repair",
            "--session-id",
            "s-1",
            "--json",
        ]
    ]


def test_unregistered_project_is_not_resolved_to_active_project(monkeypatch):
    monkeypatch.setattr(
        session_manager,
        "_project_registry",
        ProjectRegistry(
            SimpleNamespace(
                _projects_registry={"broken": {"primary_path": " "}},
            )
        ),
    )
    with pytest.raises(SessionDoctorError) as error:
        inspect_project_sessions("unregistered")
    assert error.value.status_code == 404
    with pytest.raises(SessionDoctorError) as error:
        inspect_project_sessions("broken")
    assert error.value.status_code == 404
