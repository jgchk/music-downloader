## 1. Critical — event-bus fault isolation

- [x] 1.1 TDD `InProcessEventBus.publish` (downloader `adapters/sqlite/event-bus.ts`): a subscriber that throws synchronously is caught, logged with context, and the remaining subscribers still receive the event; append still returns `ok`.
- [x] 1.2 Mirror the same fix + test in the importer `adapters/sqlite/event-bus.ts`.
- [x] 1.3 Confirm (test) `SqliteEventStore.append` returns `ok(stored)` and never throws when a subscriber throws (both packages).

## 2. Important — latent-crash / silent-fault hardening

- [x] 2.1 TDD beets `adapters/beets/runner.ts`: attach `error` handlers to `child.stdout`/`child.stderr`; a stream `error` clears the timer and rejects into the existing `InfraError` path (no uncaught exception).
- [x] 2.2 TDD the three checkpoint-load resume paths — downloader `application/events/catch-up-subscription.ts`, importer `application/import/reactor.ts`, importer `application/events/catch-up-subscription.ts` — to log on `isErr()` before `unwrapOr(0)` (mirroring `downloader/application/acquisition/reactor.ts`), asserting the error is surfaced, not swallowed.
- [x] 2.3 TDD importer `application/import/reactor.ts` `isRetryable`: replace the two-kind predicate with an exhaustive `CommandError.kind` switch (no `default`), mirroring the downloader `classifyCommandError`; add a case pinning that a non-retryable kind holds vs advances correctly.
- [x] 2.4 beets `adapters/beets/bridge/bridge.py` `collect_items`: narrow the bare `except Exception` so `OSError`/`IOError` surfaces (→ retryable fault) while only unparseable-format `continue`s; cover via the bridge contract/unit tier.

## 3. Third-party contract coverage

- [x] 3.1 TDD a tolerant `FfprobeOutput` zod schema (`adapters/ffmpeg/`), derive the adapter type from it, and validate `probe.ts` output at the boundary (malformed → `InfraError` naming ffprobe); replace the `as FfprobeOutput` cast.
- [x] 3.2 Add a recorded ffprobe fixture from the image-pinned binary + a small recorder script; add a contract-tier case driving `FfmpegAudioProbe` with a fake `CommandRunner` over the recorded stdout, asserting consumed fields parse and map (incl. `bits_per_raw_sample` vs `bits_per_sample`).
- [x] 3.3 Add a contract-tier case that decodes each recorded `DownloadFileComplete.data` (`test/contract/fixtures/slskd/events.json`) through `slskdDownloadFileCompleteSchema` — or drives `resolveStagedPaths` over the recorded events — so a lost `localFilename` fails the tier.
- [x] 3.4 Extend `test/contract/record/slskd.ts` to capture `GET /api/v0/events?offset=&limit=` (real paging query) and `GET /api/v0/options`; add a replay case asserting the sent query.
- [x] 3.5 Extend `record-bridge-fixtures.sh` with a scenario producing a non-empty beets `applied.failures[]`; record it and pin the `{stage, message}` element shape in the contract tier.

## 4. Test precision — boundaries, redaction, dead branches, tautologies

- [x] 4.1 Add exact-boundary tests: importer `domain/import/decide.ts` auto-import gate (`> autoApplyThreshold`, at-threshold) and downloader `domain/ranking/ranking.ts` match gate (`>= threshold`, at-threshold).
- [x] 4.2 Pin the match-scorer composite: one exact weighted score for a known fileset + `trackCountSignal` edges (2-of-3 → 0.667, 2× → clamps to 0) in `domain/matching/match-scorer` tests.
- [x] 4.3 Cover both redaction omissions: `token`/`*.token` (downloader `application/logging/logger.ts`) and `fileContents`/`*.fileContents` (importer) — assert `[REDACTED]` top-level and nested, and the literal never appears.
- [x] 4.4 Remove the unreachable `major` return in `scripts/release/bump.ts:31-32`; keep `bump.test.ts` green and add the case that would have distinguished it.
- [x] 4.5 Fix the importer reactor `!isDeadLettered && wasStalled` dead-tested branch (`reactor.ts:216`): seed a fresh budget-exhausting event pre-`stalled.mark` and assert the stall/letter survives.
- [x] 4.6 Replace recompute-the-impl tautologies: `adapters/sqlite/upcaster.test.ts` (append an event, read back the persisted `schema_version`); importer `facade/index.test.ts` (golden literal ids); add a downloader `event-store` test that raw-inserts a `schema_version < CURRENT` row and asserts the real registry upcasts it forward.

## 5. Test precision — coverage gaps + weak assertions

