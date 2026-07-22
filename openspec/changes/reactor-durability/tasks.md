## 1. Parked-effect store & backoff

- [ ] 1.1 Write failing tests for a durable parked-effects store (sibling to the checkpoint store): record `{ streamId, globalSeq, attempt, nextRetryAt }`, list due entries, clear on success; implement (SQLite, same file/discipline as checkpoints).
- [ ] 1.2 Write failing tests for the backoff policy (exponential with jitter, capped interval, wall-clock budget exhaustion signal; env-configurable); implement as a pure function.
- [ ] 1.3 Write failing tests for non-retryable classification: an error the adapter marks permanent short-circuits the budget and lands immediately (modeled failure or dead-letter); implement the classification seam.

## 2. Reactor: park, advance, retry

- [ ] 2.1 Write failing reactor tests: a retryable effect failure parks the stream and ADVANCES the global checkpoint; a subsequent unrelated stream's event is processed immediately (the isolation scenario); implement.
- [ ] 2.2 Write failing tests for per-stream ordering under park: later events of a parked stream queue behind it and dispatch in order after the parked effect succeeds; pin the no-leapfrog invariant (event N+1 of a parked stream can never dispatch while N is parked); implement.
- [ ] 2.3 Write failing tests for the retry scheduler: due parked entries re-dispatch with incremented attempt; success clears the entry; implement (reuse the existing fallback-poll timer seam).
- [ ] 2.4 Write failing tests for budget exhaustion: `ResolveMetadata` degrades to `RecordMetadataFailed` through the command path; an effect with no modeled failure moves to the dead-letter store; both log structured transitions; implement.

## 3. Stalled visibility

- [ ] 3.1 Write failing tests for the status read model exposing `stalled` (from dead-lettered park entries) additively on the view/DTO; implement (facade schema additive field + mapping).
- [ ] 3.2 Write failing tests for parked/dead-letter retention: resolved entries clear; aged stalled entries prune per policy; implement.

## 4. Startup re-drive

- [ ] 4.1 Write failing tests for the re-drive pass: after the catch-up drain, every non-terminal stream's current effect is re-derived from folded state and dispatched; terminal and awaiting-selection streams derive none; implement.
- [ ] 4.2 Write failing tests for the download adapter's reconcile-before-enqueue: an acquisition with a live ledgered transfer re-attaches (polling resumes, budgets restart); a lost transfer re-enqueues; implement against the slskd fakes.
- [ ] 4.3 Write failing tests that the re-drive pass is jittered/rate-limited and serialized per stream against live dispatch (no check-then-act race on the same acquisition); implement.
- [ ] 4.4 Extend the out-of-process restart e2e: kill mid-download, restart, assert the transfer is driven to an outcome (completed or timed out) rather than orphaned.

## 5. Contract, spec coverage & the gate

- [ ] 5.1 Contract additivity: the `stalled` view field and any facade changes covered by existing additivity guards; no wire breaks.
- [ ] 5.2 Ensure every scenario in the `acquisition-lifecycle` delta maps to a test (isolation, degrade, dead-letter, outage ride-out, resume-mid-download, resume-mid-resolution, paused-stays-paused, crash-window convergence).
- [ ] 5.3 Run `pnpm check` and `openspec validate reactor-durability --strict`; fix gaps.
- [ ] 5.4 Manually verify: submit a poisoned resolution (unroutable base URL in a dev config) alongside a healthy acquisition — the healthy one completes; restart mid-download in the e2e harness — the download resumes.
