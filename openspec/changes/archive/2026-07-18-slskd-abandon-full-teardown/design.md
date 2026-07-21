## Context

The `slskd-resource-ledger` change made the app steward every slskd resource it creates: `SlskdDownload.doDownload` records each transfer write-ahead, captures its GUID on poll, and on every terminal outcome calls `removeOwned(username, mine, ownedKeys)` (`download.ts`) to cancel+remove the transfers and `markRemoved` their ledger rows. A startup `SourceResourceSweep` (`sweep.ts`) finishes removals still owed for acquisitions that have folded terminal, via `SlskdResourceRemover` (`resource-remover.ts`). Both call `client.delIfPresent(`…/{id}?remove=true`)`, which the ledger change described as "cancel+remove atomically" — but the slskd 0.22.5 source shows it is **not** atomic (see D1).

A live v2.2.1 acquisition (Daft Punk – RAM) exposed that this holds only for *terminal* transfers. The first candidate stalled at ~76% with files 04–13 still in flight; the app abandoned it. What survived:

1. **10 `Completed, Cancelled` transfer records in slskd's UI.** `removeOwned` does its `?remove=true` pass over `mine`, then unconditionally `markRemoved`s every `ownedKeys` row. For the in-flight transfers, `?remove=true` **cancelled** them (→ `Completed, Cancelled`) but did **not** remove the record — yet the ledger row was marked removed anyway, so `ledger.allLive()` no longer returns them and the sweep never retries. The record is stranded. The successful candidate, by contrast, was all-`Succeeded` (terminal) when `removeOwned` ran, so `?remove=true` removed each cleanly — which is why only the abandoned candidate lingers.
2. **≈706 MB of orphaned FLACs in staging.** Files 01–03 had *completed* before the stall; slskd moved them into `/app/downloads` (the shared staging dir). The abandon path returns `{ kind: 'failed' }` with no files; the domain, in `Downloading` state, mints `CandidateRejected` with `files = stagedFilesOf(Downloading) = []`, so `discardStaging([])` cleans nothing. (`?remove=true` removes the transfer *record*, not the on-disk file — confirmed by the successful import, which moved the still-present staged files after `removeOwned` ran.)

Both stem from one blind spot: at the moment a candidate is abandoned, its transfers are a mix of completed and in-flight, and neither the ledger nor the domain reconciles that mix — the ledger assumes removal succeeded, and the domain assumes nothing was staged.

## Goals / Non-Goals

**Goals:**
- An abandoned/aborted candidate leaves **no lingering source transfer record** — cancelled in-flight transfers are removed once terminal, or left live in the ledger so the sweep converges them.
- An abandoned/aborted candidate leaves **no staged residue** — files the source already completed are cleaned from the shared staging volume.
- Keep teardown best-effort and idempotent: it must never fail a working download, and a redelivered/retried teardown must converge, not error or double-clean.
- Keep the pure domain I/O-free; keep the slskd adapter free of direct filesystem deletes (staging is the library adapter's concern, D13).

**Non-Goals:**
- No change to the *successful* teardown path (already clean) beyond sharing the confirm-removal helper.
- No re-derivation of slskd's on-disk layout — the completed-file subset is resolved from the events API, exactly as the completed path already does.
- No new source dependency, no public-API contract change.

## Decisions

### D1 — Two-step teardown: cancel, wait for terminal, then remove — and confirm before marking the ledger row removed

**Confirmed against slskd 0.22.5 source.** `DELETE …/{id}?remove=true` is *not* atomic. The controller (`TransfersController.cs:82-92`) runs `Downloads.TryCancel(guid)` then, if `remove`, `Downloads.Remove(guid)` — two sequential calls. `TryCancel` only fires the cancellation token and returns (`DownloadService.cs:619`); the transfer transitions to `Completed | Cancelled` **asynchronously**, later, in the download task's `OperationCanceledException` catch (`DownloadService.cs:372`). `Remove` is **guarded on the terminal flag** — `if (!transfer.State.HasFlag(TransferStates.Completed)) throw new InvalidOperationException(...)` (`DownloadService.cs:598`) — and is a **soft delete** (sets `Removed = true`; touches no file on disk). So `?remove=true` on an *in-flight* transfer cancels it but the synchronous `Remove` hits a still-non-terminal state, throws, and never sets `Removed`; the record lingers as `Completed, Cancelled`. (The controller only catches `NotFoundException`, so that throw even surfaces as a 500 — which our `delIfPresent` re-raises and `removeOwned`'s per-transfer `try/catch` swallows, exactly reproducing the observed lingering records.) A *second* `?remove=true` once the transfer is terminal passes the guard and removes it.

