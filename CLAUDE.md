# CLAUDE.md

This file orients anyone — human or AI — working in this repository. Read the linked development docs before contributing; together they are the project's constitution for **how we build**.

## Project

An extensible, event-sourced music downloader and importer — one product, built as a modular monolith. Given a download request and a quality policy, the **downloader** module finds, downloads, validates, and (on failure) retries the best-matching, highest-quality release across pluggable sources, depositing it for hand-off; the **importer** module proposes beets-powered metadata matches for each deposited directory, auto-imports confident ones into the library, and queues uncertain ones for human review. The two bounded contexts each own their SQLite event store and integrate only through durable in-process catch-up subscriptions over each other's events (producer-owned schemas, tolerant readers behind an anti-corruption layer). Beets remains the library's system of record.

Design, capability specs, and task breakdowns live under `openspec/changes/` (active) and `openspec/changes/archive/` (shipped) — the source of truth for _what_ we build. The docs below are the source of truth for _how_ we build.

## Non-negotiables

Hard rules. A change that violates one is wrong regardless of anything else:

- **Test-first.** No production line without a failing test first. 100% coverage, enforced in CI. → `testing.md`
- **The domain is pure.** No I/O, logging, or frameworks in the domain layer. → `architecture.md`, `domain-driven-design.md`
- **Dependencies point inward.** The dependency rule is lint-enforced; a violation is a build break. → `architecture.md`
- **Errors are values.** Expected failures are modeled, not thrown. → `error-handling.md`
- **No breaking changes** to public contracts. Additive-only within a version; enforced by contract tests. → `api-compatibility.md`
- **Every commit passes the gate** — build, lint, typecheck, format, tests. → `development-workflow.md`
- **Config comes from the environment.** No secrets in source. → `twelve-factor.md`
- **Use `jj`, never `git`, for all VCS operations.** This repo is driven by jujutsu (git-backed). Commit, describe, split, rebase, branch, and push with `jj` — do not run `git commit`/`git branch`/`git push` etc. Read-only `git` inspection is fine when no `jj` equivalent fits. → `development-workflow.md`

## Development constitution — `docs/development/`

- [architecture.md](docs/development/architecture.md) — layered + hexagonal, the dependency rule, vanilla DI
- [domain-driven-design.md](docs/development/domain-driven-design.md) — aggregates, value objects, ubiquitous language, a pure rich domain
- [design-principles.md](docs/development/design-principles.md) — SOLID and the OOP patterns we favor
- [event-sourcing.md](docs/development/event-sourcing.md) — events as facts, the decide/evolve/react decider, projections
- [error-handling.md](docs/development/error-handling.md) — errors as values, the failure taxonomy
- [testing.md](docs/development/testing.md) — red-green-refactor, the pyramid, BDD, 100% coverage
- [api-compatibility.md](docs/development/api-compatibility.md) — versioned APIs, no-breaking-change, single-source contracts
- [logging.md](docs/development/logging.md) — structured logging, correlation, redaction, logs vs events
- [coding-standards.md](docs/development/coding-standards.md) — TypeScript strict, eslint/prettier, conventions
- [quality-gates.md](docs/development/quality-gates.md) — what earns a place in the commit gate, the promotion ladder, the latency budget
- [twelve-factor.md](docs/development/twelve-factor.md) — the twelve-factor method as we apply it
- [development-workflow.md](docs/development/development-workflow.md) — trunk-based dev, jujutsu, conventional commits, CI/CD

## Commands

- `pnpm check` — the full gate: format, lint, typecheck, build, and all test tiers, fanned out as parallel fail-fast lanes (`scripts/check.sh`; `pnpm check:serial` runs the same lanes one at a time). Every commit must pass it.
- `pnpm test` / `pnpm test:watch` / `pnpm test:cov` — unit + integration (vitest).
- `pnpm test:e2e` — out-of-process E2E against a live slskd (`test/e2e/run.sh`).
- `pnpm format:write` — apply prettier fixes.

Runtime: Node ≥24, pnpm 11. After switching Node versions locally, run `pnpm rebuild better-sqlite3` (native module).

## PRs with `jj` + `gh`

