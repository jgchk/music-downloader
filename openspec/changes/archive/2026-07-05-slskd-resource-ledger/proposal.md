# Proposal: slskd-resource-ledger

## Why

The app never removes anything it creates on slskd: searches are never deleted (timed-out ones keep running server-side), settled transfer records are never removed, and cancelling an acquisition mid-download neither cancels the slskd transfers nor ever cleans the staged files. Because the adapter also identifies "its" transfers by username+filename matching, leftover records from a previous attempt of the same candidate silently corrupt later download outcomes (a stale failed record makes a fully successful re-download report failure) — and on a shared slskd instance the same matching can claim, stall on, and even delete a human operator's manual transfers. Ownership of remote resources is implicit where it must be explicit.

## What Changes

- **Ownership ledger.** An adapter-private SQLite ledger records every slskd resource the app creates (searches, download transfers), keyed to the acquisition, with created/removed lifecycle timestamps. Downloads are recorded write-ahead (their username+filename key is known before enqueue); searches are recorded once slskd returns the id.
- **Scoped observation and abandonment.** Download polling, aggregation, and `abandon` cancellation act only on ledger-owned transfers for the current attempt — never on name-matched strangers. Fixes the ghost-record outcome corruption and makes the adapter safe on a shared instance.
- **Cancellation aborts the download.** Cancelling an acquisition in the downloading phase cancels the owned slskd transfers; the settled outcome then triggers deferred staging cleanup (the pending candidate is rejected and its staging discarded) instead of being silently swallowed. The domain's `Cancelled` state retains the pending candidate identity until its transfer settles.
- **Searches are deleted after harvest**, including searches abandoned at the poll timeout (which today keep running on the slskd side).
- **Transfer records are removed once settled** — on completion, failure, abandonment, and cancellation — so slskd's transfer list stays clean and future attempts see only their own transfers.
- **Doomed candidates settle early.** Once any file of a candidate fails, the remaining owned transfers are cancelled instead of downloading a release that will be rejected wholesale.
- **Startup sweep of our own leftovers only.** On boot, ledger rows still marked live whose acquisition is terminal (crash windows, partial abandons) are removed from slskd and marked removed. Resources absent from the ledger are structurally untouchable.

Non-goals: no cleanup or GC of slskd resources the app did not create; no change to search/ranking semantics, validation, or import placement; no new public API surface.

## Capabilities

### New Capabilities

- `source-resource-stewardship`: the system tracks every remote resource it creates on a music source (searches, transfers) in a durable ownership ledger, removes each resource once its purpose is served, converges leftover ledger entries at startup, and never acts on remote resources it does not own.

### Modified Capabilities

- `acquisition-lifecycle`: cancellation of a downloading acquisition now actively aborts the in-flight source download; a late settled outcome arriving after cancellation is no longer wholly ignored — it triggers rejection of the pending candidate (and thereby staging cleanup) while the acquisition remains cancelled.
- `download-management`: a candidate's transfers are identified by ownership (the ledger), not name matching, so concurrent or historical transfers for the same user/files cannot pollute the outcome; when any file of a candidate fails, the remaining transfers are cancelled rather than downloaded to completion.
- `library-import`: the "cancelling during an in-flight transfer does not attempt cleanup" carve-out is replaced — cleanup is deferred until the transfer settles, then performed; the staging area no longer accumulates orphans from mid-download cancellations.

## Impact

- **Domain** (`src/domain/acquisition/`): `Cancelled` state variant retains the pending candidate; new `AbortDownload` effect from `react` on cancellation; `decide` turns a post-cancellation download outcome into `CandidateRejected` instead of `ok([])`; new event to record the deferred settlement.
- **Application** (`src/application/`): `DownloadPort` gains an abort capability; interpreter handles the new effect; a new outbound port (or port widening) for the ledger-backed stewardship operations.
- **Adapters** (`src/adapters/slskd/`, `src/adapters/sqlite/`): new SQLite ledger table + store; `SlskdDownload` records ownership write-ahead, scopes `mine`/`abandon` to owned transfers, removes settled records, cancels doomed remainders; `SlskdSearch` records and deletes searches (also on timeout). slskd DELETE semantics (cancel vs `remove=true`) must be verified against the live API and covered by `external-api-contracts` schemas if new response shapes are consumed.
- **Composition** (`src/composition/`): wire the ledger store and the startup sweep.
- **Tests**: unit coverage across all layers (100% gate); e2e assertions that cancelled acquisitions leave no slskd transfers, no searches, and no staged files.
