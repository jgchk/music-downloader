# Design: overhaul-release-pipeline

## Context

Today the repo has three workflows. `ci.yml` (quality + tests) runs on PRs and on pushes to `main`. `cd.yml` runs on pushes to `main` **in parallel with CI, not after it**: a `release` job runs semantic-release (bumps, writes CHANGELOG.md, commits back to `main` with `[skip ci]`, tags, creates the GitHub Release), then an `image` job builds the Docker image, runs the out-of-process E2E gate, and publishes to GHCR tagged `latest` + `sha`. `contract-drift.yml` is a scheduled tier-2 check and is out of scope.

Five defects drive this change:

1. CD is not gated on CI — a commit that fails lint or tests still releases.
2. The tag + GitHub Release are created *before* the E2E gate; an E2E failure leaves a released version with no image.
3. Post-merge automation mutates `main` (the CHANGELOG commit), the pattern this project wants to forbid.
4. Images carry no semver tag, and the artifact doesn't know its own version (`package.json` is permanently `0.0.0`; OpenAPI/MCP hardcode `1.0.0`).
5. CI work is duplicated on the merge commit while CD ignores its result.

Constraints: trunk-based dev with jj; conventional commits enforced; the constitution requires every commit to pass the gate and forbids breaking public contracts; the OpenAPI snapshot test guards the REST contract; solo maintainer (Claude drives most PRs).

## Goals / Non-Goals

**Goals:**

- Post-merge pipeline is idempotent: re-runnable at any time, never commits to `main`.
- Nothing irreversible (tag, release, image publish) happens before every check — including E2E — is green on that pipeline run.
- Version bump + CHANGELOG are ordinary reviewed changes inside the feature PR.
- Every merge with releasable commits releases; `main` is always releasable.
- Artifacts are versioned: GHCR tags `vX.Y.Z`/`X.Y`/`latest`/`sha`; the app reports its release version over OpenAPI and MCP.
- PR-only flow with required checks enforced by GitHub.

**Non-Goals:**

- No CI credentials that can push (no GitHub App / PAT); the bump is local tooling + a CI check. The App is the documented upgrade path if outside contributors arrive.
- No change to `contract-drift.yml`, the test pyramid, or the E2E suite itself.
- No npm publishing (package stays private); no multi-branch/prerelease channels.
- `/api/v1` contract versioning is untouched — release version and API contract version remain distinct concepts.

## Decisions

### D1 — Version is computed pre-merge by `commit-and-tag-version`, invoked through a dual-mode `version:prep` script

`commit-and-tag-version` (maintained standard-version successor) with `--skip.commit --skip.tag` does exactly "bump package.json + prepend CHANGELOG section" with one devDependency, no config, and the same conventional-changelog rendering pipeline semantic-release used — the existing CHANGELOG.md format continues unbroken.

A single script (`scripts/version-prep.ts` or shell, exposed as `pnpm version:prep` / `pnpm version:prep --check`) implements:

1. **Reset to baseline**: restore `package.json` and `CHANGELOG.md` to their content at `git merge-base origin/main HEAD`. This makes the computation a pure function of (main state, branch commits) — reruns are byte-identical, which is the idempotency guarantee.
2. **Releasable-commit guard**: scan `lastTag..HEAD` subjects/bodies for `feat|fix|perf`, `!`, or `BREAKING CHANGE:`. None → restore files and exit 0 (no bump). This restores semantic-release's "no release" semantics; commit-and-tag-version alone would patch-bump chore-only PRs.
3. **Bump**: run `commit-and-tag-version --skip.commit --skip.tag`.
4. **Mode split**: write mode leaves the modified files for the developer to commit into the PR; check mode fails (with copy-paste instructions) if the recomputed files differ from what the branch actually contains.

*Alternatives*: raw conventional-changelog primitives (same engine, 3 deps + more glue — the fallback if CATV dies); git-cliff (cleaner no-op semantics but a changelog format break + `cliff.toml`); release-it (an orchestrator with everything disabled — config sprawl); changesets (duplicates intent already in enforced conventional commits); semantic-release `--dry-run` (unsupported, log-scraping).

### D2 — No CI pushes to PR branches; CI only verifies

`GITHUB_TOKEN` pushes don't trigger workflows, so auto-bump-from-CI requires a GitHub App or PAT, plus loop guards, plus a bot commit on every release-worthy PR that forces a jj fetch+rebase. For a solo-maintainer repo the entire credential class can be deleted instead: the required `version-check` CI job runs `version:prep --check`. Forgetting to prep costs one red check and one local command. This also means the bump commit is authored, reviewed, and rebased like any other change — consistent with "every commit passes the gate."

### D3 — One workflow file, two trigger paths; release steps strictly after all gates

`ci.yml` becomes the single pipeline (rename to `pipeline.yml` or keep the name; `cd.yml` is deleted):

```
pull_request:
  version-check   → pnpm version:prep --check          (required)
  quality         → format · lint · typecheck · build  (required)
  test            → unit+integration @100% · contract  (required)

push to main:
  quality ┐
  test    ├─(needs)→ e2e-image → release
          ┘            │           │
                       │           ├─ guard: tag v$(pkg version) exists? → skip all release steps
                       │           ├─ annotated tag + push
                       │           ├─ gh release create (notes = CHANGELOG section for this version)
                       │           └─ docker push: vX.Y.Z · X.Y · latest · sha (reuses gha cache)
                       └─ build image once (load) · run out-of-process E2E against it
```

