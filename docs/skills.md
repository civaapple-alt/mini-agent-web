# Skills integration

WebStudio ships the ChatGPT-compatible `pstack` skill group and exposes it as
Mini Agent builtin skills. The App Server owns discovery and activation. The
Gateway and Web Studio consume the resulting capability manifest.

## Built-in skill installation

At Gateway startup, WebStudio reads
`resources/builtin-skills/pstack` and synchronizes the 26 `SKILL.md` files to
`%USERPROFILE%/.mini-agent/skills/builtin/pstack`. The synchronizer writes a
version marker and source hash. If both values match, it leaves the installed
directory unchanged. A changed resource set is copied to a staging directory
and switched into place atomically.

The first release includes skill bodies and metadata only. It does not install
the `pstack` plugin's MCP servers, hooks, commands, or Cursor-specific features.

## Project settings

Each Project stores the enabled builtin groups in `builtin_skill_groups`:

```json
{
  "builtin_skill_groups": ["pstack"]
}
```

New Projects enable `pstack`. An empty list disables all builtin groups for that
Project. Changing the list while a Turn or approval is active returns HTTP 409.
After the change, the Gateway restarts only that Project's runtime and reads a
new capability manifest.

## Skill catalog

Use the following endpoint to read the current Project catalog:

```text
GET /api/skills?project_id=<project-id>
```

The response is derived from the selected runtime's latest `initialize` result:

```json
{
  "projectId": "project-id",
  "builtinSkillGroups": [
    {"id": "pstack", "version": "0.2.0", "enabled": true}
  ],
  "skills": [
    {
      "name": "architect",
      "description": "Design types, interfaces, and module boundaries.",
      "source": "builtin",
      "group": "pstack",
      "enabled": true
    }
  ]
}
```

The endpoint returns at most 64 skills and does not expose physical paths or
skill bodies. The Gateway does not scan skill directories for the frontend.

## Explicit activation

The input parser recognizes `$skill-name` at the start of a token. It removes
recognized tokens from the user prompt and sends their names in
`selectedSkills`:

```json
{
  "prompt": "重构这个模块",
  "selectedSkills": ["architect", "typescript-best-practices"]
}
```

The parser preserves `\$architect` as ordinary text, removes duplicate names
in first-seen order, and rejects unknown or disabled names before submission.
Each Turn accepts at most eight skills. The Host remains authoritative and
performs the same validation even when a client sends a request directly.

Skill bodies are loaded for the current Turn only. The Host reads them from a
trusted effective directory, applies the existing per-file bound, and limits
the combined activated body to 32 KiB. A failed read or validation emits a
failure event and prevents model execution.

## Events and replay

The App Server emits one structured event after `turn_started` and before
`run_started`:

```json
{
  "type": "skills_loaded",
  "skills": [
    {"name": "architect", "source": "builtin", "group": "pstack"}
  ]
}
```

Activation failures use `skills_load_failed` with a bounded `reason_code`. Both
events use the normal Thread, Turn, sequence, and item identity fields. The
Gateway forwards them through REST, SSE, and WebSocket event streams, and the
event replay path retains them. Web Studio renders a successful event as
`已加载技能：architect` and a failed event as a compact error block.

Normal metadata-first skill discovery does not emit `skills_loaded`. That event
means that the user explicitly activated a skill for the current Turn.
