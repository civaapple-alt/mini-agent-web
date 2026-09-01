# mini-agent-web contributor instructions

## Scope

This repository contains the `mini-agent` Python SDK, the FastAPI gateway, the
React frontend, the TUI, and executable Cookbook examples for the Mini Agent
App Server. Keep the public SDK and the App Server JSON-RPC contract aligned.

## Version and protocol

- Keep the repository, SDK, server, frontend, and lockfile versions synchronized
  for a release. Update `pyproject.toml`, `sdk/python/pyproject.toml`,
  `sdk/python/src/mini_agent/__init__.py`, `server/app.py`,
  `frontend/package.json`, and `frontend/package-lock.json` together.
- The current release is `0.6.0`; the wire protocol remains JSON-RPC protocol
  version `1`. Do not change the wire protocol or public field names casually.
- Preserve unknown event types as `GenericEvent` so newer App Server events do
  not break older SDK consumers. Keep event identity bounded by Thread and Turn
  when streaming.
- Public behavior changes require updates to `CHANGELOG.md`, the relevant
  README or guide, and a focused test or Cookbook validation.

## Development commands

Run these commands from the repository root as applicable:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
cd frontend && npm run build
uv build --package mini-agent
```

For live SDK tests, set `MINI_AGENT_APP_SERVER_PATH` to a matching
`mini-agent-app-server` binary. The default test suite must not require a model
provider or spend tokens.

## Cookbook and examples

- Every `cookbook/python-demo/*.py` file must remain syntactically compilable.
- `cookbook/python-demo/06_protocol_compatibility.py` is the deterministic,
  no-provider protocol contract check; extend its fixtures when the public
  event surface changes.
- Demos 01–05 are explicit live-provider examples. Document their required
  environment and do not make them implicit CI dependencies.

## Change hygiene

- Prefer the existing SDK/client and gateway abstractions; do not add duplicate
  protocol wrappers or parallel event-routing paths.
- Keep SDK dependencies at zero unless a dependency is necessary and documented.
- Avoid committing generated `dist/`, frontend build output, logs, caches, or
  local `.env` files.
- Before committing, inspect `git diff --check`, review the complete diff, and
  leave the working tree clean except for intentional changes.