- [x] 5.1 Importer `adapters/sqlite/event-store.ts` `readAll` pagination (`limit`/`limit ?? -1`): append 3, assert windowed reads.
- [x] 5.2 Importer `application/events/outbound-feed.ts` as-of-prefix render: seed a later trailing event, assert the render excludes it.
- [x] 5.3 Importer beets `adapters/beets/schemas.ts` distance `[0,1]` parse-edge through the bridge adapter (`distance: 1.5` → `InfraError`); importer `upcaster.ts` unknown/future `schemaVersion` passthrough; `intake-consumer` append-fault `reason` passthrough; `interpreter.test.ts` literal mode assertion (drop the `&&`-narrowing).
- [x] 5.4 Web `lib/acquisitions.test.ts`: add `Empty/Selecting/Validating/Importing` to the `statusTone` `it.each`; pin `formatBytes` 1024 boundary + GiB cap.
- [x] 5.5 Web component/SSR value assertions: `AcquisitionForm` (seeded policy values + selected option), `ResolveForms` (each hidden `verb` value), `ReviewDetail` (`<h1>` path, context summary, kind chip, incumbent row), `ManualTagsForm` (bound row values / legend), `AcquisitionDetail` (status + "N attempts, M rejected"), `ProgressBar` (`<progress value>`), `config.test.ts` (`autoApplyThreshold` default + bounds), `reviews.test.ts` (hint-contradiction branch direct).
- [x] 5.6 Web `lib/server/runtime.test.ts` `connectVerdictFeed`: record feed/wakeups identity in fakes, assert each seam got the *other* module's feed (cross-wiring would fail).
- [x] 5.7 Importer `composition/runtime.test.ts`: replace the `stop` spy with a state-based fake `SeamFeed` read-counter (mirror the downloader twin); replace the real-timer sleep in `bridge-adapter.test.ts` with the caller-controlled gate; split the bundled multi-behavior read-surface tests (`read-models.test.ts`, `use-cases.test.ts`).
- [x] 5.8 Document `packages/web/tests/parity.spec.ts` as boot-smoke-only (comment + name/description), so the a11y-parity gap is explicitly owned (real specs deferred).

## 6. `version-prep` orchestrator tests + collision guard

- [x] 6.1 Extract/unit-test `scripts/release/version-prep.ts`: changelog front-matter assembly, bump/anchor incl. the `level === null` "stay put" branch, rerun-idempotence, base-absent / front-matter-present, no-releasable-commits.
- [x] 6.2 Add a version-collision guard: in `--check`, assert the computed `v<version>` is not already in `releaseTags()`; TDD the collision case fails loudly.

## 7. Cheap correctness / expression polish

- [x] 7.1 Mint `Mbid` through `parseMbid` in `adapters/musicbrainz/mapping.ts` `optionalMbid` (drop the unchecked `branded<Mbid>`); TDD a malformed id rejects.
- [x] 7.2 Type `TrackMapping.distance` as `Distance` and brand it in the beets ACL (`bridge-adapter.ts`) where the schema bound is proven; TDD.
- [x] 7.3 Add a downloader non-empty helper; type `Target.tracks: NonEmptyReadonlyArray<TrackMetadata>` branded in `createTarget` after the `NoTracks` guard; validate `TrackMetadata.position` as a positive ordinal; TDD.
- [x] 7.4 Guard `clampUnit(NaN)` in `domain/shared/unit.ts` to match its docstring; TDD; tighten `ffmpeg/probe.ts` `parseNumber('')` handling.
- [x] 7.5 Replace `historyPayloadOf`'s union `default` (`downloader/application/projections/read-models.ts`) with explicit no-op cases per non-history event type.
- [x] 7.6 Wrap the landing-page facade reads in `guardedRead` (`web/src/routes/+page.server.ts`); TDD the degrade path.
- [x] 7.7 Add the UI-edge `parseAcquisitionView` discriminated view model so `AcquisitionDetail.svelte` drops the impossible-combination guard pair; TDD.
- [x] 7.8 Fix stale comments: `adapters/sqlite/upcaster.ts` header (registry is active, v1→v2 registered) and `adapters/filesystem/paths.ts` ("importer owns per-track tagging", not "user runs beets separately"); restate the `importer/interfaces/contracts/events/schemas.ts` `release.verdict` docstring in the importer's own terms.
- [x] 7.9 Give the beets `validate` an operator-fixable `ConfigInvalid` business variant instead of `InfraError` (port taxonomy fidelity); TDD.

## 8. Gate

- [x] 8.1 `pnpm check` green (format, lint, typecheck, build, unit test + 100% merged coverage, both contract tiers). Fix any regression.
