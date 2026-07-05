# Proposal: overhaul-release-pipeline

## Why

The current pipelines violate the principle that post-merge automation must be idempotent: semantic-release commits a CHANGELOG back to `main` post-merge, CD releases without waiting for (or running) any checks, the git tag and GitHub Release are created *before* the E2E gate, and Docker images publish with only `latest`/`sha` tags while the built artifact believes its own version is `0.0.0`. A merge that fails lint can still ship; a merge that fails E2E still tags and releases.

## What Changes

- **Pre-merge versioning**: the version bump (package.json) and CHANGELOG.md section are computed in the feature PR from conventional commits, via a `version:prep` script wrapping `commit-and-tag-version`. CI verifies with the same script in check mode — no credentials, no bot pushes.
- **Idempotent post-merge pipeline**: on push to `main`, run the full gate (quality, tests, contract), build the image once, run the out-of-process E2E gate against it, then — only if the version's tag does not already exist — create the annotated tag, GitHub Release (notes from the CHANGELOG section), and publish the image. Zero commits to `main` ever.
- **Semver-tagged images**: GHCR images are published as `vX.Y.Z`, `X.Y`, `latest`, and `sha`.
- **Artifact self-knowledge**: the app reads its version from package.json at runtime; OpenAPI `info.version` and the MCP server version report it. The OpenAPI snapshot contract test normalizes `info.version` so releases don't break it.
- **Branch protection / PR-only flow**: `main` requires a PR, green required checks, an up-to-date branch, and linear history; rebase-merge is the only enabled merge method.
- **Removals**: semantic-release and its plugins; the separate `cd.yml` (CI and CD collapse into one pre-merge / post-merge split); the `[skip ci]` release-commit pattern; `issues: write` / `pull-requests: write` permissions.
- Release cadence is preserved: every merge with releasable commits (`feat`/`fix`/`perf`/breaking) releases; chore/docs-only merges are release no-ops by construction (no bump → tag exists → release stage skips).

## Capabilities

### New Capabilities

- `release-pipeline`: how the project versions, gates, and releases artifacts — pre-merge version computation, idempotent post-merge release, semver-tagged images, artifact version self-knowledge, and trunk protection rules.

### Modified Capabilities

- `public-api`: the OpenAPI document's `info.version` (and the MCP server version) SHALL report the application release version from package.json, and the breaking-change snapshot test SHALL be insensitive to it. (The `/api/v1` path prefix remains the separate contract version — unchanged.)

## Impact

- **Workflows**: `.github/workflows/ci.yml` rewritten as the single pipeline (pre-merge + post-merge jobs); `.github/workflows/cd.yml` deleted; `contract-drift.yml` untouched.
- **Dependencies**: remove semantic-release usage (`npx` in CD, `.releaserc.json`); add `commit-and-tag-version` as a devDependency.
- **Scripts**: new `version:prep` (write mode) and check mode used by CI; `package.json` version migrates `0.0.0` → current released version (`2.x`), establishing the invariant *main's package.json == last released tag*.
- **Source**: `src/interfaces/http/app.ts` and `src/interfaces/mcp/server.ts` stop hardcoding `1.0.0`; a small composition-layer version reader is introduced. The OpenAPI snapshot test gains version normalization.
- **GitHub settings**: branch protection/ruleset on `main` (PR required, required checks, up-to-date, linear history), merge methods restricted to rebase-merge. These are settings changes, documented in tasks, not code.
- **Docs**: `docs/development/development-workflow.md` CI/CD section updated to describe the new model.
