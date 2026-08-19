# Tasks — drift-signal-fidelity

Sequencing: the pure probe first (classification, backoff, `Retry-After`), then each drift
script onto it, then the workflow that routes the three outcomes, then the docs. Every task
touching code is red-first: write the failing test, watch it fail, then make it pass.

Task 0 is the triage of #184 itself and comes first, because if the live replay had shown real
drift this change would be the wrong change.

## 0. Triage the open drift issue

- [x] 0.1 Replay the recorded MusicBrainz request set against the live service and record the
      result. Done when every fixture is shown to conform (no schema edit, no re-record needed)
      or, if any genuinely drifted, this change is abandoned in favour of a schema/fixture fix.
      _All seven fixtures conform against live `musicbrainz.org`, including the two #184 named
      (`recording-lookup.json`, `release-group-no-official-browse.json`). Nothing drifted; the
      503s were the shared runner egress IP hitting MusicBrainz's per-IP rate limit. No schema
      or fixture is touched by this change._

## 1. The probe — pure, red-first

- [x] 1.1 Red: `scripts/drift/probe.test.ts` scenarios for the transient/terminal split — each
      of `408, 425, 429, 500, 502, 503, 504` classified transient; `404`, `410`, `401`, `403`,
      `400` classified terminal (drift). Then implement the classifier. Done when a status
      table drives the test rather than one hand-picked example per branch.
      _`it.each` over `TRANSIENT_STATUSES` itself, so widening the set cannot leave a member
      unasserted, plus a terminal table carrying `501`/`505` — a not-implemented operation is a
      statement about shape, not about load._
- [x] 1.2 Red: `Retry-After` parsing — delta-seconds, an HTTP-date in the future, an HTTP-date
      already past (⇒ no wait), and an unparseable value (⇒ fall back to backoff). Then
      implement. Done when the clock is injected, so no test sleeps.
      _Plus two the first draft got wrong and the tests caught: a negative delta-seconds, and an
      empty header — `Number('')` is `0`, which would have read as "retry immediately" and
      hammered a provider that told us nothing._
- [x] 1.3 Red: the retry loop — a transient status that clears on attempt 2 returns the
      response; exhausted attempts return `unavailable` naming the last failure; a transport
      fault (a rejected fetch) is transient too and is never allowed to escape as an exception;
      a `Retry-After` above the ceiling stops retrying immediately and reports the requested
      delay. Then implement `probe()`. Done when the recorded sleep schedule is asserted, not
      the wall clock.
      _`MAX_ATTEMPTS` is derived from `RETRY_BACKOFF_MS.length + 1` and the loop's "is there a
      backoff entry for this attempt?" IS its stopping condition, so the budget and the schedule
      cannot drift into disagreeing. A non-`Error` rejection is pinned too — undici is third
      party and may reject with whatever it likes._
- [x] 1.4 Red: outcome aggregation — `drift` beats `unavailable` beats `conforms`, and the
      exit codes are `1`/`2`/`0`. Then implement. Done when the mapping lives in one place both
      drift scripts read.
      _`worstOutcome` + `DRIFT_EXIT_CODES` in `scripts/drift/probe.ts`; all three checks import
      them, and `scripts/drift/run-check.sh` is the single place that turns a code into a word._

## 2. MusicBrainz drift check onto the probe

- [x] 2.1 Rewrite `packages/downloader/test/contract/drift/musicbrainz.ts` to classify each
      fixture replay as conforms / drift / unavailable through the probe, print a per-fixture
      line naming which, and exit with the aggregated code. Done when a run whose only failures
      are transient exits `2` and prints no `drift` line.
      _Verified against a local server answering 503: seven `?` lines, exit `2`, no drift
      section. Against one answering 404: seven `✗` lines, exit `1`._
- [x] 2.2 Point the User-Agent at this repository. Done when the URL it sends resolves.
      _`github.com/anthropics/music-downloader` → `github.com/jgchk/music-downloader`._
- [x] 2.3 Verify against the live service: the whole set still conforms and exits `0`.

## 3. plex.tv drift check onto the probe

- [x] 3.1 Rewrite `packages/web/test/contract/drift/plextv.ts` so a transient status on the PIN
      operations is `unavailable`, not `DRIFT`. Done when the expected-`404` assertion on a
      nonexistent PIN is untouched — that 404 is the contract, not a fault — and a 502 on PIN
      create no longer files an issue.
      _Verified against local servers: 502 → `UNAVAILABLE pin create`, exit `2`; 403 → `DRIFT
      pin create`, exit `1`._
- [x] 3.2 Verify against the live service: the PIN surface still conforms and exits `0`.

## 3b. slskd drift check onto the same vocabulary

This check *already* split "the consumed surface broke" (exit 1) from "the environment gave me no
spec to read" (exit 2) — the workflow simply threw the distinction away. The work here is to make
it speak the shared constants and to correct the one case filed on the wrong side.

- [x] 3b.1 Route its spec fetch through the probe, so a transport fault is unavailable rather than
      an unhandled rejection that exits `1`. Done when a dead `SLSKD_SPEC_URL` reports unavailable.
      _Verified: a dead port reports `could not fetch latest spec: fetch failed after 4 attempts`
      and exits `2`. Against a live `slskd/slskd:latest` container it still exits `0`._
- [x] 3b.2 Move "manifest does not hold against its own pinned snapshot" from exit `2` to exit `1`.
      Done when a self-contradicting checker is loud — it is a repo bug, not an outage, and quietly
      skipping the week is how #110 would have gone unnoticed.

## 4. The workflow routes the three outcomes

- [x] 4.1 Read each check's exit code into a step output (`conforms` / `drift` / `unavailable`)
      rather than a pass/fail `outcome`, keeping `pipefail` so `tee` cannot mask it. Done when
      an exit code of `2` from a step is observable to the later steps.
      _`scripts/drift/run-check.sh` reads `${PIPESTATUS[0]}` rather than relying on `pipefail`:
      with `tee` on the right, `$?` is tee's status, and pipefail's rightmost-failure rule is a
      boolean answer to a three-way question._
- [x] 4.2 Open or refresh the `contract-drift` issue, and fail the run, **only** when some
      check reports `drift`. Done when an all-`unavailable` run opens nothing.
- [x] 4.3 Emit a `::warning::` and a job-summary line for each `unavailable` check, naming the
      target. Done when an inconclusive week is visibly distinct from a conforming one in the
      Actions run list.
      _A summary table of all three targets, plus an explicit line saying a green run with an
      unreached provider is not a clean bill of health for it._
- [x] 4.4 Prove the exit code actually survives the `pnpm tsx … | tee` invocation the workflow
      uses. Done by running the pipeline locally against a script that exits `2`.
      _Exercised for exit `0`, `1`, `2` and `7`; `7` maps to `drift`, so a crashing checker
      stays loud._
- [x] 4.5 Stop the slskd readiness wait from failing the job. A container that never came up is an
      unavailable slskd; failing there reddens the run for the one reason this change decided is
      not worth reddening it, and skips the very steps that would have said so. Done when a
      not-ready slskd reports `unavailable` and the run stays green.
      _The wait sets `ready=true|false`; the check is skipped when not ready, and an empty step
      output is normalised to `unavailable` by the reporting step._

## 5. Docs and close-out

- [x] 5.1 Record the three-outcome vocabulary in `packages/downloader/test/contract/README.md`
      tier-2 section, including that a green run means "no drift found", not "provider
      reached".
- [ ] 5.2 Close #184 referencing the live-replay evidence from 0.1.
