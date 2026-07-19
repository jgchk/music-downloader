# CLAUDE.md

This file orients anyone — human or AI — working in this repository. Read the linked development docs before contributing; together they are the project's constitution for **how we build**.

## Project

An extensible, event-sourced music importer. Given music files (deposited by a downloader, or pointed at manually), it proposes beets-powered metadata matches, auto-imports confident ones into the library, and queues uncertain ones for human review — exposed over HTTP and MCP. Beets remains the library's system of record; this tool narrates and drives the _import process_, never the library itself.

Sibling to [music-downloader](https://github.com/jgchk/music-downloader): the two cooperate via producer-owned webhook events (each tool owns the schemas of events it emits; consumers are tolerant readers behind an anti-corruption layer) but each runs fully standalone.

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
- [twelve-factor.md](docs/development/twelve-factor.md) — the twelve-factor method as we apply it
- [development-workflow.md](docs/development/development-workflow.md) — trunk-based dev, jujutsu, conventional commits, CI/CD

## Commands

- `pnpm check` — the full gate: format → lint → typecheck → build → test w/ coverage. Every commit must pass it.
- `pnpm test` / `pnpm test:watch` / `pnpm test:cov` — unit + integration (vitest).
- `pnpm test:e2e` — out-of-process E2E against the built Docker image (`test/e2e/run.sh`).
- `pnpm format:write` — apply prettier fixes.

Runtime: Node ≥24, pnpm 11. After switching Node versions locally, run `pnpm rebuild better-sqlite3` (native module).

## Stack

Node · TypeScript (strict) · pnpm · neverthrow · zod · Fastify · pino · vitest · SQLite. Beets (the tagging/import engine) is driven through a thin, stateless Python bridge CLI behind an outbound port — the one non-TS component, pinned in the Docker image. VCS: jujutsu (`jj`), git-backed — see Non-negotiables.

## Where things live

- `openspec/` — change design, capability specs, and tasks (_what_ we're building).
- `docs/development/` — the constitution (_how_ we build).
- `src/{domain,application,adapters,interfaces,composition}` — the layers.

**Keep the two at their right altitude.** `docs/development/*.md` is constitutional: durable, largely project-agnostic principles for _how_ we build. Write them without domain specifics — no aggregate names, no source names, no schemas. Code-level, project-specific design (the actual aggregate, ports, event schema, policies, endpoints) belongs in OpenSpec under `openspec/changes/<change>/`, which already carries that detail. If a development doc starts needing concrete design specifics, that's the signal it belongs in OpenSpec instead.
