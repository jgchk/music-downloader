# Tasks: adopt-download-language

Naming scheme (design.md, Decision 0): **Download** = the saga, **Try** = one attempt at one candidate, **Transfer** = the file-movement collaboration. Verb forms (`Downloading`, `DownloadedFile`, `Downloader*`, the `Download`/`AbortDownload` effect kinds) are untouched.

## 1. Tripwires first (red before any rename)

- [ ] 1.1 Downloader: failing test that the SQLite adapter round-trips every event through an explicit stored-token ↔ model-type map — exhaustive both ways, a bijection, and no model name equal to another event's stored token
- [ ] 1.2 Importer: the same round-trip + bijection + no-cross-collision test
- [ ] 1.3 Verify the frozen published-event fixtures (`acquisition.fulfilled`, `release.verdict`) and the legacy upcast fixtures fail loudly on any payload or token drift; strengthen if they do not

## 2. Downloader: the storage-token seam

- [ ] 2.1 Introduce the stored-token ↔ model map in the SQLite event store with current names on both sides (identity), rewriting the token in the `type` column and inside the `data` blob on write, and back on read after upcasting; tasks 1.1/1.3 green
- [ ] 2.2 Confirm no other persistence surface stores an event type string (dead letters, parked effects, checkpoints, resource ledger); map or document each finding

## 3. Downloader: saga rename (Acquisition → Download)

- [ ] 3.1 Domain: `domain/acquisition/` → `domain/download/`; `Acquisition`→`Download`, `AcquisitionEvent`→`DownloadEvent`, `AcquisitionPhase`→`DownloadPhase`, `AcquisitionPolicies`→`DownloadPolicies`, `AcquisitionRequest`→`DownloadRequest`, `AcquisitionSnapshot`→`DownloadSnapshot`, and the four saga events (`AcquisitionRequested/Fulfilled/Exhausted/Cancelled` → `Download*`); map entries flip to non-identity
- [ ] 3.2 Commands: `SubmitAcquisition`→`SubmitDownload`, `CancelAcquisition`→`CancelDownload`, and the rest of the `AcquisitionCommand` union → `DownloadCommand`
- [ ] 3.3 Application, projections, facade-internal, composition: identifiers follow; facade DTO keys, API routes, and published payloads unchanged; `interfaces/contracts/events/mapping.ts` gains the glossary-pointer comment where model `DownloadFulfilled` renders wire `acquisition.fulfilled`

## 4. Downloader: try/transfer rename

- [ ] 4.1 Events + commands: `DownloadStarted/Completed/Failed` → `TryStarted/TryCompleted/TryFailed`, `RecordDownload*` → `RecordTry*`
- [ ] 4.2 Types: `DownloadResult`→`TryResult`, `DownloadStart`→`TryStart`, `DownloadFailureReason`→`TryFailureReason`, `DownloadPolicy`→`TryPolicy`
- [ ] 4.3 Ports: `DownloadPort`→`TransferPort`, `DownloadObserverPort`→`TransferObserverPort`, `DownloadProgress`→`TransferProgress`; adapters and composition follow
- [ ] 4.4 `pnpm check` green for the downloader

## 5. Importer renames

- [ ] 5.1 Introduce its stored-token map (identity), task 1.2 green
- [ ] 5.2 `ProposedCandidate`→`MetadataMatch`, `CandidateReference`→`MatchReference`, `candidateReferenceKey`→`matchReferenceKey`, `CandidatePenalty`→`MatchPenalty`, `DeliveredCandidate`→`DeliveredCopy`, event `CandidatesProposed`→`MatchesProposed` (map flips), errors `UnknownCandidate`→`UnknownMatch`, `NoRetainedCandidate`→`NoRetainedCopy`
- [ ] 5.3 `AcquisitionId` brand → `OriginatingDownloadId`; the `acquisitionId` field spelling stays (wire), DTO keys and resolution-verb tokens unchanged
- [ ] 5.4 `pnpm check` green for the importer

## 6. Config alias (the one behavior change — test-first)

- [ ] 6.1 Failing tests for the four spec scenarios: `DEPOSIT_ROOT` alone; `LIBRARY_ROOT` alone (works + warning names `DEPOSIT_ROOT`); both equal (silent); both conflicting (precise startup failure naming both)
- [ ] 6.2 Implement resolution in the web config schema; the deposit root and `INTAKE_SOURCE_ROOT`'s default derive from the resolved value
- [ ] 6.3 `.env.example`, compose templates, and deploy docs mention `DEPOSIT_ROOT` with the fallback noted

## 7. Spec and doc sweep

- [ ] 7.1 Rename capability directories: `acquisition-aggregate`→`download-aggregate`, `acquisition-lifecycle`→`download-lifecycle`, `library-import`→`library-deposit`; fix inbound references (archive untouched)
- [ ] 7.2 Bulk prose sweep acquisition→download across `openspec/specs`, and attempt→try where it means one candidate attempt (wire literals stay, noted at first use per spec)
- [ ] 7.3 Amend `packages/downloader/CONTEXT.md` for the Try/Transfer split (replacing the "Download policy" entry); sweep CLAUDE.md, README, `docs/development` prose; mark in the glossaries which legacy names are history-only vs still-live wire names
- [ ] 7.4 E2E blast-radius audit: confirm no test scrapes a renamed surface (no UI copy changed; check `test/e2e` and parity specs anyway)

## 8. Gate, review, release

- [ ] 8.1 Full `pnpm check` + `pnpm test:e2e`; confirm the tripwires pass and contract fixtures are byte-identical
- [ ] 8.2 `/review-all` sweep on the final diff; fix findings to convergence
- [ ] 8.3 Commit train typed `refactor(...)` except the config alias as `feat(runtime)`; `pnpm version:prep`; PR per the house jj+gh flow
