# Development Workflow

## Trunk-based development

We work on a single trunk that is always releasable. Work lands in small, frequent increments via short-lived branches merged quickly — no long-lived divergent branches. Incomplete work is hidden behind flags rather than parked on a branch.

## Version control (jujutsu)

Local development uses jujutsu (git-backed); the remote is git. History is curated: because commits are cheap to rewrite, we shape a clean, coherent sequence before it lands. Every commit that lands on trunk is green.

## Every commit passes the gate

A single check runs **build, lint, typecheck, format, and tests**. Every commit satisfies it — no commit is allowed to fail any of them. Run the gate locally (in watch mode while developing); it is also the hard gate in CI.

## Conventional commits

Commit messages follow the Conventional Commits format. They drive automated semantic versioning and changelog generation, so the message is part of the contract, not an afterthought.

## Pull requests

Changes land through short-lived pull requests into trunk. CI is a required check: a PR can't merge unless the full gate and the test pyramid pass. Reviews focus on design and correctness — style and formatting are already handled by automation.

## CI/CD

- CI runs on every PR and on trunk: the quality gate, the full test pyramid, coverage at 100%, and the API contract test.
- **External services are never contacted in CI** — adapters run against fakes/fixtures for determinism.
- CD builds an immutable, versioned artifact and publishes it on merge/release. Version bump, changelog, and tag are automated from commit history.
- No manual step can bypass the gates.
