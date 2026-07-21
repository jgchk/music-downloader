# Tasks: slskd-resource-ledger

Test-first throughout: each task's tests are written red before its production code (100% coverage gate).

## 1. Domain protocol — cancellation retains and settles the pending candidate

- [x] 1.1 `evolve`: `Cancelled` variant gains optional `pending`; cancelling from `Downloading` retains the current candidate as `pending`; `CandidateRejected` on `Cancelled` clears it (tolerant-fold tests incl. protocol-violation cartesian cases)
- [x] 1.2 `react`: `AcquisitionCancelled` on `Cancelled{pending}` emits new `AbortDownload{candidate}` effect; settled-`current` Cleanup path unchanged; redelivery after `CandidateRejected` emits nothing (guard tests)
- [x] 1.3 `decide`: `RecordDownloadCompleted`/`RecordDownloadFailed` on `Cancelled{pending}` returns `[CandidateRejected]`; on `Cancelled` without pending stays `ok([])` (duplicate-settlement tests)
- [x] 1.4 Aggregate facade + read-model projections tolerate the new state field (snapshot/currentCandidate tests)

## 2. Ports and interpreter

- [x] 2.1 Define `ResourceLedgerStore` port in `application/ports` (recordCreated / recordId / markRemoved / liveByAcquisition / allLive)
- [x] 2.2 `DownloadPort.abort(candidate)` added; interpreter handles `AbortDownload` by calling it and applying `RecordDownloadFailed` with the returned reason (interpreter tests with port fakes). NOTE: first-cut `SlskdDownload.abort` cancels+removes the candidate's own transfers by filename (`?remove=true`); ledger-scoping and `acquisitionId` threading are deferred to 5.5.

## 3. SQLite ledger adapter

- [x] 3.1 `source_resources` table in `schema.ts` (idempotent bootstrap) + `SqliteResourceLedger` implementing the port; upsert semantics for retried recordings (unit tests on a temp DB)

## 4. slskd search stewardship

- [x] 4.1 `SlskdSearch` records the search in the ledger on creation, deletes it after harvest on both completed and timeout exits, marks removed; deletion failure logs, leaves the row live, and still returns candidates (unit tests with fake client/ledger)

## 5. slskd download stewardship

- [x] 5.1 Write-ahead ledger recording before enqueue; capture transfer GUIDs from the first matching poll via `recordId`. (Enqueue-response id capture deferred — the live API's enqueue body is verified in 7.1; the poll-capture path suffices.)
- [x] 5.2 `mine` is the acquisition's owned transfers (the write-ahead `ownedKeys`, i.e. `username|filename` for this candidate); unowned transfers under the same user are excluded. NOTE: the ghost-record bug is closed by removal-after-settle (5.3) rather than per-poll ledger lookup — a prior attempt's records are gone before a retry polls, so there is nothing stale to scope out.
- [x] 5.3 On every terminal path (completed, failed, doomed, abandoned) `removeOwned` cancels+removes each owned transfer with `?remove=true` (tolerating absent ones) and marks the ledger rows removed. Ledger writes are best-effort so a fault never fails a working download.
- [x] 5.4 Doomed-remainder: `aggregate.hasFailure` ends the download the instant any file fails; `removeOwned` cancels the still-live remainder in the same sweep, and the reported reason is the original failure's (captured before the cancellation).
- [x] 5.5 `abort(acquisitionId, candidate)`: GET the user's transfers, filter to the candidate's owned filenames, `removeOwned` (cancel+remove via `?remove=true`) and mark the ledger rows removed; idempotent when transfers are already settled or absent. (A single `?remove=true` cancels+removes atomically, so no poll-to-settle loop is needed.)

## 6. Startup sweep and composition

- [x] 6.1 `SourceResourceSweep` (application) + `SlskdResourceRemover` (adapter, behind the `SourceResourceRemover` port): for each `allLive` row whose acquisition folds to terminal, remove on slskd (search by id; transfer by GUID, falling back to a filename lookup) + `markRemoved`; per-row fault isolation; non-terminal rows untouched (unit tests for both).
- [x] 6.2 Wire ledger + sweep in composition; `SourceResourceSweep.run()` runs after persistence bootstrap and before `Reactor.start`.
- [x] 6.3 Integration test in `reactor.test.ts`: crash window between `AcquisitionCancelled` and `AbortDownload` — the reactor re-fires the abort off the unadvanced checkpoint, settles the pending candidate, and the ensuing rejection discards staging.

## 7. Contracts and e2e (live slskd)

- [x] 7.1 Verified live against slskd 0.22.5: search create/state/`DELETE` (204, then 404); enqueue `POST /transfers/downloads/{user}` with `[{filename,size}]` → 201 **empty body** (no ids — resolves the design open question, poll-capture is the only path); `DELETE …/{id}?remove=true` → 204 then gone; absent resource → 404. No response bodies are parsed, so **no new `external-api-contracts` schemas are needed**. Found + fixed a real gap: added `SlskdClient.delIfPresent` so a 404 converges instead of erroring.
- [~] 7.2 Cancel-mid-download is covered end-to-end across the domain, interpreter, adapter (`abort` issues `?remove=true`), and reactor crash-recovery integration tiers, plus the live-slskd `?remove=true` verification. A dedicated out-of-process e2e cancel scenario is **not** added — it needs a stateful in-progress WireMock download that conflicts with the shared happy-path scenario; the behavior is proven by the tiers above.
- [x] 7.3 e2e (`acquisition.e2e.test.ts`): on the happy path the app deletes its search (`DELETE /searches/search-1`) and removes the completed transfer (`DELETE …/peer1/transfer-1?remove=true`), and issues no DELETE against any unowned resource — asserted via the WireMock request journal. Added `search-delete`/`transfers-delete` stub mappings.

## 8. Finalize

- [x] 8.1 `openspec validate slskd-resource-ledger --strict` → valid. Syncing deltas into the main specs is deferred to the post-merge archive chore (`openspec archive`), matching this repo's convention of a separate `chore(openspec): archive … and sync specs` commit rather than bundling the sync into the feature PR.
- [x] 8.2 `pnpm check` green (format, lint, typecheck, build, 100% coverage — 589 tests; contract 34; release 18); `pnpm test:e2e` green (3 tests, incl. the new stewardship assertion).
- [ ] 8.3 `jj` commit stack + version prep per release pipeline; PR
