---
name: "Workflow: Ship"
description: Run the full feature lifecycle for a drafted OpenSpec change — implement, review to convergence, archive, release-prep, PR + merge, wait for the image publish, deploy to homelab, verify live on flight.
argument-hint: "[change-name]"
category: Workflow
tags: [workflow, openspec, review, release, deploy]
---

Ship a drafted OpenSpec change end to end. This command assumes the change's artifacts (proposal, specs, design, tasks) already exist under `openspec/changes/<change>/`; it does not draft changes (use `/opsx:propose` for that).

**Arguments:** "$ARGUMENTS" — optional change name. If omitted, infer it the same way `/opsx:apply` does (`openspec status`; if exactly one active change, use it; otherwise ask).

**The one checkpoint:** this command pauses exactly once — after the PR is green, before merging. Everything else runs autonomously. On failure at any phase, stop and report rather than improvising; do not skip a phase to keep moving.

## Phase 0 — Preflight

1. Verify this is the jj-driven product repo (`jj root` succeeds). All VCS mutations here use `jj`, never `git` (read-only `git`/`gh` inspection is fine; the repo is colocated, so `gh` and `pnpm version:prep` work).
2. Resolve the change name and confirm it is ready to apply: `openspec status --change <name> --json` — artifacts complete, tasks pending (or partially done, which means "continue"). If artifacts are missing, stop and point at `/opsx:propose` or `/opsx:explore`.
3. Confirm a sane starting state: working copy based on `trunk()`, no unrelated in-flight work (`jj st`, `jj log -r 'trunk()..@'`). If unrelated changes are present, stop and ask.

## Phase 1 — Implement

Invoke the `opsx:apply` skill for the change and work it to `all_done`: tasks one at a time, test-first, checkboxes flipped as you go. Commit incrementally with `jj` using conventional commits (they drive versioning — the feature needs at least one `feat:`/`fix:` commit or no release will occur). Every commit must pass `pnpm check`.

## Phase 2 — Review to convergence

Loop, max 3 cycles:

1. Invoke the `review-all` skill over `trunk()..@`.
2. Fix **every Critical and Important finding** — these are hard blockers. Apply **Suggestions** when they are cheap and clearly right; use judgment on the rest and note skipped ones (with a one-line reason each) for the PR body.
3. Commit fixes (`jj`, conventional commits, `pnpm check` green), then re-run `review-all`.

Converged when a cycle reports zero Critical/Important findings. If not converged after 3 cycles, stop and present the surviving findings to the user.

## Phase 3 — Archive the change

Repo practice is to archive before the release commit. Invoke the `opsx:archive` skill for the change (it verifies task completion and spec sync, then moves the change to `openspec/changes/archive/YYYY-MM-DD-<name>`). Commit as `chore(openspec): archive <name>`.

## Phase 4 — Release prep

1. Run `pnpm version:prep`. It computes the next semver from conventional commits since the last release tag and rewrites `package.json` + `CHANGELOG.md` (idempotent; safe to re-run). If it reports no releasable commits, stop — something is wrong with the commit types (a feature must bump).
2. Review the diff (version + changelog section), then commit `chore(release): X.Y.Z`.
3. Record `X.Y.Z` — it is the image tag (`vX.Y.Z`) everything downstream keys on.

CI's required `version-check` re-runs `version:prep --check`, so this commit must be in the PR.

## Phase 5 — PR and merge

