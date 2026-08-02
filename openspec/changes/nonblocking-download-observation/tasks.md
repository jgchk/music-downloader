# Tasks: nonblocking-download-observation

Every production line follows a failing test (red first, per `testing.md`) — test tasks are
folded into each item, not batched at the end.

## 1. Domain — the downloading phase as a fact (additive)

- [x] 1.1 `DownloadStarted` event: failing decide/evolve tests first (recorded on enqueue
      acceptance after `CandidateSelected`; duplicate/stale starts rejected as modeled errors),
      then the event type, decide handling, and evolve fold.
- [x] 1.2 Status projection: failing tests for the downloading phase (a started-but-unsettled
      candidate folds to a downloading phase; settled outcomes leave it), then the projection.
- [x] 1.3 History projection: failing tests for the additive `download-started` entry kind
      (appears after `selected`, carries occurrence time; pre-existing streams fold without it),
      then the projection.

## 2. Download supervisor — the watch moves out of the dispatch

- [x] 2.1 Carve the watch loop out of `SlskdDownload.download()` into a supervisor unit with
      injected timer/clock: failing tests first for one watch's lifecycle (poll → aggregate →
      settle) using fake time; behavior parity with today's loop (stall budget, queue budget,
      doomed-candidate cancellation, teardown, staged-file resolution).
- [x] 2.2 Start port: failing tests first — start returns promptly after reconcile/re-attach +
      enqueue acceptance (modeled enqueue rejections stay synchronous), registers the watch and
      ledger ownership.
- [x] 2.3 Outcome port: failing tests first — a settling watch emits exactly one candidate-level
      outcome fact (completed with staged files / failed with source-agnostic reason); emission
      is single-shot per watch.
- [x] 2.4 Abort path: failing tests first — abort cancels owned transfers at the source and ends
      the watch promptly regardless of watch state; settle-side partial-staging cleanup intact.
- [x] 2.5 Progress registry: failing tests first — in-flight watches feed the existing progress
      read model port; progress for a settled/aborted watch is gone.
- [x] 2.6 Boot re-derivation: failing tests first — starting a candidate whose ledger rows exist
      and whose source transfers are already settled emits the outcome immediately
      (level-triggered re-emit); still-live transfers re-attach with fresh budgets.

## 3. Application — short dispatches and the outcome consumer

- [x] 3.1 Reactor download dispatch becomes start-only: failing reactor tests first — the mutex
      is released after start returns; a slow watch blocks no other stream's drain and no due
      parked retry (the incident's shape, as a test).
- [x] 3.2 Download-outcome consumer (verdict-consumer idiom): failing tests first — outcomes
      translate into the existing follow-on commands through `decide`; stale/duplicate outcomes
      (crash-window re-emit, outcome-after-cancel) are recorded and skipped without wedging.
- [x] 3.3 `AbortDownload` effect re-pointed at the supervisor: failing tests first — cancel
      during an in-flight watch dispatches promptly (no serialization behind the download).
- [x] 3.4 Startup re-drive: failing tests first — a mid-download acquisition re-drives into a
      supervisor watch (re-attach, no second download; budgets from resumption); the crash-window
      convergence scenarios still pass.
- [x] 3.5 Composition wiring: supervisor constructed in composition behind its ports; reactor,
      consumer, and progress read model wired; DI stays vanilla.

## 4. Facade, BFF, and web — the phase made visible (additive)

- [x] 4.1 Facade schema: failing contract-tier tests first for the additive status phase and
      `download-started` history entry; tolerant-reader compatibility of existing consumers
      asserted.
- [x] 4.2 BFF/UI: failing SSR/component tests first — downloading phase renders with live
      progress; history narrates the start in the established copy register; detail and list
      views distinguish transferring from selected.

## 5. Cross-tier verification

- [ ] 5.1 Blast-radius audit before the merge checkpoint: sweep `test/e2e` and Playwright parity
      specs for scraped copy/state-timing the new phase changes; update expectations.
- [ ] 5.2 E2E: extend the out-of-process scenario so a submitted acquisition is observed in the
      downloading phase while a second acquisition completes end-to-end (the head-of-line
      regression, black-box); cancellation mid-transfer verified prompt.
- [ ] 5.3 Local out-of-process e2e run against live slskd (`pnpm test:e2e`) green before PR
      (ship.md mandate).
- [ ] 5.4 Full gate (`pnpm check`) at every commit; 100% coverage with no fiction tests — timer
      determinism carries the time-based branches.
