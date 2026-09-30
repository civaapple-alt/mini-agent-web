---
name: code-review-testing
description: Check whether tests cover changed behavior, boundaries, failures, and recovery.
---

# Review test coverage

Read the target repository's AGENTS.md and testing documentation. Find the existing test helpers and the closest tests for the changed behavior before judging the test layout.

For each user-visible or stateful behavior change, check for deterministic tests that exercise the public boundary and distinguish success from failure. For agent or model-loop changes, look for a bounded scenario with a mock model or fixture instead of relying only on isolated helper tests.

Check relevant normal, boundary, error, restart, and recovery cases. Verify that tests assert observable behavior rather than private implementation details. Identify tests that depend on a paid provider, remote service, timing guess, or developer-local file.

When coverage is missing, name the behavior and the smallest test that would prove it. When the change is adequately covered, identify the test evidence and note any unverified path.

Use the repository's actual test paths and helpers. Do not assume a specific language, test directory, or framework. Do not contact remote services or change repository files.
