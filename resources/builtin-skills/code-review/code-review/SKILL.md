---
name: code-review
description: Review a local repository or its current changes with four focused, read-only checks.
---

# Review a local repository

Review local files only. Do not contact GitHub, other remote review services, or any network endpoint. Do not edit files, create commits, or leave comments.

## Choose the review scope

Read the repository's root AGENTS.md first. Before reviewing a nested area, read any AGENTS.md that applies to it. Follow the repository's current documentation and test layout.

Use the scope the user requested:

- For a whole-repository review, inspect the current checkout, including relevant untracked source files. Skip generated output, dependency trees, and build artifacts.
- For a starting commit, verify that it exists and treat it as the exclusive base. Inspect changes introduced after it through current HEAD, plus the current tracked working tree and relevant untracked source files. Report the chosen base commit.
- Otherwise review the current working tree: staged changes, unstaged changes, and untracked files relative to HEAD.

If the user did not name a scope and the working tree has no staged, unstaged, or untracked changes, ask whether to review the whole repository or provide a starting commit. Do not silently turn a clean worktree into a whole-repository review.

For a change review, use Git status and diffs to define the changed files. Read complete surrounding code, callers, repository guidance, and relevant tests before reporting a finding. Do not treat an untracked file as absent because Git diff omits it.

## Delegate four focused checks

Create one parallel child task for each specialist below. Give every child the
chosen review scope, the repository path, and the same read-only constraint.
Use a unique child_key and execution_mode set to parallel. Ask each child to
read its skill instructions with read_file from the matching path under
.mini-agent/skills/builtin/code-review:

1. code-review-breaking-changes
2. code-review-change-size
3. code-review-context
4. code-review-testing

Keep each task focused on its named specialty. Ask for actionable findings with repository-relative file paths, line numbers, concrete impact, and evidence. Ask the size specialist to report counts and stage suggestions even when it finds no bug.

After dispatching all four tasks, call task_list with limit 4 and use each
returned child_thread_id to call task_read once. Check operation.status and the
matching turn_outcome, then read the child's latest final answer when settled;
reports are progress updates, not the final answer. If a task is queued or
running, wait for its wake-up before reading it again. Do not poll active tasks
in a tight loop or claim coverage for a specialty without its settled result.

If delegate_task is unavailable, read all four specialist files with read_file and run the checks sequentially. State that the review used one session instead of independent child sessions. If a child fails or cannot return a result, name the incomplete specialty and do not claim full coverage.

## Report the review

Return every distinct actionable finding from the completed specialist checks.
Order findings by severity and number them. Combine exact duplicates only.
Include a repository-relative path and line number for every finding. Explain
the behavior and impact, and cite the relevant code or test evidence. Avoid
speculative issues and style-only preferences.

If no actionable issue remains, say that no findings were identified within the completed scope. State the scope and list any specialist checks that did not complete. Keep the report local and do not create or update remote review records.
