## Why

A live production acquisition (v2.2.1) revealed that when a multi-file candidate is **abandoned mid-download** (a stall, a queue timeout, or a cancellation), the app tears it down only partially. Two kinds of residue survive, both from the same cause — the domain and the ledger never learn the true state of an in-flight candidate's transfers at the moment it is dropped:

- **Lingering source records.** slskd's `DELETE …?remove=true` on an *in-flight* transfer only **cancels** it (→ `Completed, Cancelled`); the record is not removed in that call (removal lands only once a transfer is terminal). But `removeOwned` marks the ledger row removed **unconditionally** right after, so the startup sweep's `allLive()` never returns it — the cancelled record is stranded in slskd's UI forever (verified live: 10 `Completed, Cancelled` rows from the abandoned peer).
- **Orphaned staged files.** Files that *completed* before the abandon were moved by the source into the shared staging dir. The domain never saw a `DownloadCompleted` for the abandoned candidate, so its `CandidateRejected` carries no files and `discardStaging([])` is a no-op — leaving partial FLACs (≈706 MB in the live run) orphaned on the staging volume. (`?remove=true` removes the transfer *record*, not the file.)

This is the `slskd-resource-ledger` stewardship path (shipped separately), surfaced by the `slskd-report-staged-location` E2E; a successful candidate is torn down cleanly, so the gap is specific to the abandoned/aborted path.

## What Changes

- The transfer-removal teardown (`removeOwned` / abort / abandon) **confirms** each owned transfer is actually gone from the source before marking its ledger row removed: after the cancel pass it re-polls and re-issues `?remove=true` for any now-terminal record still present, bounded and idempotent. Rows not confirmed gone stay live, so the **startup sweep retries them** (by then terminal, hence removable) instead of being falsely marked done.
- An abandoned/aborted candidate's **already-completed files** are cleaned from staging: the adapter resolves the completed subset's source-reported locations (the same events resolution the completed path uses) and reports them on the failed outcome, so the domain's existing `discardStaging` removes them — no orphaned partial files.
- No new source dependency; no public-API contract change. A small domain/event addition threads the abandoned candidate's partial staged files to cleanup, mirroring the D3 pattern already used for rejected/imported candidates.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `source-resource-stewardship`: a transfer cancelled while in-flight must be **removed** from the source, not left as a lingering cancelled record; the ledger row is marked removed only once the source confirms the record is gone, so the startup sweep converges any that linger.
- `download-management`: an abandoned or aborted candidate's files that the source had already completed into staging must be cleaned up, not orphaned — cleanup targets the source-reported locations of that partial set.

## Impact

- `src/adapters/slskd/download.ts` — `removeOwned` gains a confirm-and-retry removal loop; `abandon`/`doAbort`/the doomed-failure path resolve the completed-file subset and surface it for cleanup.
- `src/adapters/slskd/resource-remover.ts` — the sweep's removal likewise confirms the record is gone before the sweep marks the row removed (shared teardown semantics).
- `src/application/ports/outbound-ports.ts` — `DownloadResult`'s `failed` variant carries the abandoned candidate's partial staged files.
- `src/domain/acquisition/{commands,decide,events}.ts` — `RecordDownloadFailed` / `CandidateRejected` thread those partial files so `discardStaging` cleans them (additive, D3-style; legacy history upcasts to none).
- `src/application/acquisition/interpreter.ts` — passes the partial files from the failed outcome into the command.
- Tests across the above plus a contract/E2E assertion that an abandoned candidate leaves no lingering source record and no staged residue.
