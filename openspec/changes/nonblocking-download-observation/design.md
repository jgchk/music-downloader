# Design: nonblocking-download-observation

## Context

See `proposal.md` for motivation and `docs/research/nonblocking-external-work-observation.md`
for the full prior-art comparison this design rests on.

Current machinery this design builds from (not restated in full):

- The reactor (`application/acquisition/reactor.ts`) drains all streams under one dispatch mutex;
  parked effects are its durable failure-retry mechanism. Today `SlskdDownload.download()` runs
  its entire enqueue-then-poll-until-settled loop inside one dispatch, holding that mutex.
- The verdict consumer (`interfaces/events/verdict-consumer.ts`) already ingests external facts,
  translates them into commands through `decide`, and records-and-skips stale rejections.
- The slskd adapter already owns a transfer-ownership ledger, reconcile-before-enqueue re-attach,
  per-file→candidate aggregation, stall/queue judgment against caller budgets, and an injected
  deterministic timer.
- slskd durably records successes only; failures/stalls/queue-hopelessness are observable solely
  by sampling its transfers API. Its push delivery is best-effort. Sampling is therefore
  irreducible; this design decides where it lives.

## Goals / Non-Goals

**Goals:**

- Reactor dispatches are uniformly short-lived; no effect holds the mutex for the duration of
  external work.
- Download outcomes re-enter the core as facts through the existing consumer idiom.
- The watch (sampling cadence, budget judgment, aggregation) is encapsulated in one place with a
  source-agnostic outward face.
- Restart durability keeps its current shape (ledger + reconcile re-attach, level-triggered).

**Non-Goals:**

- No push-channel integration (slskd webhooks/SignalR). The poll is the guarantee; a push hint
  can be added later without changing this design's contracts.
- No durable watch budgets across restarts (budgets reset on re-attach, as today). If that ever
  proves unacceptable, a `watchStartedAt` ledger column is the targeted follow-up.
- No second event store. slskd holds durable transfer truth; the supervisor holds none.
- No change to candidate selection, validation, import, or the failure taxonomy.

## Decisions

### D1 — The watch moves into a download supervisor (an actively-observing adapter)

The slskd adapter gains a supervisor that owns the polling loop currently inlined in
`download()`. The reactor's download effect becomes "start": reconcile/re-attach, enqueue,
record ledger ownership — then return once the source has accepted (or synchronously reject with
the existing modeled enqueue-rejection reasons). The supervisor then watches the candidate on its
own cadence and, when the watch settles, emits one candidate-level outcome fact.

Alternatives considered (full analysis in the research doc): per-stream mutexes (leaves
blocking-during-watch and abort serialization intact per stream; complects reactor invariants),
park-and-repoll (overloads the parked-effect mechanism — "unhealthy effect backing off" braided
with "healthy work on cadence" across every consumer of the park table; abort latency coupled to
poll cadence), repoll-ticks-as-events (scheduling intentions are not facts; violates
`event-sourcing.md`), push-primary (impossible — the source has no failure vocabulary). The
supervisor shape is the convergent prior-art pattern (EIP channel adapter + polling consumer,
Temporal activity, Sonarr's download monitoring) and leaves each existing concern where it is.

### D2 — Outcomes re-enter through a download-outcome consumer (verdict-consumer idiom)

The supervisor's outward face is a narrow outcome port: completed (with staged files) or failed
(with the existing source-agnostic reason). An application-layer consumer translates each
outcome into the same follow-on commands the blocking path issues today, through `decide`, which
already arbitrates staleness (cancel-vs-outcome races, duplicate delivery) by state and records
and skips rejections. No new decision logic; the delivery path changes, not the decisions.

### D3 — At-least-once outcome delivery via boot re-derivation, not a supervisor outbox

If the process dies between a watch settling and the outcome being recorded, the startup
re-drive already re-derives the pending effect from folded state: re-dispatching "start" finds
the ledger rows and the source's settled transfers, and the supervisor immediately re-emits the
outcome (level-triggered — current state, not missed edges). This is the existing
reconcile-before-enqueue guarantee relocated, so the supervisor needs no durable outbox. The
crash-window convergence scenarios in `acquisition-lifecycle` cover the duplicate-delivery side.

### D4 — `DownloadStarted` is a domain event; progress stays ephemeral

Enqueue acceptance is a business fact (the source committed to this candidate) and drives the new
downloading phase and history entry — additive in decide/evolve, the facade schema, and the
BFF/UI. Per-poll progress remains an in-memory read model now fed by the supervisor's registry
(satisfying the existing `download-management` progress requirement verbatim); no per-tick
events, matching the history-curation requirement.

### D5 — Abort goes straight to the supervisor

`AbortDownload` becomes a short dispatch: cancel owned transfers at the source, end the watch.
It no longer serializes behind an in-flight download's dispatch (there no longer is one). The
supervisor's settle-side cleanup (staged partial files) is unchanged.

### D6 — The supervisor is an effectful class behind a port, constructed in composition

It has real identity (live watches, timer subscriptions, progress registry) — the case
`design-principles.md` reserves classes for. The domain never sees it; the reactor sees only the
start/abort port; the outcome consumer sees only the outcome port. Watch loops share the injected
deterministic timer, so every time-based judgment stays unit-testable by advancing fake time
(same technique as today's stall tests), keeping the 100% gate feasible without fiction tests.

## Risks / Trade-offs

- [Duplicate outcome delivery (crash window, boot re-emit)] → arbitration already exists:
  `decide` rejects stale/duplicate follow-ons and the consumer records-and-skips; scenarios
  specced.
- [Watch budgets reset on restart] → accepted, matches today's behavior and the restart spec's
  "budgets apply from resumption"; `watchStartedAt` ledger column is the follow-up if needed.
- [Outcome/cancel race] → both paths converge on `decide` by state; the cancelled acquisition
  remembers its pending candidate until settlement cleanup (existing requirement, unchanged).
- [Rollback after new events recorded] → an older build's fold does not know `DownloadStarted`;
  rolling back past this version after new acquisitions ran is not supported (standard for
  additive domain events here — roll forward instead).
- [UI copy / phase-timing blast radius] → the new downloading phase changes scraped values;
  audit `test/e2e` and Playwright parity specs before the merge checkpoint (the e2e gate runs
  only on main).
- [Supervisor concurrency] → watches are per-candidate and independent; the ledger keys
  ownership per acquisition, and outcome emission per watch is single-shot, so no cross-watch
  coordination exists to get wrong.

## Migration Plan

No event-store migration: `DownloadStarted` is additive; existing streams fold unchanged and
pre-existing acquisitions simply lack the new history entry. Deploy as a normal minor release.
In-flight downloads at deploy time resume through the existing restart re-drive (re-attach via
ledger), now landing in the supervisor. Rollback is safe only before new events are recorded;
after that, roll forward.

## Open Questions

None blocking. (Poll cadence stays `pollIntervalMs` as configured today; push-hint integration
and durable watch budgets are explicitly deferred follow-ups.)
