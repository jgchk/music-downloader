# release-pipeline Specification (delta)

## ADDED Requirements

### Requirement: The version bump is an ordinary pre-merge change
The system SHALL compute the next semantic version and the corresponding CHANGELOG.md section from the conventional commits between the last release tag and the branch head, and SHALL carry that bump (package.json + CHANGELOG.md) as reviewable commits inside the pull request. No automation SHALL commit to `main` after merge.

#### Scenario: A release-worthy PR carries its own bump
- **GIVEN** a branch containing at least one `feat`, `fix`, `perf`, or breaking-change commit since the last release tag
- **WHEN** the developer runs the version-prep command
- **THEN** package.json's version is bumped per semver rules (breaking → major, feat → minor, fix/perf → patch) and CHANGELOG.md gains a section for the new version, as working-copy edits to commit into the PR

#### Scenario: A non-releasable PR makes no bump
- **GIVEN** a branch containing only non-releasable commits (e.g., chore, docs, test, refactor) since the last release tag
- **WHEN** the version-prep command runs
- **THEN** package.json and CHANGELOG.md are left identical to their merge-base content

#### Scenario: Version prep is idempotent
- **GIVEN** a branch on which version prep has already been applied and committed
- **WHEN** the version-prep command runs again
- **THEN** it recomputes from the merge-base baseline and produces byte-identical results, reporting nothing to change

### Requirement: CI verifies the bump without pushing
The pre-merge pipeline SHALL include a required check that validates the branch's version state — the recomputed next version matches package.json and CHANGELOG.md contains a section for it (or no bump is required and none is present) — and SHALL NOT push commits to the branch or hold any credential capable of doing so.

#### Scenario: Missing bump fails the check with instructions
- **GIVEN** a PR with releasable commits whose package.json still holds the last released version
- **WHEN** the version-check job runs
- **THEN** it fails and its output states the exact local command to run

#### Scenario: Correctly prepped PR passes
- **GIVEN** a PR whose package.json and CHANGELOG.md match the recomputed expectation
- **WHEN** the version-check job runs
- **THEN** it passes without modifying the branch

### Requirement: The post-merge pipeline is idempotent and never mutates the repository
The post-merge pipeline SHALL make no commits or file changes to `main` and SHALL be safely re-runnable: every releasing step is guarded so that a rerun of an already-released commit performs no duplicate action.

#### Scenario: Rerun of a released commit is a no-op
- **GIVEN** a `main` commit whose package.json version is already tagged
- **WHEN** the post-merge pipeline runs (or is manually re-run)
- **THEN** it completes successfully without creating tags, releases, or moving version-bearing image tags

#### Scenario: No commits appear on main from automation
- **WHEN** any post-merge pipeline run completes
- **THEN** the tip of `main` is the same commit that triggered the run

### Requirement: Nothing irreversible happens before all gates pass
The post-merge pipeline SHALL order its jobs so that the release tag, GitHub Release, and image publication occur only after the quality gate, the full test suite, the contract tests, and the out-of-process E2E gate (run against the exact image to be published) have all passed within the same pipeline run.

#### Scenario: E2E failure blocks the release entirely
- **GIVEN** a merge whose build passes quality and tests but fails the out-of-process E2E gate
- **WHEN** the pipeline run completes
- **THEN** no tag, no GitHub Release, and no image publication for that version exist

#### Scenario: Recovery releases the pending version
- **GIVEN** a prior run that failed a gate, leaving `main`'s bumped version untagged
- **WHEN** a subsequent pipeline run on `main` passes all gates
- **THEN** that pending version is tagged, released, and published normally

### Requirement: Every merge with releasable commits produces a release
On a green post-merge run, if `main`'s package.json version has no corresponding tag, the pipeline SHALL create an annotated tag `v<version>`, create a GitHub Release whose notes are that version's CHANGELOG.md section, and publish the container image.

#### Scenario: Release-worthy merge releases
- **GIVEN** a merged PR that bumped the version to X.Y.Z
- **WHEN** the post-merge pipeline passes all gates
- **THEN** tag `vX.Y.Z` exists, a GitHub Release `vX.Y.Z` exists with the CHANGELOG section as notes, and the image is published

#### Scenario: Chore-only merge releases nothing
- **GIVEN** a merged PR that made no version bump
- **WHEN** the post-merge pipeline passes all gates
- **THEN** no new tag or GitHub Release is created and no version-bearing image tag moves

### Requirement: Published images carry semantic version tags
The pipeline SHALL publish released images to the registry tagged with the full semver (`vX.Y.Z`), the minor line (`X.Y`), `latest`, and the commit `sha`; `latest` and the semver tags SHALL move only on a successful release.

#### Scenario: Image tags on release
- **WHEN** version X.Y.Z is released
- **THEN** the registry image for that commit is addressable as `vX.Y.Z`, `X.Y`, `latest`, and its `sha`

### Requirement: main's package.json equals the last released version
The repository SHALL maintain the invariant that the version in package.json on `main` is exactly the latest released tag, or — between a release-worthy merge and its green pipeline run — the next version about to be released.

#### Scenario: Invariant holds after release
- **WHEN** the post-merge pipeline releases vX.Y.Z
- **THEN** `main`'s package.json version is X.Y.Z

### Requirement: Trunk is protected to a PR-only, rebase-merge flow
The `main` branch SHALL accept changes only via pull requests that are up to date with `main` and have all required checks green; merges SHALL preserve linear history via rebase-merge; force pushes and direct pushes SHALL be rejected.

#### Scenario: Direct push is rejected
- **WHEN** a direct push to `main` is attempted
- **THEN** GitHub rejects it

#### Scenario: Stale branch cannot merge
- **GIVEN** a PR whose base has advanced (e.g., another PR claimed the same next version)
- **WHEN** a merge is attempted
- **THEN** GitHub requires the branch to be brought up to date first, after which version prep recomputes against the new baseline
