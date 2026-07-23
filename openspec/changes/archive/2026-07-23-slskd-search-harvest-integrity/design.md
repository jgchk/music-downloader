# Design — slskd-search-harvest-integrity

## Context

The slskd search adapter (`SlskdSearch`) creates a search, polls its state every second until `isComplete` **or a 15s deadline**, then unconditionally harvests `/responses` and deletes the search. slskd's own search timeout is also 15s, and slskd (0.22.5) persists responses only when it finalizes a search — an in-progress search's `/responses` endpoint returns an empty array even while its state advertises `responseCount: 180`. So for any query that does not hit slskd's 250-response early-completion limit, the adapter's deadline fires first, the harvest reads zero rows, and the mid-flight `DELETE` rips the search row out from under slskd's still-running task (observed as `DbUpdateConcurrencyException` pairs in slskd's log). The empty harvest flows into the domain as a legitimate `RecordSearchCompleted` with no candidates, and `decide` currently exhausts immediately on an empty round without consulting `maxSearchRounds`. Net effect: a truncated infrastructure read is recorded as a permanent business fact ("nothing exists"), terminally killing acquisitions for widely-available music.

Reproduced end-to-end against production slskd on 2026-07-22; the same run confirmed that the identical search, harvested after completion, yields 73 gate-passing candidates (Plantasia) and 18 (MY SKYSCRAPER) under default policies.

Constraints: errors are values (`InfraError` via `ResultAsync`); the domain stays pure — the ladder decision (`selectNext`) already encodes try-next / re-search / exhaust; the reactor (post reactor-durability v3.4.0) already gives infra faults bounded retry with backoff and parking; the startup sweep (source-resource stewardship D1) already retires live ledger rows for resources the process abandoned.

## Goals / Non-Goals

**Goals:**

- A search harvest is trusted only when the source has confirmed the search complete and the harvest is self-consistent; anything else is a retryable infra fault.
- The adapter never deletes an in-progress search from the source.
- An empty (but genuine) search round spends search-round budget on the existing ladder instead of exhausting immediately.
- The newly-consumed `responseCount` field is witnessed by the contract tier.

**Non-Goals:**