jj keeps git's `HEAD` detached, so any `gh` subcommand that infers "the current branch" fails with `not on any branch` — and a `gh pr merge` printing that error has usually **still merged** (verify with `gh pr view <#> --json state`). Never let `gh` touch or infer local branch state, and never judge commit/push state from `git status`/`git log` (stale in colocated repos) — trust `jj st` and `jj bookmark list --all`. Run `gh` **and `jj git push`** from the colocated main repo, not a bare workspace: in a bare workspace `jj git push` can land the push on the remote and _then_ die with `not a git repository`, leaving local state claiming "already matches" — trust the PR head SHA (`gh pr view <#> --json headRefOid`), not the error.

`jj workspace add` creates **bare** workspaces (this jj version has no colocate option): dev, `pnpm check`, and `pnpm version:prep` (jj-native) all work there after a `pnpm install --frozen-lockfile`, but `git` and `gh` do not (no `.git`) — run those from the main repo, pointing its working copy at the branch with `jj new <bookmark>` when something needs git `HEAD`.

**The commit type is release semantics.** CI's `version-check` derives the expected version from conventional-commit types since the last release: a `feat`/`fix` on the PR demands the matching `version:prep` bump or the check fails. Tooling/docs-only PRs (`.claude/`, `docs/`, `openspec/`) must use `chore`/`docs` so no release is demanded. When a check fails, read just the failing step with `gh run view --job <job-id> --log-failed`.

The reliable flow:

```sh
jj git fetch && jj rebase -b <bookmark> -d 'main@origin'  # sync FIRST — concurrent sessions move main mid-ship (recurring collision)
jj git push --bookmark <bookmark>
gh pr create --head <bookmark> --base main …              # explicit --head; refer to the PR by number from here on
gh pr merge <#> --auto --rebase                           # arm auto-merge NOW — GitHub merges the moment checks go green (kills the watch-then-merge race, incl. after an amend re-push)
gh pr checks <#> --watch                                  # then watch for the outcome; rebase-merge only; NO --delete-branch (remote auto-deletes; local: jj git fetch)
```

Auto-merge does NOT update an out-of-date branch: required checks are strict, so if main moves after you armed it the PR just sits — fetch + rebase + push again and auto-merge fires when the re-run goes green. Confirm with `gh pr view <#> --json state` before building on the result.

## Stack

Node · TypeScript (strict) · pnpm workspace · neverthrow · zod · pino · vitest · SQLite · ffmpeg (downloader) · beets via a stateless Python bridge CLI behind an outbound port (importer, the one non-TS component, pinned in the Docker image). VCS: jujutsu (`jj`), git-backed — see Non-negotiables.

## Where things live

- `CONTEXT-MAP.md` + `packages/*/CONTEXT.md` — the ubiquitous-language glossaries: canonical terms per context, words to avoid, and the cross-context homonym table. Consult them when naming anything; update them the moment a term is resolved or challenged.
- `openspec/` — change design, capability specs, and tasks (_what_ we're building). Adopted importer capabilities note their provenance.
- `docs/development/` — the constitution (_how_ we build).
- `packages/downloader`, `packages/importer` — the bounded-context packages, each with `src/{domain,application,adapters,interfaces,composition}` layers, its own event store file, and its own contract tier (`test/contract`).
- `test/e2e`, `scripts/release` — product-level tiers and tooling at the workspace root.

**Keep the two at their right altitude.** `docs/development/*.md` is constitutional: durable, largely project-agnostic principles for _how_ we build. Write them without domain specifics — no aggregate names, no source names, no schemas. Code-level, project-specific design (the actual aggregate, ports, event schema, policies, endpoints) belongs in OpenSpec under `openspec/changes/<change>/`, which already carries that detail. If a development doc starts needing concrete design specifics, that's the signal it belongs in OpenSpec instead.

## Agent skills

Per-repo configuration for the `mattpocock-skills` engineering skills lives in `docs/agents/`.

### Issue tracker

GitHub Issues on `jgchk/music-downloader`, via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

The five canonical triage roles, each label string equal to its role name. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Multi-context: `CONTEXT-MAP.md` + `packages/*/CONTEXT.md`, with OpenSpec standing in for ADRs. See [docs/agents/domain.md](docs/agents/domain.md).
