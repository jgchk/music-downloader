# Proposal: drift-signal-fidelity

## Why

The weekly drift job has filed two issues in its life and **both were false positives**.

- **#110** (2026-07-27) — `ERR_MODULE_NOT_FOUND`: the workflow invoked the scripts from the
  wrong working directory. No live response was ever fetched.
- **#184** (2026-08-17) — two MusicBrainz requests answered `HTTP 503`. Replaying the exact
  same request set against live `musicbrainz.org` today, all seven fixtures conform. Nothing
  drifted; MusicBrainz rate-limits per IP, GitHub-hosted runners share their egress IPs with
  every other Actions customer, and a 503 there says nothing whatsoever about our contract.

A detector whose entire alert history is noise is a detector nobody reads, and the cost is not
hypothetical: a real dropped field would arrive in a channel already trained to be ignored. The
defect is that the job **conflates two different facts** — "the provider's shape changed" and
"we could not reach the provider" — and reports both as drift, with the same red run and the
same tracking issue.

The scripts also under-invest in reaching the provider at all: MusicBrainz gets one retry at a
flat 2 s, ignores `Retry-After`, and identifies itself with a User-Agent pointing at a
repository that does not exist (`github.com/anthropics/music-downloader`) — the opposite of the
identification etiquette MusicBrainz asks of anonymous clients, and a plausible contributor to
being throttled in the first place. `plextv.ts` has the same latent bug from the other end: it
labels any non-2xx `DRIFT`, so a plex.tv 502 would file the same false issue.

## What Changes

- **A third outcome.** Each drift check reports `conforms`, `drift`, or **`unavailable`**, and
  says which by exit code (`0` / `1` / `2`). Only `drift` fails the run and opens or refreshes
  the `contract-drift` issue. `unavailable` leaves the run green and surfaces as a workflow
  `::warning::` plus a job-summary line naming the target and the reason.
- **Unreachable is not the same as gone.** A transient status (408, 425, 429, 500, 502, 503,
  504) or a transport fault is `unavailable`. A `404`/`410` on a request that was recorded
  answering `200` is **drift** — the operation was removed, which is precisely the kind of
  change the job exists to catch.
- **A shared, tested probe.** `scripts/drift/probe.ts` holds the retry/backoff/classification
  logic once, unit-tested in the tooling tier, and both drift scripts use it. It honours
  `Retry-After` (delta-seconds and HTTP-date), retries transient outcomes with exponential
  backoff, and caps its own patience.
- **Honest identification.** The MusicBrainz User-Agent names this repository.

## Impact

- `openspec/specs/external-api-contracts` — the drift-detection requirement gains the
  inconclusive outcome; the MusicBrainz requirement gains the etiquette obligation.
- `scripts/drift/probe.ts` (new, with `probe.test.ts` in the existing tooling tier).
- `packages/downloader/test/contract/drift/musicbrainz.ts`,
  `packages/web/test/contract/drift/plextv.ts` — classify through the probe.
- `.github/workflows/contract-drift.yml` — routes the three outcomes.
- `packages/downloader/test/contract/README.md` — documents the outcome vocabulary.

No runtime code changes. No public contract changes. The commit gate is untouched: this is
tier-2 tooling that has never gated a commit and still does not.

Issue #184 itself is closed by this change with no schema or fixture edit, because the live
replay proves there is nothing to edit.
