# mini-agent-web contributor instructions

## Scope

This repository contains the FastAPI gateway, the React Web Studio, and an
experimental TUI for the Mini Agent runtime. The Python SDK, its tests and
documentation, and generic App Server examples are maintained by
`mini-agent-harness`. During local development, this repository uses the SDK
from a sibling `mini-agent-harness` checkout through an editable path source.

Web Studio is the control and observation surface for projects and long-lived
Sessions. It presents runtime state, approvals, recovery, Child Sessions,
Notebook, and bounded events as user actions and projections. Keep Gateway and
Studio behavior aligned with the SDK source in the sibling checkout and the
App Server JSON-RPC contract.

The App Server, Host, and Capabilities remain authoritative for execution,
admission, side effects, and durable Session state. This repository must not
create a second Agent loop, authorization source, Session history, or recovery
model in the SDK, Gateway, or frontend.

## Documentation topology

Documentation is progressively disclosed from the repository root:

1. `README.md` is the only cross-directory project map. It answers what the
   repository contains and where to continue.
2. A directory `README.md` owns only that directory's purpose, files, commands,
   and local contract. It must not reproduce the root README or explain a
   neighboring directory. Directory READMEs should link only to files they own
   or child entries they directly govern.
3. `docs/README.md` indexes stable reference and operations documents in
   `docs/`. It does not index architecture notes or other directory READMEs.
4. `.agents/notes/README.md` indexes decisions and proposals. It is not a
   product or usage guide.
5. `AGENTS.md` is the contributor contract, not a second project README.

When a topic has one canonical owner, update that owner instead of appending a
second explanation elsewhere. Keep READMEs short; put limits, release steps,
troubleshooting, and protocol detail in the corresponding file under `docs/`.
Do not add a README section merely to link to a document outside its directory.

## Version and protocol

- Keep the Web repository, Gateway, frontend, and Web lockfile versions
  synchronized with each other. The SDK version comes from the sibling Harness
  checkout and does not have to match the Web release number. Keep the editable
  source path in `pyproject.toml` and `uv.lock` synchronized with that checkout.
  Update `pyproject.toml`, `server/__init__.py`,
  `server/app.py`, `frontend/package.json`, `frontend/package-lock.json`, and
  `uv.lock` together. Update the current Web release version in `README.md` and
  `CHANGELOG.md` too.
- The current release is `1.0.0`; the App Server protocol negotiates version
  `2` inside a JSON-RPC 2.0 envelope. Version 1 clients and Session journals
  are incompatible; see the Harness
  [App Server migration guide](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md)
  before upgrading. Do not change the protocol or public field names casually.
- Preserve unknown event types as `GenericEvent` so newer App Server events do
  not break older SDK consumers. Keep event identity bounded by Thread and Turn
  when streaming.
- Public Gateway, TUI, or Studio behavior changes require updates to
  `CHANGELOG.md`, the README or guide that owns the changed surface, and a
  focused test. Update SDK behavior and generic protocol examples in Harness.

## Progressive information disclosure

- Never inject unbounded file contents, massive tool schemas, or entire
  historical sessions into model context up front. Disclose bounded metadata
  first and load detail on demand.
- In Web Studio and TUI, prefer folded structured summaries: collapsed thinking,
  compact tool cards with expandable parameters/results, and settled compaction
  badges.
- Agent responses and summaries should lead with conclusions and next actions;
  detailed diffs or raw logs belong in an explicitly requested artifact.

## Development commands

Run from the repository root as applicable:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
uv build --project .
```

Web development and tests use the editable SDK source in the sibling Harness
checkout. Keep both repositories under the same parent directory before running
`uv sync`. Tests requiring a local App Server must receive a compatible
`MINI_AGENT_APP_SERVER_PATH`; the default test suite must not require a model
provider or spend tokens.

## Change hygiene

- Reuse the existing SDK/client and gateway abstractions; do not add duplicate
  protocol wrappers or parallel event-routing paths.
- Do not commit generated `dist/`, frontend build output, logs, caches, or local
  `.env` files.
- Before committing, inspect `git diff --check`, review the complete diff, and
  leave the working tree clean except for intentional changes.