- Env-configurable search timeout (the constructor's `SlskdConfig.searchTimeoutMs` override already exists for tests; composition keeps a hard default).
- Delayed/scheduled re-search (rounds re-run immediately; bounds are small).
- slskd upgrade (0.22.5 → 0.25.x) or slskd-side configuration changes.
- Resurrecting the two already-exhausted production acquisitions (they are terminal; re-request after deploy).

## Decisions

### D1 — Completion-gated harvest with a 60s deadline

`awaitCompletion` keeps polling until `isComplete === true`; the deadline no longer means "harvest whatever's there" but "give up and fault". The default deadline rises from 15s to **60s**: slskd finalizes its default 15s search at ~15–17s observed, so 60s is ~4× headroom while still bounding a wedged search. The early-completion path (response limit reached) is unaffected and stays fast.

*Alternative considered:* keep 15s and only add the fault path — rejected: every specific query would then fault and retry on round 1, tripling latency for the common case and leaning on retry budget for deterministic behavior.

### D2 — Deadline-while-in-progress is an `InfraError`, not an empty `Ok`

If the deadline elapses with the search still incomplete, `doSearch` returns an `infraError('slskd.search', …)` carrying the last observed state (`state`, `responseCount`) for diagnosis. The reactor's existing classification treats this as a retryable fault — a later retry creates a fresh slskd search. This is the classification rule from the misclassified-permanent family applied here: only a source-confirmed completed search may produce a business-fact result.

*Alternative considered:* return the partial harvest when non-empty — rejected: on slskd 0.22.5 the pre-finalize harvest is empty by construction, and "partial truth as whole truth" is exactly the defect class being removed.

### D3 — Self-consistency guard on the harvest

After completion, if the search state reports `responseCount > 0` but `/responses` yields zero responses, the harvest is contradicted by the source's own bookkeeping → `InfraError`. This catches slskd-side finalization failures (the "Failed to finalize search" case) independent of the timing race. `responseCount` is added to `slskdSearchStateSchema` as an optional field (tolerant reader); the guard only engages when the field is present — an absent field disarms it, which the adapter logs at `warn` so an slskd upgrade dropping the field is visible, and the contract tier asserts the field's *presence* in the recorded capture so a re-record that loses it fails loudly. A genuine zero — `responseCount: 0` (or absent) with zero responses — remains a valid empty business result.

*Accepted risk:* the guard is deliberately all-or-nothing. A partial truncation (`responseCount: 180`, harvest of 5) passes as trusted, because the two endpoints have not been proven count-equivalent and a stricter `<` comparison could false-fault every real search. Revisit if a partial-finalization failure is ever observed.

An adjacent integrity gate rides along: a create response without a search id is an incoherent read (the search could never be polled, harvested, or swept) and faults immediately instead of proceeding with an empty key.

### D4 — No mid-flight delete; faulted searches go to the sweep

The adapter deletes the search only on the harvest path. On either fault path (D2/D3) the search is left running/finalized on the source and its ledger row stays live; the existing startup sweep retires it at next boot. Deleting a finalized search later is already a tolerated no-op-style delete. This removes the operation that corrupts slskd's search task today.

*Trade-off:* between boots, faulted searches accumulate in slskd (a lightweight DB row each, bounded by fault frequency). Accepted; an in-process deferred delete adds concurrency for negligible benefit.

*Known compound gap (accepted):* the ledger `recordCreated` write stays best-effort. If that write fails *and* the search then faults, the search has no ledger row and is invisible to the sweep — a permanently orphaned slskd row, surfaced only by the ledger-failure warn. Blast radius is one lightweight row per double-failure; failing the whole search on a ledger blip would contradict the stewardship tier's "bookkeeping never fails a working search" contract, so the gap is documented rather than closed.

### D5 — Empty round rides the existing ladder

In `decide`'s `RecordSearchCompleted` branch, the empty-`ranked` case stops emitting `AcquisitionExhausted` directly and instead asks the ladder (`selectNext` semantics against the post-round state): working set empty → fresh `SearchRequested` while `searchRounds < maxSearchRounds`, else `AcquisitionExhausted`. With the default retry policy (3 rounds) an acquisition gets three genuine empty rounds before exhausting. Both emitted events already exist in the contract; only the choice between them changes. Soulseek result sets genuinely vary as peers come and go, so an immediate bounded re-search has real (if modest) expected value; the primary defense is D1–D3.

### D6 — Contract-tier witness for `responseCount`

The recorder script captures a completed search's state snapshot (which carries `responseCount`) alongside the existing responses fixture; a replay test parses it through `slskdSearchStateSchema`. Per contract rules, the newly-consumed field must appear in a recorded fixture, not only in hand-written unit stubs.

## Risks / Trade-offs

- [Host slskd configured with a search timeout above 60s would make every specific query fault] → the fault is retryable and logged at `warn` with the observed state, so it degrades to bounded retries rather than silent truncation; the deployment note documents keeping slskd's `searchTimeout` ≤ ~30s or raising `searchTimeoutMs` in composition.
- [Persistent slskd finalization failures cause repeated retries] → bounded by the reactor-durability retry budget and parking (v3.4.0); the acquisition parks visibly instead of exhausting falsely.
- [Longer worst case before exhaustion: up to 3 × 60s of searching plus retries] → acquisitions are autonomous/asynchronous; slower honest failure beats fast false failure.
- [Raised deadline lengthens the happy path if slskd's early-completion never fires] → normal completion is still ~15–17s; the deadline is a ceiling, not a wait.

## Migration Plan

No stored-data migration: new deciding only affects future `RecordSearchCompleted` commands; existing event streams replay identically (`evolve` untouched). Ship as a patch release; after deploy, re-request the two falsely-exhausted acquisitions (MY SKYSCRAPER, Plantasia) and verify they fulfil. Rollback is a plain image rollback — no schema or event changes to unwind.

## Open Questions

None blocking.
