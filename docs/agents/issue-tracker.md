# Issue tracker: GitHub

Issues for this repo live as GitHub issues on `jgchk/music-downloader`. Use the `gh` CLI
for all operations; it infers the repo from `git remote -v` when run inside the clone.

## Conventions

- **Create**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read**: `gh issue view <number> --comments`
- **List**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
- **Comment**: `gh issue comment <number> --body "..."`
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## This repo runs on `jj`, not `git`

`jj` keeps git's `HEAD` detached, so **any `gh` subcommand that infers "the current branch"
fails with `not on any branch`**. Issue operations are unaffected — they take an explicit
number. But never let `gh` infer branch state, and never judge repo state from
`git status` / `git log` (stale in a colocated repo) — trust `jj st` and
`jj bookmark list --all`. See the "PRs with `jj` + `gh`" section of `CLAUDE.md`.

Run `gh` from the colocated main repo, not a bare `jj` workspace (no `.git` there).

## Pull requests as a triage surface

**PRs as a request surface: no.**

Every PR on this repo is authored by the maintainer; there are no external contributors,
so external-PR triage would always return an empty queue. Set this to `yes` if that
changes — `/triage` reads this flag.

## Labels beyond triage

`quality-gate` is a **category role** on this repo, not a stray label — see
`docs/agents/triage-labels.md`.

These repo-specific labels are neither category nor state, and should be left alone unless
you're deliberately working that queue:

- `mutation-drift` — surviving mutants found by the weekly full mutation run
- `contract-drift` — a third-party API no longer matching its recorded contract
- `dependencies`, `released` — Renovate and release automation

Issue **#6** is Renovate's Dependency Dashboard. It is bot-managed, permanently open, and
not triage work — skip it in every sweep.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far /
  Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the
  sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the
  map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the
  driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible
  representation. Add an edge with
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where `<blocker-db-id>` is the blocker's numeric **database id**
  (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`).
  GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live
  gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line
  at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to
  the map's sub-issues / task list), drop any with an open blocker
  (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line)
  or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then
  append a context pointer (gist + link) to the map's Decisions-so-far.

The `wayfinder:*` labels (`map`, `research`, `prototype`, `grilling`, `task`) already exist
on this repo. If you need another, create it before use — `gh issue create --label <name>`
fails on an unknown label rather than creating it.
