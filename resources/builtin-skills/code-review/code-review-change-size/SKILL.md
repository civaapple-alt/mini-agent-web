---
name: code-review-change-size
description: Measure review scope and identify changes that should be split into smaller stages.
---

# Review change size

Read the target repository's AGENTS.md and inspect the actual selected diff, including staged, unstaged, and untracked files where the requested scope includes them.

Report the changed-file count and added, removed, and total changed-line counts. Exclude generated output and dependency trees. State any counting limits, such as untracked or binary files that the chosen diff command does not count.

Unless the repository sets a different limit, flag changes over 800 total changed lines and complex logic changes over 500 lines. Base complexity on the behavior and dependencies in the diff, not the raw count alone.

When a change should be split, identify the smallest coherent stage, its dependencies, and the remaining stages. Explain why the proposed boundary keeps each stage reviewable. If the change fits, report the counts and say that no size-based split is needed.

Do not contact remote services or change repository files. Report actionable size risks with repository-relative paths and line numbers where relevant.
