## Why

Two production stalls (2026-07-22) exposed durability gaps the current spec not only permits but partly mandates. First, a permanently-failing effect classified as an infrastructure fault holds the reactor's single global checkpoint forever — the spec's own words ("the checkpoint is not advanced and the event is processed again") turn one poisoned acquisition into a queue-wide wedge, for the second time (invalid-mbid 400s in v3.1.0, null-status schema drift in v3.3.0). Second, the restart requirement guards against *duplicating* a mid-flight download but never requires *resuming* it: an acquisition whose transfer poller died with the process satisfies "not downloaded a second time" by never being driven again — stuck `Downloading` forever, with the stall/queue timeouts that would abort it running in the process that no longer exists.

## What Changes

- **Per-stream fault isolation.** A retryable effect failure parks *its acquisition's* stream (durable retry state with exponential backoff) while the global checkpoint advances past it — one poisoned effect never blocks other acquisitions' processing.
- **A retry budget with a modeled landing.** Parked effects retry with backoff up to a bounded budget; a budget exhausted degrades to the effect's modeled business failure where one exists (resolution → metadata failure) or to a dead-letter with the acquisition visibly marked stalled — never a silent infinite loop, never a silent drop.
- **Restart re-drive.** On startup, after the catch-up drain, the reactor re-derives the pending effect for every non-terminal acquisition from its folded state and re-dispatches it idempotently — a mid-flight download re-attaches to (or re-requests) its transfer and its stall/queue budgets restart; a pending resolution re-fires. `AwaitingManualSelection` correctly re-derives *no* effect (the pause is the state's meaning).
- **The `acquisition-lifecycle` restart/fault requirements are rewritten** to demand isolation, bounded retry, and resumption — replacing the wording that mandated infinite same-event retry and only forbade duplication.
- **Boot readiness.** Startup catch-up work (the drain and the re-drive) runs in the background after the runtime reports ready: the interface binds and serves requests immediately instead of waiting behind the backlog's effect execution (the 2026-07-22 incident put the UI down for the duration of an album download that ran inside boot).

## Capabilities

### New Capabilities

_(none — this hardens the existing lifecycle capability's guarantees)_

### Modified Capabilities

- `acquisition-lifecycle`: the "Processing survives restarts without duplicating effects" requirement is modified to also require resumption and per-stream fault isolation; a new requirement covers bounded retry with a modeled landing for permanently-failing effects.

## Impact

- **packages/downloader only**: reactor (drain/checkpoint/retry state), a durable parked-effects store beside the checkpoint store, the download adapter's re-attach path (reconciling via the ownership ledger), composition wiring. Domain untouched except possibly a modeled "stalled" surfacing decision (see design).
- The v3.3.1 hotfix (nullable MusicBrainz fields, bounded HTTP requests) removed today's *instances*; this change removes the *class*.
- Integrates with the pending `unified-attention-queue` change: a dead-lettered/stalled acquisition is a human-attention item; this change exposes the read model, that change surfaces it.
