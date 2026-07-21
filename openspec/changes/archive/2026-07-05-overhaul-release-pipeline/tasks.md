# Tasks: overhaul-release-pipeline

## 1. Version tooling (pre-merge)

- [x] 1.1 Add `commit-and-tag-version` as a pinned devDependency; set package.json `version` to the latest released tag (currently `2.0.0` — re-check at implementation time) to establish the invariant *main's package.json == last released tag*
- [x] 1.2 Write failing tests for the version-prep script: releasable-commit detection (feat/fix/perf/`!`/`BREAKING CHANGE:`; `chore(release)` excluded), reset-to-baseline idempotency, no-bump path, and check-mode verdicts (missing bump fails with instructions; prepped branch passes; no-bump branch with clean files passes)
- [x] 1.3 Implement `scripts/version-prep` (write mode + `--check` mode) per design D1: fetch tags, reset package.json/CHANGELOG.md to merge-base content, guard, run `commit-and-tag-version --skip.commit --skip.tag`, report; check mode validates version-match + CHANGELOG-section-present (not byte equality)
- [x] 1.4 Expose `pnpm version:prep` and `pnpm version:prep --check`; document usage in the script's failure output (copy-paste command)

## 2. Runtime version self-knowledge

- [x] 2.1 Write failing tests: composition-layer version reader returns package.json's version; OpenAPI `info.version` and MCP server version equal it
- [x] 2.2 Implement the version reader in the composition layer; wire into `src/interfaces/http/app.ts` (OpenAPI info) and `src/interfaces/mcp/server.ts` (server metadata), removing the hardcoded `1.0.0` strings
- [x] 2.3 Normalize `info.version` in the OpenAPI snapshot contract test (fixed placeholder before compare); add a test proving a version change alone does not fail the snapshot

## 3. Pipeline rewrite

- [x] 3.1 Rewrite `.github/workflows/ci.yml` as the single pipeline (`pipeline.yml`): `pull_request` jobs `version-check` (runs `pnpm version:prep --check`), `quality`, `test`; `push: main` runs `quality`, `test`, then `release` via `needs:` (build once/load/gha cache + E2E gate + publish + tag in one job); concurrency group serializing main runs without cancel-in-progress
- [x] 3.2 Implement the `release` job: tag-exists guard on `v$(package.json version)` → skip outputs; annotated tag + push; CHANGELOG section extraction; `gh release create --verify-tag --notes-file`; permissions `contents: write` + `packages: write` only
- [x] 3.3 Add semver image tags to `docker/metadata-action` (`vX.Y.Z`, `X.Y`, `latest`, `sha`), gated on the release-guard output so `latest`/semver move only on release (chore-only merge publishes nothing)
- [x] 3.4 Delete `.github/workflows/cd.yml` and `.releaserc.json`; verify no semantic-release references remain (workflows, docs, package.json)

## 4. Documentation

- [x] 4.1 Update `docs/development/development-workflow.md` CI/CD section: pre-merge (version prep + quick checks) vs post-merge (full gate + E2E + idempotent release), the package.json/tag invariant, and the local `pnpm version:prep` step
- [x] 4.2 Note the GitHub App upgrade path (auto-push bumps if outside contributors arrive) as a deliberate non-goal, so the decision is discoverable

## 5. Land and enforce

- [x] 5.1 Run `pnpm check` (green: 100% coverage, contract + release-tooling tiers pass). Opening the PR is a VCS action left to the maintainer (jj-driven; this PR is the first consumer of `version-check` and carries a `feat`-driven bump — run `pnpm version:prep` on the branch before pushing).
- [x] 5.2 After merge and a green post-merge run, apply GitHub settings (outward, hard-to-reverse — run by the maintainer). Exact commands:
  ```sh
  # Merge methods: rebase-merge only
  gh api -X PATCH repos/{owner}/{repo} \
    -F allow_merge_commit=false -F allow_squash_merge=false -F allow_rebase_merge=true \
    -F delete_branch_on_merge=true

  # Branch ruleset on main: PR required + up-to-date + required checks + linear history, no force/deletion
  gh api -X POST repos/{owner}/{repo}/rulesets \
    -f name='main-protection' -f target='branch' -f enforcement='active' \
    -f 'conditions[ref_name][include][]=refs/heads/main' \
    -f 'rules[][type]=deletion' \
    -f 'rules[][type]=non_fast_forward' \
    -f 'rules[][type]=required_linear_history' \
    -f 'rules[][type]=pull_request' \
    -f 'rules[][type]=required_status_checks' \
    -f 'rules[][parameters][required_status_checks][][context]=version-check' \
    -f 'rules[][parameters][required_status_checks][][context]=quality' \
    -f 'rules[][parameters][required_status_checks][][context]=test' \
    -f 'rules[][parameters][strict_required_status_checks_policy]=true'
  ```
  (The `required_status_checks` shape may need the ruleset JSON passed via `--input` rather than `-f`; verify against `gh api repos/{owner}/{repo}/rulesets` after applying.)
- [x] 5.3 Verify end-to-end on the next release-worthy PR: red `version-check` before prep, green after; post-merge run tags/releases/publishes semver image; re-run the pipeline and confirm the tag guard no-ops