Therefore teardown is **two-step**: cancel the transfer (`?remove=false` for an active one, to avoid the spurious 500), **poll until it carries the `Completed` flag**, then `?remove=true` to soft-delete the record. Already-terminal (e.g. `Completed, Succeeded`) transfers skip straight to the remove. Change both `removeOwned` and `SlskdResourceRemover.remove` to this, bounded by a small number of rounds, and **`markRemoved` a row only once its transfer is confirmed absent from the poll**. Rows not confirmed gone within the bound stay live in the ledger — the **startup sweep** retries them next boot (by then terminal, hence removable), restoring the safety net the ledger change intended.

*Why keep the sweep fallback rather than loop until gone.* Teardown must not block on a flaky/slow async transition; leaving unconfirmed rows live hands them to the sweep, which is exactly the mechanism for "removals we still owe". *Why `?remove=false` for the active cancel.* It avoids the guaranteed-500 that `?remove=true` throws on a non-terminal transfer; the removal is issued on the confirmed-terminal re-poll.

### D2 — Report the abandoned candidate's already-completed files, and clean them through the domain

At abandon time the adapter can see which of `mine` are `Completed, Succeeded`; it resolves their source-reported staged paths via the **same events resolver the completed path uses** (`resolveStagedPaths`), and returns them on the failed outcome: `DownloadResult` gains `{ kind: 'failed'; reason; files?: readonly DownloadedFile[] }`. `RecordDownloadFailed` carries those files; `decide` stamps them onto the `CandidateRejected` it already mints in `rejectAndAdvance`; `react`'s `Cleanup` (already files-carrying, D3) hands them to `LibraryPort.discardStaging`, which removes exactly those files and prunes the emptied leaf dir. The slskd adapter never touches the filesystem — cleanup stays the library adapter's job.

*Why thread through the domain rather than delete in the adapter.* The dependency rule keeps staging under the filesystem `LibraryPort` (D13); the slskd adapter is a `DownloadPort`. Reporting-then-cleaning reuses the exact D3 path already proven for rejected/imported candidates, so there is one cleanup mechanism, not two. *Additivity.* The new event/command field is optional; legacy history upcasts to `[]` (a no-op cleanup), consistent with the D3 fields already added.

### D3 — Resolve the completed subset best-effort; never let cleanup reporting fail the abandon

Resolving staged paths hits the events API and can lag or error. On the abandon path that must not turn a clean "failed, reason=Stalled" into an infra fault (which would wedge the retry loop on a already-doomed candidate). So the completed-subset resolution is best-effort: on any error it yields no files (the outcome is still `failed` with its real reason), and the orphaned files fall to a future staging reconciliation rather than blocking the retry. The record-removal confirm (D1) is likewise best-effort with the sweep as the backstop.

## Risks / Trade-offs

- **[slskd cancel/remove semantics — CONFIRMED from source]** ~~Assumed from observation~~ — resolved by reading slskd 0.22.5 (`TransfersController.cs:82`, `DownloadService.cs:372/598/619`): removal is guarded on the `Completed` flag and cancellation is async, so a two-step teardown is definitively required (see D1). No longer a risk; the implementation follows the confirmed mechanism. A live probe could add belt-and-suspenders confirmation but is not needed.
- **[Async transition timing]** The `Completed, Cancelled` transition lands asynchronously after `TryCancel`, so the re-poll may need a brief wait before the record is removable. → The bounded poll loop (with the existing poll interval) absorbs this; anything still not terminal within the bound falls to the sweep.
- **[Extra polls on the abandon path]** The confirm loop adds a bounded number of transfer polls per abandon. → Abandon is already the slow, off-happy-path outcome; the bound keeps it small, and the sweep absorbs anything left.
- **[Partial-file resolution lag]** The completed subset may not yet be in the events log at abandon time. → Best-effort (D3): unresolved files are simply not cleaned now; a follow-up staging reconciliation (out of scope here) or the next run's sweep-adjacent cleanup can retire them. No orphan is *worse* than today.
- **[Additive event field]** Another optional field on `CandidateRejected`/the failure command. → Consistent with the D3 fields; upcast to `[]`; covered by the totality/upcast tests already in place.

## Open Questions

- Should orphaned staged files that could not be resolved at abandon time be swept by a periodic **staging reconciliation** (list the staging volume, drop anything not owned by a live acquisition), rather than only cleaned inline? That would also retire pre-existing orphans (like the live-run residue). Proposed as a possible follow-up, not required for this change's core guarantee.
