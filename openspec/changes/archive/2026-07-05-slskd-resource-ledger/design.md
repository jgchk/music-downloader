# Design: slskd-resource-ledger

## Context

The slskd adapter creates remote resources (searches, download transfers) and never removes any of them. The only DELETE in the adapter is `abandon()`'s stall/queue-timeout cancel. Three consequences:

1. **Leaks**: searches accumulate on slskd forever (timed-out ones keep running server-side); settled transfer records accumulate forever; a cancelled-mid-download acquisition leaves the slskd transfer running and its staged files orphaned (the `react` guard deliberately skips cleanup for an unsettled transfer, and the post-cancel settle report is swallowed by `decide`'s terminal-state tolerance — so the "safe to clean now" moment is lost).
2. **Ghost-record corruption**: `SlskdDownload` identifies its transfers by `username` + remote-filename matching (`wanted`). Leftover records from a previous attempt of the same candidate match too; one stale failed record makes a fully successful re-download report failure (`aggregate.succeeded` requires *every* matched transfer to have succeeded).
3. **Shared-instance hazard**: the same name-matching claims transfers a human operator started manually on the shared slskd instance — our stall detection can wait on them, and `abandon()` can DELETE them.

The root cause is shared: ownership of remote resources is implicit (inferred by name) rather than recorded. slskd offers nothing to tag (searches carry only `searchText`, transfers only username/filename/id), so ownership must be recorded on our side.

slskd API facts (verified against the slskd source; re-verify against the live v0 API in e2e): `DELETE …/transfers/downloads/{username}/{id}` cancels an in-flight transfer (`TryCancel`); with `?remove=true` it also deletes the tracked record; `DELETE /api/v0/searches/{id}` removes a search. Transfer ids are GUIDs assigned by slskd and appear in polled transfer payloads.

## Goals / Non-Goals

**Goals:**

- Explicit, durable ownership of every slskd resource the app creates, recorded in SQLite next to the event store.
- All adapter observation and mutation of slskd transfers scoped to owned resources.
- Symmetric lifecycle on every path: searches deleted after harvest (including timeout), transfer records removed once settled (success, failure, abandonment, cancellation), transfers cancelled on acquisition cancellation, doomed candidates' remainders cancelled early.
- Deferred staging cleanup for cancel-during-download: cleanup fires when the transfer settles, through the normal domain protocol.
- A startup sweep that finishes *our own* unfinished removals only. Resources absent from the ledger are structurally unreachable.

**Non-Goals:**

- No GC or inspection of slskd resources the app did not create (shared instances are first-class).
- No stewardship for MusicBrainz (stateless reads, nothing created).
- No change to search semantics, ranking, validation, import placement, or public API.
- No attempt to resume in-flight downloads across process restarts (existing behavior: the replayed Download effect re-runs; see D6 for how the ledger absorbs the re-enqueue).

## Decisions

### D1: Ownership ledger as a SQLite table behind an application port

A `source_resources` table joins `events`/`checkpoints` in `src/adapters/sqlite/schema.ts` (idempotent `CREATE TABLE IF NOT EXISTS`, consistent with the existing schema bootstrap):

```
source_resources(
  source        TEXT NOT NULL,            -- 'slskd'
  kind          TEXT NOT NULL,            -- 'search' | 'transfer'
  resource_key  TEXT NOT NULL,            -- search id | username + '|' + remote filename
  resource_id   TEXT,                     -- slskd GUID once known (transfers; searches: same as key)
  acquisition_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  removed_at    TEXT,                     -- NULL = live (we may still owe slskd a removal)
  PRIMARY KEY (source, kind, resource_key, acquisition_id)
)
```

The port (`ResourceLedgerStore`, in `src/application/ports/`, following the `CheckpointStore` precedent for infra-owned ports) exposes: `recordCreated`, `recordId`, `markRemoved`, `liveByAcquisition`, `allLive`. The domain never sees the ledger — stewardship is an adapter concern; the decider's protocol (D4) is expressed purely in existing domain vocabulary plus one new effect.

*Alternatives considered*: tagging resources in slskd — impossible, no metadata fields; time-window matching — fragile and exactly the implicit-ownership mistake being removed; consumer-owned interface inside the slskd adapter — rejected because sqlite→slskd sideways imports fight the lint boundary rules, while application/ports already hosts infra ports.

### D2: Write-ahead for transfers, write-after for searches

- **Transfers**: the natural key (username + remote filename) is known *before* the enqueue POST, so the ledger row is written first (upsert — replays of the Download effect after a crash re-hit the same primary key rather than duplicating). No crash window: any enqueue slskd received has a ledger row.
- **Searches**: the id only exists after the POST returns; the row is written immediately after. The one-request crash window leaks at most a single search per crash-at-the-worst-moment, which is accepted — matching by `searchText` to close it could claim a human's identical search, the exact mistake this change removes.
- **Id capture**: transfer GUIDs are captured from the first poll that returns the owned natural keys (and from the enqueue response if the live API returns them — verify during implementation) via `recordId`. From then on, mutation (cancel/remove) targets exact ids.

### D3: Scoped observation — the ledger defines `mine`

The poll loop filters slskd's transfer payload to the ledger's live natural keys / captured ids for *this acquisition's current attempt*, instead of the ad-hoc `wanted` set. Combined with removal-at-settle (D5), previous attempts' records are gone from slskd before a retry starts, and anything not ours (a human's parallel download of the same file) is excluded once ids are captured. The pre-id-capture window (one poll tick) where a same-user-same-file human transfer could be misattributed is accepted and documented; it is strictly smaller than today's permanent misattribution.

`abandon()` likewise cancels only ledger-owned transfers, by id.

### D4: Domain protocol for cancellation — retain the pending candidate, reuse `CandidateRejected`

The current design encodes "unsafe to clean" as *absence* of the candidate in the `Cancelled` state, which also destroys the information needed to ever clean. Instead:

- **State**: the `Cancelled` variant gains an optional `pending` field. Cancelling from `Downloading` yields `Cancelled { pending: current }`; cancelling from `Validating`/`Importing` keeps today's `current` (settled, clean immediately); other phases carry neither.
- **React**: `AcquisitionCancelled` on `Cancelled` with settled `current` → `Cleanup` (unchanged); with `pending` → new effect `AbortDownload { candidate }`. Guards keep the redelivery-suppression property: once the pending candidate is rejected (below), the fold clears `pending` and a re-reacted `AcquisitionCancelled` emits nothing.
- **Decide**: `RecordDownloadCompleted`/`RecordDownloadFailed` arriving on `Cancelled` with `pending` returns `[CandidateRejected { candidate: pending.identity }]` instead of the blanket terminal `ok([])`. `CandidateRejected` already reacts with `Cleanup` unconditionally — cancellation becomes "reject the in-flight candidate once its transfer settles". On `Cancelled` without `pending`, terminal tolerance stays as-is (duplicate settle reports are absorbed).
- **Evolve**: `CandidateRejected` on `Cancelled` clears `pending` (tolerant total fold, consistent with the existing idiom).

No new event type is needed; the only additions are the `pending` field and the `AbortDownload` effect — additive on the aggregate's public contract. Old streams refold compatibly: a historical cancelled-while-downloading stream now folds to `Cancelled { pending }`, but its checkpoint is past, no ledger rows exist for it, and nothing re-reacts.

### D5: `AbortDownload` interpretation is self-contained; every settle removes records

`DownloadPort` gains `abort(candidate): ResultAsync<DownloadResult, InfraError>`. The slskd implementation: cancel owned live transfers (plain DELETE by id) → poll until all owned transfers are terminal → remove their records (`?remove=true`) → mark ledger rows removed → return `failed('Cancelled')`. The interpreter feeds that through `RecordDownloadFailed`, which lands on `Cancelled+pending` and triggers the deferred cleanup (D4).

Why self-contained rather than relying on the original in-flight poll loop to notice the cancellation: if the process crashed after `AcquisitionCancelled`, the replayed `CandidateSelected` is suppressed by the react guard (folded state is `Cancelled`), so no poll loop exists — the retried `AbortDownload` effect must be able to finish the job alone. When both do run, both report a settle; `decide` tolerates the second (`pending` already cleared). All slskd mutations involved are idempotent (cancel of a terminal transfer and remove of a missing record are tolerated no-ops in the adapter).

The same settle-removal applies on every path: the normal poll loop removes records after reporting completed/failed; `abandon()` cancels, awaits terminal, removes. This — not the scoping — is what kills ghost records at the source.

### D6: Doomed candidates settle early

In the poll loop, the moment any owned transfer is terminal-failed while others are still live, the remainder is cancelled (same mechanism as `abandon`). The loop still waits for everything to reach terminal state, then removes records and reports the *original* failure reason (the doom cause, not `Cancelled`) — `aggregate`'s first-failed-reason rule already yields this given the failed transfer precedes the cancelled ones; make the reason selection explicitly time-ordered rather than list-ordered if the payload order proves unstable.

### D7: Startup sweep — converge the ledger, touch nothing else

A composition-level step, run after schema bootstrap and *before* the reactor starts (no races with live effects): for every ledger row with `removed_at IS NULL` whose acquisition is terminal (folded from the event store), cancel-if-live and remove the resource on slskd, then `markRemoved`. Rows for non-terminal acquisitions are left alone — the reactor owns them. Resources slskd holds that have no ledger row are invisible to the sweep by construction; a human's searches and downloads are structurally unreachable. Sweep failures log and continue (per-row isolation); the next boot retries.

### D8: Searches deleted after harvest, on both exits

`doSearch` deletes the search (and marks the ledger row removed) after reading responses — on the completed path *and* the timeout path, where deletion also stops a search that would otherwise keep running server-side. Deletion failure is logged, the ledger row stays live, and the sweep retires it on next boot; the harvested candidates are still returned (deletion is stewardship, not part of the search outcome).

## Risks / Trade-offs

- [slskd API drift — routes/params verified against slskd master source, app targets v0] → e2e suite runs against a live slskd; add contract schema coverage for any newly consumed response shape (enqueue response, delete statuses). Verify `remove=true` behavior on in-flight vs terminal transfers there.
- [Pre-id-capture misattribution window (one poll tick) for a same-user-same-file manual transfer] → accepted; strictly better than today's permanent misattribution. Capture ids from the enqueue response if the live API provides them, shrinking the window to zero.
- [Two settle reporters race (in-flight loop vs abort effect): double record-removal, double command] → slskd removes are idempotent no-ops in the adapter; `decide` absorbs the duplicate command by design (D4).
- [Ledger and event store disagree after partial failures (e.g. DELETE succeeded, `markRemoved` write lost)] → re-removal is a tolerated no-op; the sweep converges any remaining live rows. The ledger is a stewardship record, never an input to acquisition decisions.
- [Sweep folds every terminal acquisition's stream at boot] → bounded by live ledger rows (normally zero after clean shutdowns), not by total history; acceptable.
- [Timed-out search deletion changes observable slskd state for operators who relied on inspecting past app searches] → intended behavior; the app's searches are ephemeral by design now.

## Migration Plan

Purely additive: new table via the existing idempotent schema bootstrap; new port + optional-free adapter wiring in composition; new effect and state field are additive on the aggregate contract; no event schema changes, no upcasters, no API version bump. Pre-existing leaked resources on slskd predate the ledger and are deliberately not touched (removing them would violate the never-touch-unowned rule; operators can clear them manually once). Rollback = revert; the extra table is inert.

## Open Questions

- Does the live v0 enqueue response carry transfer ids? (Determines whether the id-capture window is zero or one poll tick — implementation detail, both paths designed.)
- Should the sweep also delete the acquisition's staging directory for terminal acquisitions whose ledger rows were live (crash between abort and cleanup)? The domain path (D5) already covers all non-crash cases; the crash case leaves staging until the next `AbortDownload` retry fires off the replayed event, which the reactor guarantees (checkpoint unadvanced). Default: no extra sweep responsibility — verify the reactor retry covers it in an integration test.
