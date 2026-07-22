---
name: "Review: All"
description: Run every pr-review-toolkit agent plus all auto-discovered custom review agents over the current change, then aggregate findings.
argument-hint: "[agent-names…] [parallel|sequential] [--with-simplify]"
category: Review
tags: [review, quality, agents]
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Task"]
---

# Comprehensive multi-agent review

Review the current change with the **full pr-review-toolkit roster** *and* **every auto-discovered custom review agent**, then aggregate into one prioritized report.

**Arguments:** "$ARGUMENTS" — optional. May contain: specific agent names to restrict the run to; `parallel` (default) or `sequential`; `--with-simplify` to also run the code-simplifier polish pass (off by default because it edits files).

## 1. Determine the change scope

This repo is driven by **jujutsu (`jj`)**, not git — compute the scope accordingly and do NOT rely on `git diff` (committed jj changes won't show up there).

- Changed files in this change vs trunk: `jj diff -r 'trunk()..@' --summary` (and include working-copy edits with `jj diff --summary`). If `jj` is unavailable, fall back to `git diff --name-only main...HEAD` plus `git diff --name-only`.
- If a PR exists, note it (`gh pr view` when a GitHub remote is present) — but the jj diff is the source of truth for scope.
- Produce a concrete **changed-file list** and a way to view the diff. You will hand this scope to every agent so they all review the same thing.

If the scope is empty, say so and stop — there is nothing to review.

## 2. Assemble the agent roster

**a. Fixed pr-review-toolkit agents** (subagent_type in parentheses):

- General code quality & CLAUDE.md compliance (`pr-review-toolkit:code-reviewer`)
- Test coverage quality (`pr-review-toolkit:pr-test-analyzer`)
- Comment accuracy & rot (`pr-review-toolkit:comment-analyzer`)
- Silent failures & error handling (`pr-review-toolkit:silent-failure-hunter`)
- Type design & invariants (`pr-review-toolkit:type-design-analyzer`)
- *(opt-in)* Code simplification (`pr-review-toolkit:code-simplifier`) — **only** if `--with-simplify` is passed, and run it LAST since it edits files.

**b. Auto-discovered custom review agents.** Discover them dynamically so new ones are picked up with zero changes to this command:

1. `Glob` for `.claude/agents/*.md` (project) and `~/.claude/agents/*.md` (user).
2. `Read` each file's YAML frontmatter.
3. Select every agent that **opts in** to review, by either signal:
   - frontmatter contains `review: true`, **or**
   - the agent's `name` (or filename) ends in `-reviewer`.
4. Its `subagent_type` is the frontmatter `name`. De-duplicate against the fixed roster.

This opt-in convention is the extension point: to add a new custom review agent, drop a `*.md` into `.claude/agents/` with `review: true` in its frontmatter — this command will find and run it automatically. (Today that discovers at least `contract-test-reviewer`, which flags third-party schema/API changes that lack contract-test coverage.)

**Restricting the run:** if `$ARGUMENTS` names specific agents (by short name, e.g. `tests contract-test-reviewer`), run only those (matched against both rosters). Otherwise run the whole discovered roster.

**Applicability:** you may skip a fixed agent whose focus clearly doesn't apply to the diff (e.g. `type-design-analyzer` when no types changed) to save time — but when unsure, run it. Always run every discovered custom agent: they are written to self-skip when irrelevant.

## 3. Launch the agents

Give **every** agent the same scope in its prompt: the changed-file list and how to view the diff (the jj command), and instruct it to focus its review on that diff. Launch read-only review agents concurrently (`parallel`, the default) by sending multiple `Task` calls in one message; use `sequential` only if the arguments ask for it. If `--with-simplify` was passed, run `code-simplifier` on its own **after** the read-only agents finish and after you've surfaced findings, since it mutates files.

## 4. Aggregate the findings

Collect every agent's report and merge into one prioritized summary. Tag each finding with the agent that raised it and a `path:line`. Map severities sensibly (e.g. a contract-test-reviewer **High** is a Critical/Important; a simplification is a Suggestion). De-duplicate overlapping findings across agents.

```markdown
# Review Summary — <change name / scope>

Agents run: <fixed + discovered list>  ·  Files reviewed: <n>

## Critical (must fix before merge)
- [<agent>] <issue> — `file:line`

## Important (should fix)
- [<agent>] <issue> — `file:line`

## Suggestions (nice to have)
- [<agent>] <suggestion> — `file:line`

## Strengths
- <what's well done>

## Recommended actions
1. <ordered next steps>
```

If an agent returned no findings, note it as a clean pass rather than omitting it, so the coverage of the review is visible. End with the single highest-priority next action.
