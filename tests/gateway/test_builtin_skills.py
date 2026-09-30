import json
import re

from server import builtin_skills


def test_builtin_group_metadata_discovers_bundled_groups():
    specs = {spec["id"]: spec for spec in builtin_skills._group_specs()}

    assert specs["pstack"]["version"] == "0.2.0"
    assert specs["knowledge-work"]["version"] == "0.1.0"
    assert specs["knowledge-work"]["source_commit"]
    assert specs["code-review"]["version"] == "0.1.0"

    root = builtin_skills._resource_root()
    assert sorted(path.name for path in root.iterdir() if path.is_dir()) == [
        "code-review",
        "knowledge-work",
        "pstack",
    ]
    assert len(list((root / "knowledge-work").rglob("SKILL.md"))) == 3


def test_code_review_group_has_five_well_named_skills_and_bounded_local_workflow():
    root = builtin_skills._resource_group("code-review")
    expected_names = {
        "code-review",
        "code-review-breaking-changes",
        "code-review-change-size",
        "code-review-context",
        "code-review-testing",
    }
    skill_paths = sorted(root.glob("*/SKILL.md"))

    assert json.loads(
        (root / builtin_skills.GROUP_METADATA_NAME).read_text(encoding="utf-8")
    ) == {"id": "code-review", "version": "0.1.0"}
    assert {path.parent.name for path in skill_paths} == expected_names
    assert len(skill_paths) == len(expected_names)
    total_bytes = 0
    skill_bodies = {}
    for path in skill_paths:
        content = path.read_text(encoding="utf-8")
        total_bytes += len(content.encode("utf-8"))
        frontmatter = content.split("---", 2)[1]
        declared_name = re.search(r"(?m)^name:\s*(.+)$", frontmatter)
        assert declared_name is not None
        assert declared_name.group(1) == path.parent.name
        skill_bodies[path.parent.name] = content
    assert total_bytes < 32 * 1024

    orchestrator = skill_bodies["code-review"]
    for scope in ("whole-repository", "starting commit", "current working tree"):
        assert scope in orchestrator
    assert "ask whether to review the whole repository" in orchestrator
    for case in (
        "staged changes, unstaged changes, and untracked files relative to HEAD",
        "exclusive base. Inspect changes introduced after it through current HEAD",
        "If the user did not name a scope",
        "If delegate_task is unavailable",
        "run the checks sequentially",
        "If a child fails or cannot return a result",
        "execution_mode set to parallel",
        "call task_list with limit 4",
        "call task_read once",
        "operation.status",
        "matching turn_outcome",
        "reports are progress updates, not the final answer",
        "wait for its wake-up",
        "claim coverage for a specialty without its settled result",
        "Return every distinct actionable finding",
    ):
        assert case in orchestrator
    assert "Do not contact GitHub" in orchestrator
    assert "delegate_task" in orchestrator
    assert "task_list" in orchestrator
    assert "task_read" in orchestrator
    for specialty in sorted(expected_names - {"code-review"}):
        assert specialty in orchestrator
    assert "name the incomplete specialty" in orchestrator
    specialist_requirements = {
        "code-review-breaking-changes": "Public APIs, protocol messages",
        "code-review-change-size": "800 total changed lines",
        "code-review-context": "existing conversation history is not rewritten",
        "code-review-testing": "bounded scenario with a mock model or fixture",
    }
    for specialty, requirement in specialist_requirements.items():
        assert requirement in skill_bodies[specialty]


def test_code_review_resource_sync_installs_once_without_touching_user_home(
    tmp_path, monkeypatch
):
    target_root = tmp_path / "builtin"
    monkeypatch.setattr(
        builtin_skills, "_target_group", lambda group_id: target_root / group_id
    )

    first = builtin_skills.sync_builtin_skills()
    second = builtin_skills.sync_builtin_skills()

    assert first["changed"] is True
    assert second["changed"] is False
    installed = target_root / "code-review"
    assert sorted(path.parent.name for path in installed.glob("*/SKILL.md")) == [
        "code-review",
        "code-review-breaking-changes",
        "code-review-change-size",
        "code-review-context",
        "code-review-testing",
    ]


