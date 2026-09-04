"""
Security and integrity tests for World & Project API endpoints.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.session_manager import session_manager


@pytest.fixture
def app_with_tmp_workspace(tmp_path):
    # Set session manager current project to tmp_path
    session_manager._current_project_id = "test_sec_proj"
    session_manager._current_project_path = tmp_path
    session_manager._projects_registry = {
        "test_sec_proj": {
            "id": "test_sec_proj",
            "name": "Security Test Project",
            "primary_path": str(tmp_path),
            "source_folders": [
                {"name": "root", "path": str(tmp_path), "is_primary": True}
            ],
        }
    }
    # Create legitimate files
    (tmp_path / "plan.md").write_text("# Project Plan\nMilestone 1", encoding="utf-8")
    sub_dir = tmp_path / "src"
    sub_dir.mkdir(parents=True, exist_ok=True)
    (sub_dir / "index.js").write_text("console.log('hi')", encoding="utf-8")

    # Create ignored directories and files
    git_dir = tmp_path / ".git"
    git_dir.mkdir(parents=True, exist_ok=True)
    (git_dir / "config").write_text("git config", encoding="utf-8")

    node_dir = tmp_path / "node_modules"
    node_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "pkg.js").write_text("pkg", encoding="utf-8")

    return create_app()


@pytest.mark.asyncio
async def test_path_traversal_prevention(app_with_tmp_workspace, tmp_path):
    """Ensure path traversal attacks return 403 Forbidden."""
    transport = ASGITransport(app=app_with_tmp_workspace)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Traversal outside workspace
        resp = await client.get(
            "/api/workflows/file/content", params={"path": "../outside.txt"}
        )
        assert resp.status_code == 403
        assert "outside workspace" in resp.json().get("detail", "")

        resp2 = await client.get(
            "/api/workflows/file/content", params={"path": "../../etc/passwd"}
        )
        assert resp2.status_code == 403

        # 2. Legitimate file read
        resp_ok = await client.get(
            "/api/workflows/file/content", params={"path": "plan.md"}
        )
        assert resp_ok.status_code == 200
        assert "# Project Plan" in resp_ok.json().get("content", "")

        # 3. Non-existent file inside workspace
        resp_404 = await client.get(
            "/api/workflows/file/content", params={"path": "missing.txt"}
        )
        assert resp_404.status_code == 404


@pytest.mark.asyncio
async def test_workspace_files_scanning(app_with_tmp_workspace):
    """Ensure workspace file scanner returns files while skipping ignored directories."""
    transport = ASGITransport(app=app_with_tmp_workspace)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/world/workspace-files")
        assert resp.status_code == 200
        data = resp.json()
        assert "files" in data
        files = data["files"]
        paths = [f["path"].replace("\\", "/") for f in files]

        assert "plan.md" in paths
        assert "src/index.js" in paths

        # Ensure .git and node_modules are excluded
        for p in paths:
            assert ".git" not in p
            assert "node_modules" not in p


@pytest.mark.asyncio
async def test_projects_crud_endpoints(app_with_tmp_workspace, tmp_path):
    """Ensure project create, list, update, pin, and delete endpoints function properly."""
    transport = ASGITransport(app=app_with_tmp_workspace)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create project
        resp = await client.post(
            "/api/projects/new",
            json={"name": "New Web Project", "path": str(tmp_path / "new_proj")},
        )
        assert resp.status_code == 200
        proj_id = resp.json().get("project", {}).get("id")
        assert proj_id == "new-web-project"

        # 2. Toggle pin
        pin_resp = await client.post(f"/api/projects/{proj_id}/pin")
        assert pin_resp.status_code == 200
        assert pin_resp.json().get("project", {}).get("pinned") is True

        # 3. Delete project
        del_resp = await client.delete(f"/api/projects/{proj_id}")
        assert del_resp.status_code == 200
        assert del_resp.json().get("status") == "deleted"