Job dependencies (`needs:`) replace the current two-parallel-workflows arrangement: nothing irreversible runs unless quality, test, *and* E2E are green on this very run. The E2E-then-publish structure of the current `image` job (build once, gha cache, publish without rebuild) is preserved. Concurrency group `release-main` without `cancel-in-progress` serializes main runs.

*Alternative considered*: keep two files with `workflow_run` chaining — rejected: `workflow_run` obscures status on the commit, complicates required-check wiring, and the split served no purpose.

### D4 — Post-merge idempotency via the tag-exists guard

The release job reads the version from the checked-out `package.json` (already bumped pre-merge). If `refs/tags/v<version>` exists, every release step no-ops (`released=false` job output; the semver/`latest` docker tags are skipped, though `sha` may still publish). This single guard makes the pipeline safely re-runnable and makes chore-only merges release no-ops by construction. Invariant established at migration: **`main`'s package.json version == latest released tag.**

### D5 — The artifact knows its version by reading package.json at runtime

A tiny reader in the composition layer (`createRequire`/`fs` read of `package.json`, cached) supplies the version to Fastify's OpenAPI `info.version` and the MCP server metadata. No Docker build-args needed — package.json ships in the image. The domain layer is untouched (this is composition/interface wiring).

The OpenAPI snapshot contract test normalizes `info.version` (replace with a fixed placeholder before comparing) so releases don't churn the snapshot; the `/api/v1` path prefix remains the guarded contract version.

### D6 — GitHub enforcement: ruleset on `main`, rebase-merge only

Branch ruleset: require PR, require status checks (`version-check`, `quality`, `test`), require branch up to date before merge, linear history, no force pushes, no deletions. Repo merge settings: rebase-merge enabled, merge-commit and squash disabled (squash would collapse conventional commits; rebase lands the exact SHAs that passed checks). Settings applied via `gh api` and documented in tasks so they're reproducible.

### D7 — Version-conflict handling between concurrent PRs is "rebase and recompute"

Two open PRs will both claim the same next version and conflict on package.json/CHANGELOG.md. The required up-to-date rule forces the second PR to rebase; `version:prep` then recomputes against the new baseline (reset-to-baseline makes this automatic). Accepted as good hygiene, not fought with tooling.

## Risks / Trade-offs

- **[E2E failure post-merge]** `main` can hold a merged, bumped, but unreleased version until fixed. → Accepted explicitly: nothing was tagged or published (guard order), so the next green run of the same pipeline releases it. This is the known cost of running E2E post-merge only.
- **[Forgetting `version:prep`]** Red `version-check` on the PR. → The check's failure message contains the exact command to run; ~10s cost, and it doubles as review signal that a PR is release-worthy.
- **[Human-edited CHANGELOG vs check mode]** Manual wording tweaks to the generated section would fail the byte-compare in check mode. → Check compares only that the recomputed *version* matches package.json and that the CHANGELOG contains a section for it, not byte equality of prose (design the check at that granularity).
- **[commit-and-tag-version abandonment]** Single-maintainer dependency. → It wraps conventional-changelog primitives; the fallback (compose the primitives directly) is documented in D1 and the script boundary (`version:prep`) isolates the swap.
- **[`sha`-tagged image without release]** If E2E passes but a later release step fails halfway, re-running is safe (tag guard), but a `sha` image may exist for an unreleased commit. → Harmless: `sha` tags are explicitly non-release channels; `latest` and semver tags only move on successful release.
- **[Release-notes extraction]** Parsing CHANGELOG.md for one version's section is mildly format-coupled. → CATV's output format is stable (`## [x.y.z]`/`# [x.y.z]` headings); extraction is a small awk/script with a test.
- **[chore(release) commits in PR history]** The bump commit type must not itself count as releasable or appear in the changelog. → `chore(release): x.y.z` is excluded by both the guard regex and the conventionalcommits preset.

## Migration Plan

Single PR (this change), which is itself the first PR through the new flow as far as possible:

1. Add `commit-and-tag-version`, the `version:prep` script, and set `package.json` to the currently released version (`2.0.0`, or whatever the latest tag is at merge time) — establishing the D4 invariant.
2. Rewrite workflows (single pipeline), delete `cd.yml` + `.releaserc.json`, drop semantic-release permissions.
3. Wire runtime version reader + OpenAPI/MCP usage + snapshot normalization.
4. Update `docs/development/development-workflow.md`.
5. After merge: apply the ruleset + merge-method settings via `gh api` (last, so this PR itself can land), then verify the next release-worthy PR end-to-end.

Rollback: revert the PR; the old `cd.yml` + `.releaserc.json` restore the previous behavior (tags created by the new pipeline remain valid — same `v*` scheme).

## Open Questions

- Check-mode granularity (byte-compare vs version-match + section-present) — leaning version-match + section-present per the risk above; finalize during implementation.
- Whether `sha`/`latest` docker tags should publish on non-release merges (chore-only) or only alongside releases — leaning: publish `sha` always (useful for debugging), move `latest` only on release.
