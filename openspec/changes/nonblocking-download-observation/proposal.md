# Proposal: nonblocking-download-observation

## Why

A live incident (2026-08-02) showed one healthy-but-slow album download freezing the entire
downloader: the download effect blocks inside the reactor — enqueue on slskd, then poll in a loop
until the whole multi-file album settles — holding the single dispatch mutex for the transfer's
full duration (an hour at a slow peer's pace). Every other acquisition's searches, metadata
resolutions, and parked-effect retries queued behind it, and the UI silently diverged from slskd:
the in-flight acquisition showed only "candidate selected" while slskd was busily transferring,
and the acquisitions behind it looked dead. The same mutex also serializes `AbortDownload`, so an
in-flight download cannot be cancelled until it settles on its own.

`acquisition-lifecycle` already requires that one acquisition's *failing* effect not delay any
other acquisition. A slow success escapes that requirement through a hole — it is not a fault, so
nothing isolates it. This change closes the hole: no effect, healthy or failing, may block the
processing of other acquisitions.

The direction is backed by research (`docs/research/nonblocking-external-work-observation.md`):
prior art across EIP, saga/process-manager practice, Temporal, Kubernetes controllers, Erlang/OTP
supervision, and Sonarr's download-client tracking converges on the same shape — a dedicated
observer polls the external system and reports facts; the orchestrator never blocks on external
I/O; push signals are latency hints, never the guarantee (slskd durably records only successes —
failures, stalls, and hopeless queues are observable solely by sampling its API over time).

## What Changes

- The download port splits into a fast **start** command ("enqueue and watch with these budgets")
  and asynchronous **outcome delivery**: a download supervisor inside the slskd adapter owns the
  polling loop that today runs inside the reactor's dispatch, and reports one source-agnostic,
  candidate-level outcome fact (completed / failed-with-reason) when the watch settles.
- Reactor effects become uniformly short-lived. Download outcomes re-enter the core the way
  importer verdicts already do — translated into commands through the normal decision path, with
  the existing stale-outcome rejection unchanged. Parking remains a failure-retry mechanism only.
- The acquisition gains an honest **downloading phase**: a `DownloadStarted` event is recorded
  when the supervisor accepts the watch, the status read model exposes the phase, and history
  narrates it. Live transfer progress stays a read model fed by the supervisor (existing
  requirement, unchanged), and is no longer gated on the reactor being mid-dispatch.
- **Cancellation takes effect promptly**: aborting an in-flight download no longer waits for the
  transfer to settle; the abort dispatches immediately and the watch ends.
- Restart durability keeps its existing shape: the transfer-ownership ledger plus
  reconcile-before-enqueue re-attach rebuilds the supervisor's watches on boot; slskd remains the
  durable source of transfer truth (its persisted success log may serve as evidence/latency hint;
  the poll is the guarantee). The supervisor gets no event store of its own.

## Capabilities

### New Capabilities

_None — this change reshapes how existing capability behavior is delivered._

### Modified Capabilities

- `download-management`: download observation must not block the processing of other work;
  outcomes are delivered asynchronously as source-agnostic facts by an observer that owns the
  sampling cadence and executes the caller's stall/queue budgets; abort of an in-flight download
  takes effect promptly.
- `acquisition-lifecycle`: the isolation requirement is strengthened from "a failing effect" to
  "any effect" — long-running healthy work must not delay other acquisitions; the lifecycle gains
  a downloading phase (recorded start, status exposure, history narration); cancellation during
  an in-flight download aborts the transfer promptly.

## Impact

- `packages/downloader/src/adapters/slskd` — `SlskdDownload` reshaped into the supervisor
  (enqueue fast-path, internal watch loop, outcome emission); existing poll/stall/aggregate logic
  relocates rather than grows.
- `packages/downloader/src/application` — reactor's download dispatch becomes start-only; a
  download-outcome consumer translates supervisor facts into commands (verdict-consumer idiom);
  startup re-drive re-attaches watches; progress read model rewired to the supervisor.
- `packages/downloader/src/domain` — additive: `DownloadStarted` event and its decide/evolve
  handling; no changes to existing events or the failure taxonomy.
- Facade/BFF/web — additive status phase + history entry kind for downloading; UI shows live
  progress for in-flight downloads.
- Tests — unit tiers for supervisor timing via the deterministic timer; contract tier unchanged
  (same slskd endpoints consumed); e2e parity specs updated for the new phase copy (blast-radius
  audit required: history narration and Playwright scrapes).
- No breaking changes: all wire/facade additions are additive; no version bump decision here
  (feature → minor at ship time).