def test_builtin_skill_sync_is_idempotent_and_replaces_changed_content(
    tmp_path, monkeypatch
):
    source = tmp_path / "source"
    source.mkdir()
    (source / "architect").mkdir()
    (source / "architect" / "SKILL.md").write_text(
        "---\nname: architect\ndescription: Design systems.\n---\nfirst\n",
        encoding="utf-8",
    )
    target = tmp_path / "home" / ".mini-agent" / "skills" / "builtin" / "pstack"
    spec = {"id": "pstack", "version": "0.2.0", "source_commit": None}
    monkeypatch.setattr(builtin_skills, "_group_specs", lambda: [spec])
    monkeypatch.setattr(builtin_skills, "_resource_group", lambda group_id: source)
    monkeypatch.setattr(builtin_skills, "_target_group", lambda group_id: target)

    first = builtin_skills.sync_builtin_skills()
    second = builtin_skills.sync_builtin_skills()
    assert first["groups"] == [
        {"group": "pstack", "version": "0.2.0", "source_commit": None, "changed": True}
    ]
    assert second["groups"] == [
        {"group": "pstack", "version": "0.2.0", "source_commit": None, "changed": False}
    ]
    assert (
        (target / "architect" / "SKILL.md")
        .read_text(encoding="utf-8")
        .endswith("first\n")
    )

    (source / "architect" / "SKILL.md").write_text(
        "---\nname: architect\ndescription: Design systems.\n---\nsecond\n",
        encoding="utf-8",
    )
    changed = builtin_skills.sync_builtin_skills()
    assert changed["changed"] is True
    assert (
        (target / "architect" / "SKILL.md")
        .read_text(encoding="utf-8")
        .endswith("second\n")
    )
    marker = (target / builtin_skills.MARKER_NAME).read_text(encoding="utf-8")
    assert '"version": "0.2.0"' in marker


def test_builtin_skill_groups_sync_independently(tmp_path, monkeypatch):
    source_root = tmp_path / "resources"
    target_root = tmp_path / "home" / ".mini-agent" / "skills" / "builtin"
    specs = [
        {"id": "code-review", "version": "0.1.0", "source_commit": None},
        {"id": "knowledge-work", "version": "0.1.0", "source_commit": "abc123"},
        {"id": "pstack", "version": "0.2.0", "source_commit": None},
    ]
    for spec in specs:
        source = source_root / spec["id"]
        source.mkdir(parents=True)
        (source / "SKILL.md").write_text(f"{spec['id']}\n", encoding="utf-8")

    monkeypatch.setattr(builtin_skills, "_group_specs", lambda: specs)
    monkeypatch.setattr(
        builtin_skills,
        "_resource_group",
        lambda group_id: source_root / group_id,
    )
    monkeypatch.setattr(
        builtin_skills,
        "_target_group",
        lambda group_id: target_root / group_id,
    )

    first = builtin_skills.sync_builtin_skills()
    assert first["changed"] is True
    assert {group["group"] for group in first["groups"]} == {
        "code-review",
        "knowledge-work",
        "pstack",
    }

    pstack_before = (target_root / "pstack" / "SKILL.md").read_text(encoding="utf-8")
    code_review_before = (target_root / "code-review" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    (source_root / "knowledge-work" / "SKILL.md").write_text(
        "knowledge-work changed\n", encoding="utf-8"
    )
    second = builtin_skills.sync_builtin_skills()
    assert second["changed"] is True
    assert (target_root / "pstack" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == pstack_before
    assert (target_root / "knowledge-work" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "knowledge-work changed\n"
    assert (target_root / "code-review" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == code_review_before

    (source_root / "code-review" / "SKILL.md").write_text(
        "code-review changed\n", encoding="utf-8"
    )
    third = builtin_skills.sync_builtin_skills()
    assert third["changed"] is True
    assert (target_root / "code-review" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "code-review changed\n"
    assert (target_root / "knowledge-work" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "knowledge-work changed\n"
