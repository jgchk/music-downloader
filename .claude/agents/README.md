# Custom reviewer agents — house conventions

Every `*.md` in this directory with `review: true` in its frontmatter is auto-discovered by the `/review-all` sweep. This file records the conventions a new reviewer agent must follow; read one of the existing agents (e.g. `type-altitude-reviewer.md`) as the living example.

## Two binding rules

- **Portable.** An agent states *principles*, never repo specifics — no class, module, adapter, or path names from this codebase in the rubric. Opinions decided here are extrapolated to rules that would hold in any repo; the agent establishes local facts (the Result library, the lint config, the layer layout, framework entry files) at review time with Glob/Grep, not from hardcoded knowledge.
- **Independent.** Agents never reference each other. No "X is `other-agent`'s beat" pointers; scope narrowing is phrased by *topic* ("you do not review error type design"), not by naming the sibling that owns it. Overlapping findings between two agents are an accepted cost of independence.

## Frontmatter contract

Exactly these keys, in this order — no `tools` key (agents inherit the full toolset):

```yaml
name: <kebab-case>-reviewer
description: <single unwrapped line — see template below>
model: inherit
color: <unique among agents in this dir>
review: true
```

The `description` follows the house template: *"Use this agent when a change adds or modifies [X] … It checks [enumerated rubric dimensions] … Invoke it proactively as part of a pre-PR review sweep. Give it the diff/file list to focus on."* The last two sentences are boilerplate shared by every agent.

## Body skeleton

Target ~65–70 lines of long-paragraph prose (heavy em-dashes, bolded bullet lead-ins, second-person imperative):

1. **Untitled preamble** — three moves: identity + single specialty ("You are a X reviewer. Your single specialty: …"); the *signature failure mode* the agent exists to catch, named concretely; a narrowing paragraph ("You are narrow on purpose. You do not review […]. You review one thing: *[italicized one-question mandate]*"). Add a defer-to-lint paragraph when the territory borders mechanical enforcement: never re-report what the linter breaks the build on.
2. **`## The rubric`** — one `###` per dimension; each states the rule in bold, then bullets with inline **Flag:** / **Do NOT flag** guidance. Carve-outs state the *reason* the exception holds plus the condition that revokes it. Cite the canonical literature parenthetically at the end of rule statements (author/work names, so authors can look findings up) — do not link `docs/research/` files; distill them.
3. **`## What to inspect`** — a numbered procedure: (1) diff acquisition (`jj diff -r 'trunk()..@' --git` here; detect the VCS when phrased portably), (2) establish local facts / verify layout with Glob/Grep rather than trusting the description, (3) apply the rubric per changed unit — review the change, not the whole codebase, (4) the finding-citation format: `file:line`, the violated rule, and the *concrete failure it enables*.
4. **`## Report format`** — severity bands **Critical / Important / Suggestion** (the house vocabulary for new agents), each defined by concrete failures enabled, not by abstraction level.
5. **Closing one-liner** — a clean pass is a valid result; do not restate the rubric; the report is consumed by an aggregating orchestrator, so lead with findings.

## Evaluating a new or changed agent (before merging)

Run three simulated reviews — general-purpose subagents, each instructed to Read the agent file, adopt everything after the frontmatter as its operating instructions, and review a given file list read-only (treat full file contents as the diff):

1. **Violation-dense run** — a file set where you know the ground truth (which findings, at which severities). Every planted class must surface at the expected severity; zero unexpected Criticals.
2. **Carve-out run** — a file set exercising every exception the rubric grants. The carve-outs must be honored *and* their revoking conditions still fire (the false-positive check).
3. **Precision run** — mostly clean, well-behaved code plus one known violation class. Expect exactly that class flagged and explicit clean passes elsewhere.

Judge the reports against expectations; edit the agent only for real miscalibrations (wrong severity, missed class, false positive) — don't tune against a well-judged edge case. Iterate until a run needs no changes.

## Shipping

Agent-only PRs use the `chore(review)` commit type — `feat` fails CI's `version-check` by demanding a version bump, and a tooling-only change must not trigger a release. `.claude/` is prettier-ignored, so the format gate does not apply to these files.
