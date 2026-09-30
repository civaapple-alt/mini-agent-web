---
name: code-review-breaking-changes
description: Find compatibility breaks in local APIs, configuration, data, and recovery paths.
---

# Review compatibility changes

Read the target repository's AGENTS.md and compatibility documentation. Inspect the selected review scope and trace affected callers and stored data.

Check for breaks in:

- Public APIs, protocol messages, CLI arguments, and integration contracts.
- Configuration keys, defaults, validation, and migration behavior.
- Persisted data, checkpoints, and sessions resumed from older records.
- Error shapes, state transitions, and behavior relied on by downstream clients.

For each possible break, identify the old and new behavior, the affected caller or stored record, and the evidence that makes the break reproducible. Distinguish intentional changes with documented migration paths from accidental incompatibilities.

Do not contact remote services or change repository files. Report only actionable compatibility findings with repository-relative paths and line numbers. If none remain, report that this specialty found no actionable issue in the selected scope.
