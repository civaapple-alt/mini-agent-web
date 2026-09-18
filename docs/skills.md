# Skills integration

WebStudio ships the ChatGPT-compatible `pstack` group and the curated,
read-only `knowledge-work` group as Mini Agent builtin skills. The App Server
owns discovery and activation. The Gateway and Web Studio consume the
resulting capability manifest.

## Built-in skill installation

At Gateway startup, WebStudio discovers each group under
`resources/builtin-skills` and synchronizes it to
`%USERPROFILE%/.mini-agent/skills/builtin/<group>`. The current groups are
`pstack` and `knowledge-work`. Each group has an independent version marker,
source hash, and optional source commit. If the marker matches, the
synchronizer leaves that group unchanged. A changed group is copied to a
staging directory and switched into place atomically; another group is not
replaced when one group changes.

Builtin resources include skill bodies, metadata, and bounded references only.
They do not install MCP servers, hooks, commands, plugin manifests, or external
write actions.

## Project settings

Each Project stores the enabled builtin groups in `builtin_skill_groups`:

```json
{
  "builtin_skill_groups": ["pstack", "knowledge-work"]
}
```

New Projects enable only `pstack`. An empty list disables all builtin groups
for that Project. Changing the list while a Turn or approval is active returns
HTTP 409. After the change, the Gateway restarts only that Project's runtime
and reads a new capability manifest.

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
    {"id": "pstack", "version": "0.2.0", "enabled": true},
    {"id": "knowledge-work", "version": "0.1.0", "enabled": true}
  ],
  "skills": [
    {
      "name": "architect",
      "qualifiedName": "pstack:architect",
      "aliases": ["pstack-plugin:architect", "architect"],
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

## Skill panel

The WebStudio Skill tab renders the complete bounded catalog returned by the
runtime. It does not maintain a second group or Skill list. Each returned group
has its own status, activation labels, and Skill entries, so the panel remains
accurate when a builtin resource changes.

The panel distinguishes the two entry points for every enabled group:

| Panel label | Meaning | Body loading |
| --- | --- | --- |
| `+ <group> · 组内按需` | Turn-level workflow activation; the selected group becomes the candidate group and the model selects relevant Skills from metadata. | No bulk preload; relevant bodies are read on demand. |
| `$ 直接调用` | Skill-level activation; the user names one Skill such as `$knowledge-work:data`. | Host loads the selected body before model execution. |

All enabled groups can use both entry points. `+ <group>` is not a shortcut for
loading every body, and `$<group>:skill` is not a request to activate the whole
group. The panel's `$` insertion always uses the canonical qualified name;
compatibility aliases remain visible when provided by the manifest.

If a group is enabled but the catalog contains no Skill entry for it, the panel
shows a runtime-catalog warning and asks the user to refresh or restart the
Project runtime. It does not scan the builtin directory or invent metadata in
the browser.

## Explicit activation

The input parser recognizes `$skill-name` and `$group:skill-name` at the start
of a token. It removes recognized tokens from the user prompt and sends their
canonical names in
`selectedSkills`:

```json
{
  "prompt": "重构这个模块",
  "selectedSkills": ["pstack:architect", "pstack:typescript-best-practices"]
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

每个已启用 Skill 的根目录也是受信任的只读目录。模型可以在当前 Turn 中通过
现有 `read_file` 按需查看该目录下的 `references/`、`scripts/`、`assets/` 和其他
说明文件；发现阶段不会递归加载它们。Skill 目录的 `read_file` 输出合计最多
64 KiB，仍受分页、UTF-8 和路径边界限制。该授权仅用于读取，不会自动执行脚本，
也不会允许修改 Skill 文件；Shell 执行和文件写入继续使用 Host 的审批与沙箱规则。

## Input history

The WebStudio input-history tab joins the current checkpoint with the bounded
ThreadItem projection. This keeps older user inputs visible after checkpoint
compaction or projection limits while retaining the live message object when it
contains image or file attachment metadata. The UI reads at most the recent
256 projected items and follows the App Server cursor when more than one page
is available.

Persisted item timestamps are projected as `capturedAt` and are shown when the
Session record contains a valid timestamp. Legacy records without one simply
omit the time; they do not display a misleading "history time not recorded"
warning. Gateway-generated attachment context is removed from the displayed
prompt, and image markers are shown as a bounded image count. Raw image bytes
are not copied into the history projection. Live and queued inputs retain their
image data, while a historical reload only exposes attachment metadata that
was persisted by the runtime.

## Events and replay

For explicit `selectedSkills`, the App Server emits `skills_loaded` with
`phase: "started"` and then `phase: "loaded"` after `turn_started` and before
`run_started`:

```json
{
  "type": "skills_loaded",
  "phase": "loaded",
  "skills": [
    {"name": "architect", "qualifiedName": "pstack:architect", "source": "builtin", "group": "pstack"}
  ]
}
```

Activation failures use `skills_load_failed` with a bounded `reason_code`. Both
events use the normal Thread, Turn, sequence, and item identity fields. The
Gateway forwards them through REST, SSE, and WebSocket event streams, and the
event replay path retains them. Web Studio renders a successful event as
`已加载技能：architect` and a failed event as a compact error block.

Normal metadata-first discovery does not preload or emit an event. When the
model first reads an enabled Skill's `SKILL.md`, the App Server emits
`skills_loaded(phase: "started", activation: "on_demand")` before the read and
`skills_loaded(phase: "loaded")` after success. With `+ <group>`,
`skill_group_activated` is emitted before execution and the same on-demand
events identify the concrete Skills selected by the model. Reads of
`references/`, `scripts/`, `assets/`, and other files below an already loaded
Skill do not create additional Skill events. Legacy `skills_loaded` events
without `phase` are treated as `loaded`.

The runtime catalog also discovers direct user Skills from
`%USERPROFILE%/.mini-agent/skills` and `%USERPROFILE%/.agents/skills`, in
addition to project Skills and synchronized builtin groups. The fixed priority
is project, Agent Skills user, Mini Agent user, builtin, then plugin. Higher
priority unqualified entries shadow lower-priority entries; grouped entries
retain names such as `pstack:how` and `knowledge-work:data`.

## Plugin workflow activation

The plus menu and `+ <group> task` shorthand set a turn-local workflow without
changing Project settings:

```json
{
  "prompt": "重构这个模块",
  "selectedSkills": ["knowledge-work:data"],
  "workflow": {"kind": "skill_group", "id": "knowledge-work", "mode": "auto"}
}
```

`+ <group>` adds group metadata and lets the model choose relevant Skill bodies
through `read_file`; it does not pre-load every file or call a routing model.
The event stream shows `skill_group_activated`, then emits the same started and
loaded on-demand events for each first `SKILL.md` read with
`activation: "on_demand"`.
Disabling a group in the panel disables both entry points for that group.

## Composer files and local paths

The plus menu has one `文件` entry. It opens a regular file picker and accepts
ordinary files, including images. Images selected there use the same image
input path as clipboard images, so the model can use `read_image` when the
runtime permits it. The composer does not provide a directory picker.

Folders can be copied or dragged into the composer. When the desktop bridge or
the operating system provides a physical path, WebStudio records that path as
a read-only reference for the current Turn; it does not copy the folder or
invent a relative-path tree. A browser that exposes a directory but no physical
path shows a warning and asks the user to use a path-aware desktop window.

Regular files without a usable native path are sent as bounded content
attachments. The Gateway validates the path or content, rejects `.git` path
references, and adds only a controlled attachment reference to the prompt.
Path references are read-only; file writes and script execution still use the
Host approval and sandbox rules. Attachment metadata is preserved for the live
message and queue, while historical projections strip physical paths and keep
only safe names/counts.

Selecting `目标` or `计划模式` from the same plus menu only adds a composer
chip. It does not change the runtime immediately. The directive is activated
when the message is submitted (or later dequeued): Goal sets the current
Thread Goal and sends the task, while Plan Mode enables planning and sends the
task. If the current Turn is running, the complete directive and attachment
payload stay together in the queue.
