from server import builtin_skills


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
    monkeypatch.setattr(builtin_skills, "_resource_group", lambda: source)
    monkeypatch.setattr(builtin_skills, "_target_group", lambda: target)

    first = builtin_skills.sync_builtin_skills()
    second = builtin_skills.sync_builtin_skills()
    assert first["changed"] is True
    assert second["changed"] is False
    assert (target / "architect" / "SKILL.md").read_text(encoding="utf-8").endswith(
        "first\n"
    )

    (source / "architect" / "SKILL.md").write_text(
        "---\nname: architect\ndescription: Design systems.\n---\nsecond\n",
        encoding="utf-8",
    )
    changed = builtin_skills.sync_builtin_skills()
    assert changed["changed"] is True
    assert (target / "architect" / "SKILL.md").read_text(encoding="utf-8").endswith(
        "second\n"
    )
    marker = (target / builtin_skills.MARKER_NAME).read_text(encoding="utf-8")
    assert builtin_skills.BUILTIN_VERSION in marker
