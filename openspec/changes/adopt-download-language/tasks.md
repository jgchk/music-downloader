# Tasks: adopt-download-language

## 1. Tripwires first (red before any rename)

- [ ] 1.1 Downloader store adapter: write the failing test that every frozen event fixture round-trips through an explicit stored-token ↔ model-event map, exhaustive in both directions (a model event without a token, or a token without a model event, fails)
- [ ] 1.2 Importer store adapter: the same round-trip + exhaustiveness test over its fixtures
- [ ] 1.3 Contract tier: assert published-event fixtures (`acquisition.fulfilled`, `release.verdict`) are byte-identical before/after (existing frozen-fixture tests suffice — verify they fail on any payload-name drift, strengthen if not)

## 2. Downloader model rename

- [ ] 2.1 Introduce the stored-token map in the SQLite adapter (green for task 1.1) with current names as both sides, then rename the in-memory domain: `Acquisition` aggregate/state/phase types → `Download`, event union members (`AcquisitionRequested` → `DownloadRequested`, …), `AcquisitionCommand` family, `AcquisitionPolicies` → `DownloadPolicies`, attempt fields → try vocabulary (`tries`, `maxTotalTries`; note `try` is a JS keyword — never a bare identifier)
- [ ] 2.2 Rename application/composition/facade-internal identifiers to match; facade DTO keys and API routes unchanged; the facade mapping file becomes the documented old-wire-name ↔ new-model-name seam (glossary-pointer comments)
- [ ] 2.3 Rename test files/descriptions to the new language; `pnpm check` green

## 3. Importer model rename

- [ ] 3.1 Same pattern: stored-token map green, then `ProposedCandidate` → `MetadataMatch`, `CandidateReference` → `MatchReference`, `DeliveredCandidate` → `DeliveredCopy`, `AcquisitionId` brand → `OriginatingDownloadId` (wire field `acquisitionId` unchanged), review-cause/state/read-model identifiers to match
- [ ] 3.2 Facade/contract mapping files carry the wire↔model naming seam with glossary-pointer comments; DTO keys unchanged
- [ ] 3.3 Rename test files/descriptions; `pnpm check` green

## 4. Config alias (the one behavior change — test-first)

- [ ] 4.1 Failing tests for the four spec scenarios: `DEPOSIT_ROOT` alone; `LIBRARY_ROOT` alone (works + warning names `DEPOSIT_ROOT`); both equal (silent); both conflicting (precise startup failure naming both)
- [ ] 4.2 Implement resolution in the web config schema; downloader runtime consumes the resolved deposit root; `INTAKE_SOURCE_ROOT` default note updated to reference the resolved value
- [ ] 4.3 `.env.example` / compose templates / deploy docs mention `DEPOSIT_ROOT` with the fallback noted

## 5. Spec and doc sweep

- [ ] 5.1 Rename capability directories: `acquisition-aggregate` → `download-aggregate`, `acquisition-lifecycle` → `download-lifecycle`, `library-import` → `library-deposit`; fix inbound references in specs and dev docs (archive untouched)
- [ ] 5.2 Bulk prose sweep acquisition → download across `openspec/specs` (wire literals like `acquisition.fulfilled`, `acquisitionId`, `seam:acquisitions` stay, each with a glossary-pointer note where first used per spec)
- [ ] 5.3 Sweep CLAUDE.md, README, `docs/development` prose; update `CONTEXT-MAP.md`/`CONTEXT.md` Avoid-lists to mark which legacy names are now history-only vs still-live wire names
- [ ] 5.4 E2E blast-radius audit: confirm no test scrapes a renamed surface (no UI copy changed; check `test/e2e` and parity specs anyway)

## 6. Gate, review, release

- [ ] 6.1 Full `pnpm check` + `pnpm test:e2e`; confirm fixture byte-identity tripwires pass
- [ ] 6.2 `/review-all` sweep on the final diff; fix findings to convergence
- [ ] 6.3 Commit train typed `refactor(...)` except the config alias as `feat(runtime)`; run `pnpm version:prep` for the matching bump; PR per house jj+gh flow
