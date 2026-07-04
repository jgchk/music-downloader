# CLAUDE.md

This file orients anyone — human or AI — working in this repository. Read the linked development docs before contributing; together they are the project's constitution for **how we build**.

## Project

An extensible, event-sourced music downloader. Given a musical intent and a quality policy, it finds, downloads, validates, and (on failure) retries the best-matching, highest-quality release across pluggable sources, exposed over HTTP and MCP.

**Status: pre-implementation.** The design, capability specs, and task breakdown live in `openspec/changes/bootstrap-acquisition-core/` (`design.md`, `specs/`, `tasks.md`) — the source of truth for _what_ we build. The docs below are the source of truth for _how_ we build.

## Non-negotiables

Hard rules. A change that violates one is wrong regardless of anything else:

- **Test-first.** No production line without a failing test first. 100% coverage, enforced in CI. → `testing.md`
- **The domain is pure.** No I/O, logging, or frameworks in the domain layer. → `architecture.md`, `domain-driven-design.md`
- **Dependencies point inward.** The dependency rule is lint-enforced; a violation is a build break. → `architecture.md`
- **Errors are values.** Expected failures are modeled, not thrown. → `error-handling.md`
- **No breaking changes** to public contracts. Additive-only within a version; enforced by contract tests. → `api-compatibility.md`
- **Every commit passes the gate** — build, lint, typecheck, format, tests. → `development-workflow.md`
- **Config comes from the environment.** No secrets in source. → `twelve-factor.md`

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

## Stack

Node · TypeScript (strict) · pnpm · neverthrow · zod · Fastify · pino · vitest · SQLite · ffmpeg. Local VCS: jujutsu (git-backed).

## Where things live

- `openspec/` — change design, capability specs, and tasks (_what_ we're building).
- `docs/development/` — the constitution (_how_ we build).
- `src/{domain,application,adapters,interfaces,composition}` — the layers (once implemented).