1. Create a bookmark and push: `jj bookmark create <change-name> -r @` then `jj git push --bookmark <change-name> --allow-new`.
2. `gh pr create --head <change-name>` with a concise body: what the change does, link to the archived OpenSpec change, review outcome (cycles run, anything consciously skipped). End the body with the standard Claude Code attribution line.
3. Watch required checks (`version-check`, `quality`, `test`): `gh pr checks <PR#> --watch`. `web-e2e` is advisory — note a failure but it does not block. If a required check fails, fix, commit, `jj git push --bookmark <change-name>`, and re-watch.
4. **CHECKPOINT — stop and ask the user to confirm the merge**, presenting: PR URL, version, one-paragraph summary, review-cycle summary, check status.
5. On confirmation: `gh pr merge <PR#> --rebase` (always pass the PR number explicitly — detached-HEAD breaks gh's branch inference; do not pass `--delete-branch`). Then `jj git fetch` and rebase/abandon local leftovers so trunk is clean.

## Phase 6 — Wait for the image publish

The push to main triggers the pipeline's release path: quality + test, then an out-of-process E2E gate against the freshly built image, then publish of `ghcr.io/jgchk/music-downloader:{vX.Y.Z, vX.Y, latest, sha}` and the GitHub release.

- Find the run on main (`gh run list --branch main --limit 3`) and watch it (`gh run watch <run-id>`).
- Confirm publish: `gh release view vX.Y.Z` succeeds.
- If the E2E gate fails, nothing was published or tagged (that ordering is deliberate). Stop, pull the failure logs, and report — do not deploy, do not blindly re-run.

## Phase 7 — Deploy to homelab

The deploy config lives in `~/Projects/homelab` (also a colocated jj repo — use `jj` there too). A push to its main fires a GitHub webhook that has Komodo run `DeployStackIfChanged` for the `music-downloader` stack on flight; `poll_for_updates` is the backup path.

1. In `~/Projects/homelab`: check `jj st` first. If there are pre-existing uncommitted changes, stop and surface them to the user — never fold unrelated local edits into the deploy commit.
2. Sync to latest main (`jj git fetch` + rebase working copy on trunk).
3. Edit `stacks/music-downloader/compose.yaml`: bump the image tag to `vX.Y.Z` (pin the exact semver, never `latest`).
4. Commit `chore(music-downloader): deploy vX.Y.Z (<short feature phrase>)` and push main with `jj git push`.
5. Do not restart or exec into the prod container yourself — the redeploy is Komodo's job.

## Phase 8 — Verify live

1. Poll `curl -fsS http://192.168.1.238:3000/health` (use the IP — the `flight` hostname resolves badly) until it returns `status: "ok"` **and** `version: "X.Y.Z"`, up to ~5 minutes. `503`/`degraded` names the failing module in the body; an old `version` means the redeploy hasn't landed — check Komodo before assuming failure.
2. Then verify the feature itself against the live instance, **right-sized to the feature**:
   - Derive what to check from the archived change's specs/proposal — the requirements say what "working" means.
   - If a smoke test proves it (an endpoint responds, a UI element renders, a field appears), do that and stop.
   - If the feature only proves out through a real flow (e.g. an acquisition or import path), exercise the actual flow via the web UI at `http://192.168.1.238:3000` (browser tools) or curl. Use real, valid inputs — never invalid IDs against live infra (a past invalid-mbid "test" wedged prod). Prefer flows that clean up after themselves; note any residue left behind.
   - Do not go overboard: verify the shipped behavior, not the whole product.
3. If verification fails, report precisely what was observed vs expected. Rollback (re-pinning the previous tag in homelab) is a user decision — propose it, don't do it unprompted.

## Final report

End with a summary: change name → version shipped, PR link, release link, review cycles + notable findings, deploy commit, verification performed and its outcome, and any loose ends (skipped suggestions, residue from verification, advisory-check failures).

**Guardrails**

- `jj` for all VCS mutations in both repos; `git` only read-only. `gh` for PR/run/release operations, always with explicit PR numbers / `--head`.
- Rebase-merge only; never merge with failing required checks; never bypass the pre-merge checkpoint.
- Never publish an image or tag manually — only the pipeline's gated release path does that.
- One lifecycle per invocation: one change, one version, one deploy.
- Stop-and-report beats improvising: unconverged reviews, failed E2E gates, degraded health, and unexpected homelab state all end the run with a report, not a workaround.
