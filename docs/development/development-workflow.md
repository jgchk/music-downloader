# Development Workflow

## Trunk-based development

We work on a single trunk that is always releasable. Work lands in small, frequent increments via short-lived branches merged quickly — no long-lived divergent branches. Incomplete work is hidden behind flags rather than parked on a branch.

## Version control (jujutsu)

Local development uses jujutsu (git-backed); the remote is git. History is curated: because commits are cheap to rewrite, we shape a clean, coherent sequence before it lands. Every commit that lands on trunk is green.

## Every commit passes the gate

A single check runs **build, lint, typecheck, format, and tests**. Every commit satisfies it — no commit is allowed to fail any of them. Run the gate locally (in watch mode while developing); it is also the hard gate in CI.

## Conventional commits

Commit messages follow the Conventional Commits format. They drive the version bump and changelog generation, so the message is part of the contract, not an afterthought.

## Pull requests

Changes land through short-lived pull requests into trunk. `main` is protected: it takes no direct pushes, requires a PR whose branch is up to date, requires the `version-check`, `quality`, and `test` checks green, and merges by **rebase only** (linear history — the exact commits that passed the checks are what land). Reviews focus on design and correctness; style and formatting are handled by automation.

## Versioning happens pre-merge

The version bump lives **in the PR**, not in post-merge automation. Before pushing a release-worthy branch, run:

```
pnpm version:prep
```

It computes the next semver from the conventional commits since the last release tag and writes `package.json` + a `CHANGELOG.md` section — reviewable changes you commit into the PR. The computation resets those files to their merge-base content first, so it is idempotent: running it twice, or after rebasing onto an advanced `main`, recomputes cleanly. A PR with only `chore`/`docs`/`test`/`refactor` commits produces no bump.

CI's required `version-check` job runs `pnpm version:prep --check`: it fails (with the exact command to run) if the branch is not prepped. **It never pushes to your branch** — no bot commits, no credentials in CI. If two PRs claim the same next version, the second rebases (required by "up to date") and re-preps against the new baseline.

The invariant this maintains: **`main`'s `package.json` version equals the latest released tag.** The application reads that version at runtime and reports it as the OpenAPI `info.version` and the MCP server version (the `/api/v1` path prefix is a separate, frozen contract version and does not move with releases).

> Not automating the bump-push is a deliberate choice for a small team: it deletes an entire credential class and the jj-rebase churn a bot commit would cause on every PR. The documented upgrade path, if outside contributors arrive, is a GitHub App that pushes the bump so contributors needn't run the command.

## CI/CD — one pipeline, two paths (`.github/workflows/pipeline.yml`)

- **Pre-merge (pull_request):** `version-check`, the quality gate, and the full test pyramid (coverage at 100%, the OpenAPI contract snapshot, the frozen-fixture contract tier, and the release-tooling tests). These are the required checks. Fast, and free to have mutated the branch (the version bump).
- **Post-merge (push to main):** idempotent and never commits to `main`. It re-runs the gate, builds the image once, gates it through the out-of-process E2E tier, and only then — if `package.json`'s version is not already tagged — publishes the semver-tagged image (`vX.Y.Z`, `X.Y`, `latest`, `sha`) and creates the tag + GitHub Release (notes from the CHANGELOG section). A re-run of an already-released commit is a no-op; a chore-only merge releases nothing.
- Nothing irreversible (tag, release, publish) happens before every gate — including E2E — is green **on that same run**. If E2E fails post-merge, `main` holds an unreleased-but-merged version until a subsequent green run releases it; nothing was tagged or published in the meantime.
- **External services are never contacted in the pre-merge tests** — adapters run against fakes/fixtures for determinism. The post-merge E2E tier drives the real container against WireMock stubs.
- No manual step can bypass the gates.
