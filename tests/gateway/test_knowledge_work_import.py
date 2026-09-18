import importlib.util
import os
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def importer():
    path = Path(__file__).parents[2] / "scripts" / "import_knowledge_work.py"
    spec = importlib.util.spec_from_file_location("import_knowledge_work", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git(source: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(source), *args],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def _source_repo(tmp_path: Path, importer, *, include_licenses: bool = True) -> Path:
    source = tmp_path / "knowledge-work-source"
    source.mkdir()
    (source / "LICENSE").write_text("Apache License 2.0\n", encoding="utf-8")
    for role_id, role in importer.ROLE_SPECS.items():
        role_root = source / role_id
        for relative in role["references"].values():
            reference = (
                role_root / "skills" / Path(relative).relative_to(f"{role_id}/skills")
            )
            reference.parent.mkdir(parents=True, exist_ok=True)
            reference.write_text(
                "---\nname: fixture\ndescription: Fixture reference.\n---\nfixture\n",
                encoding="utf-8",
            )
        if include_licenses:
            (role_root / "LICENSE").write_text("Apache License 2.0\n", encoding="utf-8")

    _git(source, "init")
    _git(source, "add", ".")
    env = os.environ.copy()
    env.update(
        {
            "GIT_AUTHOR_NAME": "Knowledge Work Test",
            "GIT_AUTHOR_EMAIL": "knowledge-work-test@example.invalid",
            "GIT_COMMITTER_NAME": "Knowledge Work Test",
            "GIT_COMMITTER_EMAIL": "knowledge-work-test@example.invalid",
        }
    )
    subprocess.run(
        ["git", "-C", str(source), "commit", "-m", "fixture"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    return source


def test_importer_is_pinned_and_idempotent(tmp_path, importer):
    source = _source_repo(tmp_path, importer)
    destination = tmp_path / "resources" / "knowledge-work"
    commit = _git(source, "rev-parse", "HEAD")

    first = importer.generate(source, destination, expected_commit=commit)
    first_hashes = {
        path.relative_to(destination): importer._sha256(path)
        for path in destination.rglob("*")
        if path.is_file()
    }
    second = importer.generate(source, destination, expected_commit=commit)
    second_hashes = {
        path.relative_to(destination): importer._sha256(path)
        for path in destination.rglob("*")
        if path.is_file()
    }

    assert first["commit"] == commit
    assert second["commit"] == commit
    assert first_hashes == second_hashes
    metadata = (destination / importer.GROUP_METADATA_NAME).read_text(encoding="utf-8")
    assert commit in metadata
    assert '"license_checks"' in metadata
    assert not list(destination.rglob(".mcp.json"))


def test_importer_rejects_dirty_source_before_generation(tmp_path, importer):
    source = _source_repo(tmp_path, importer)
    (source / "productivity" / "LICENSE").write_text("changed\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="uncommitted changes"):
        importer.generate(source, tmp_path / "resources" / "knowledge-work")


def test_importer_rejects_missing_role_license(tmp_path, importer):
    source = _source_repo(tmp_path, importer, include_licenses=False)

    with pytest.raises(RuntimeError, match="LICENSE is missing"):
        importer.generate(source, tmp_path / "resources" / "knowledge-work")
