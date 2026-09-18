from server import builtin_skills


def test_builtin_group_metadata_discovers_curated_groups():
    specs = {spec["id"]: spec for spec in builtin_skills._group_specs()}

    assert specs["pstack"]["version"] == "0.2.0"
    assert specs["knowledge-work"]["version"] == "0.1.0"
    assert specs["knowledge-work"]["source_commit"]

    root = builtin_skills._resource_root()
    assert sorted(path.name for path in root.iterdir() if path.is_dir()) == [
        "knowledge-work",
        "pstack",
    ]
    assert len(list((root / "knowledge-work").rglob("SKILL.md"))) == 3


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
        "knowledge-work",
        "pstack",
    }

    pstack_before = (target_root / "pstack" / "SKILL.md").read_text(encoding="utf-8")
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
