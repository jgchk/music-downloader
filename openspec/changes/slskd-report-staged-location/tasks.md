## 1. slskd events + options contract

- [ ] 1.1 Write failing tests for a contract schema (`schemas.ts`) parsing `GET /api/v0/events` records and the `DownloadFileComplete` payload: the outer record `{timestamp, type, data, id}`, the inner `data` as a JSON-encoded string decoding to `{localFilename, remoteFilename, transfer:{id, ...}}`. Tolerate unknown fields; a consumed field missing/mistyped fails parse.
- [ ] 1.2 Write failing tests for a schema parsing `GET /api/v0/options` → `directories.downloads`.
- [ ] 1.3 Implement 1.1–1.2 schemas.

## 2. slskd client reads

- [ ] 2.1 Write failing tests for `SlskdClient` methods to GET events (with `offset`/`limit`) and GET options, reusing the existing base-url + api-key handling.
- [ ] 2.2 Implement the client methods to pass 2.1.

## 3. Resolve the real staged location from events

- [ ] 3.1 Write failing tests for a pure resolver: given the set of our completed transfer ids, a page of parsed events, and the slskd downloads root, return each file's `localFilename` mapped onto `STAGING_ROOT` (`join(STAGING_ROOT, relative(downloadsRoot, localFilename))`). Cover: exact match by `transfer.id`, a source-renamed on-disk name, and an event page missing some ids.
- [ ] 3.2 Implement the resolver to pass 3.1.
- [ ] 3.3 Write failing tests in `download.test.ts` for `stagedFiles()` (now async): on settled+succeeded, it fetches events (bounded paging until all transfer ids resolve), fetches+caches the downloads root from options, and reports each file at the mapped real path. Cover the event-lag retry and the give-up-as-infra-fault path.
- [ ] 3.4 Update `download.ts` to resolve staged files via the events resolver (correlated by the transfer ids it already has from the poll); remove the `candidateStagingDir`-from-identity path minting.

## 4. Staging cleanup uses event-carried staged files (design D3)

- [ ] 4.1 Write failing tests (`events.ts`/`state.test.ts`) for the cleanup-triggering events (`CandidateRejected`, `Imported`, `ImportConflicted`, `AcquisitionCancelled`) carrying the completed download's staged files; fields additive/optional with an upcast default for legacy history.
- [ ] 4.2 Write failing `decide.test.ts` cases: `decide` stamps `state.downloadedFiles` onto those events at mint time (sourced from the `Validating`/`Importing` state in `rejectAndAdvance` and the import/conflict/cancel paths).
- [ ] 4.3 Write failing `react`/`acquisition.test.ts` cases: the `Cleanup` effect carries the staged files (self-contained), no longer just `CandidateIdentity`.
- [ ] 4.4 Implement 4.1–4.3 through `decide`/`evolve`/`react`; keep the pure core I/O-free.
- [ ] 4.5 Write failing `library.test.ts` cases for `discardStaging` removing exactly the carried files and pruning the emptied directory; implement, and delete the `candidateStagingDir`-from-identity recomputation (keep `candidateKey` for dedup/rejected-set).

## 5. E2E fidelity fix

- [ ] 5.1 Add WireMock mappings under `test/e2e/stubs/slskd/mappings` for `GET /api/v0/options` (downloads root) and `GET /api/v0/events` returning a `DownloadFileComplete` whose `localFilename` points at the seed location and whose `transfer.id` matches the transfers-stub id.
- [ ] 5.2 Update `test/e2e/acquisition.e2e.test.ts` to seed the fixture at the stub-reported location (mapped onto the shared staging volume), not at a recomputed path; keep the search/transfer/event stubs and the seed path in agreement.
- [ ] 5.3 Run `pnpm test:e2e`; confirm the happy path reaches Fulfilled through real validation + import against the event-resolved location.
- [ ] 5.4 Regression guard: temporarily break the resolver (or move the seed) and confirm the tier goes red; restore after.

## 6. Gate

- [ ] 6.1 Run `pnpm check` (format → lint → typecheck → build → test w/ 100% coverage) and resolve any gaps.
- [ ] 6.2 Update `download.ts` / adapter doc comments: staged location is read from slskd's `DownloadFileComplete` event and mapped onto `STAGING_ROOT` (no OS/template/sanitizer derivation); note the shared-volume + `PUID/PGID` deployment prerequisites.
