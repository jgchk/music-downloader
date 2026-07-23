## Why

A 10-agent whole-codebase review of `main` @ 3.10.0 (pr-review-toolkit roster + the five custom `-reviewer` agents) found no correctness regressions, no dependency-rule breaks, and no swallowed `Result` errors — the non-negotiables hold. What it did surface is a batch of **hardening, contract-coverage, and test-precision** gaps: places where a latent fault could escape a `Result` channel, where a masked infra fault turns into silent expensive work, where a consumed third-party shape is unvalidated, and where 100%-line coverage hides an unspecified boundary. None of these change an observable capability or a published contract, so they ride as one fix batch.

Two review findings that *do* change a published contract or move a decision across a context boundary — surfacing decided lifecycle flags on the acquisition DTO, and renaming the importer's `reject-and-retry-download` verdict verb to the importer's own language — are carved out into their own OpenSpec proposals (`bff-decided-lifecycle-flags`, `importer-verdict-own-language`) because they need migration/design discussion. They are **not** in this change.

## What Changes

- **Event-bus fan-out is fault-isolated (both packages).** `InProcessEventBus.publish` wraps each handler dispatch in try/catch (log-and-continue), so a synchronous subscriber throw can neither escape `SqliteEventStore.append`'s `ResultAsync` channel after a committed write nor abort fan-out to the remaining subscribers.
- **Latent-crash and silent-replay hardening.** Beets subprocess `stdout`/`stderr` get `error` handlers (a stream fault maps to `InfraError`, not an uncaught exception); the three checkpoint-load resume paths log before `unwrapOr(0)` so a faulted checkpoint read is distinguishable from a fresh consumer (mirroring the downloader acquisition reactor); the importer reactor's retryability decision becomes an exhaustive `CommandError` classifier; the beets `bridge.py` item scan stops swallowing genuine `OSError`/`IOError` as "not an audio file".
- **Third-party contract coverage.** ffprobe output is parsed through a tolerant zod schema (replacing an unvalidated cast) with a recorded fixture and a replay test; the recorded slskd `DownloadFileComplete.data` and the beets `applied.failures[]` shapes gain real fixture/decode coverage; the slskd recorder captures the `events`/`options` responses it currently hand-maintains.
- **Test precision the line gate cannot see.** Exact-boundary tests for the two core confidence gates (auto-import threshold, match gate) and the match-scorer composite; the two secret-redaction omissions (`token`, `fileContents`); the untested release orchestrator (`version-prep.ts`) plus a version-collision guard; removal of two dead-tested branches; replacement of recompute-the-impl tautologies with golden literals / read-backs; and a sweep of weak "element-exists-but-value-unpinned" component/SSR assertions.
- **Cheap correctness/expression polish.** `Mbid` is minted through `parseMbid` at the MusicBrainz edge; `TrackMapping.distance` and `Target.tracks`/`TrackMetadata.position` express their brands/invariants; `clampUnit(NaN)` is guarded to match its docstring; `historyPayloadOf`'s union `default` becomes explicit no-op cases; the landing-page facade reads use `guardedRead`; two stale "MVP / for now" comments are corrected; the `release.verdict` schema docstring is restated in the importer's own terms.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `external-api-contracts`: broaden "the consumer contract is codified as schemas" so the codified, fixture-backed, runtime-enforced contract covers not only the HTTP providers (slskd, MusicBrainz) but also the consumed **local-subprocess** output the downloader depends on for a quality decision (ffprobe). No other capability's requirements change — every remaining task upholds an existing spec (e.g. the slskd `DownloadFileComplete.data` decode already falls under slskd's "every consumed response shape" requirement) or is an internal hardening/test-quality fix with no capability surface.

## Impact

- **All three packages + `scripts/release`, hardening/test-only.** No serialized event, cross-context seam, or public facade contract changes (the two that would are the carved-out proposals). The one additive runtime surface is the new ffprobe zod schema + contract fixture/tier case.
- **No breaking changes.** All edits are internal fault-isolation, added validation, added tests, and comment/brand fixes. Release type: patch (`fix:`/`test:`/`refactor:` commits; no `feat:`).
- **Deferred (documented, not built):** slskd two-phase-removal dedup across `teardown.ts`/`resource-remover.ts` (larger refactor, no behavior change); `TaggerPort` ISP split (marginal); real Playwright a11y-parity specs (advisory — this change instead documents `parity.spec.ts` as boot-smoke-only so the gap is owned); musicbrainz null-tolerance example-zoo consolidation (cosmetic).
