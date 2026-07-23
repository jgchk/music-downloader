# Tasks

Test-first throughout (no production line without a failing test). Work outside-in on the data, inside-out on the render: enrich the bridge, carry it inward, then render it.

## 1. Bridge: emit the diff evidence

- [x] 1.1 Failing contract test: record a `propose` fixture whose best candidate has a retag, an extra file, and a missing track; assert the new fields (per-track `current` tags, per-track `distance`, `extraItems`, `missingTracks`, album fields) are present and schema-valid.
- [x] 1.2 Extend `serialize_match` in `bridge.py` to emit per-track current tags (title, artist, track no., length) from the mapped `item`, per-track `distance` from `match.distance.tracks`, `extra_items` (unmatched files with current tags), `extra_tracks` (missing tracks: title + index), and album fields (year, media, label, catalognum, country, albumdisambig) from `match.info`.
- [x] 1.3 Green + re-record the frozen contract fixture against the pinned beets version.

## 2. Adapter: validate and map the richer output

- [x] 2.1 Failing test on `bridgeCandidateSchema` (and nested track/incumbent schemas) for the new optional fields.
- [x] 2.2 Extend `adapters/beets/schemas.ts` additively (new fields optional so pre-change fixtures still validate).
- [x] 2.3 Failing test then mapping in the bridge adapter: bridge JSON → `ProposedCandidate` including the new fields.

## 3. Domain: carry the evidence on the event

- [x] 3.1 Failing test: `TrackMapping`/`ProposedCandidate` carry the optional diff fields; a folded state rebuilt from an enriched `CandidatesProposed` exposes them; a legacy event (fields absent) still folds.
- [x] 3.2 Extend the `domain/import/events.ts` types additively (all new fields optional).
- [x] 3.3 Confirm `decide`/`evolve` are untouched in behavior (the new fields ride along, they don't change any decision).

## 4. Honest hint signal

- [x] 4.1 Failing test: the match-review DTO carries the pinned/hinted release id (from `pinnedId`/`hints.mbReleaseId`) when one was in play, absent otherwise.
- [x] 4.2 Carry the id through `facade/mapping.ts` onto the match-review DTO (additive optional field).

## 5. Facade: expose the diff on the DTO

- [x] 5.1 Failing test on `facade/schemas.ts` for the new optional candidate/track fields and the pinned-id field.
- [x] 5.2 Extend `candidateSchema`/`trackMappingSchema` (and the match-review variant) additively.
- [x] 5.3 Map domain → DTO in `facade/mapping.ts`; assert a legacy candidate (no diff fields) maps cleanly.

## 6. Web: render differences, not scores

- [x] 6.1 Failing SSR test: given an enriched match-review, the page renders the album headline (intended vs candidate), the album-field diff, and a per-track diff marking retags, extra files (`⊘`), and missing tracks (`✗`).
- [x] 6.2 Failing SSR test: given a legacy review with no diff fields, the page falls back to today's distance/penalty table.
- [x] 6.3 Failing SSR test: the hint line reads "wasn't the best match" only when `best.albumId !== pinnedId`, and "matched your pinned release, but confidence is low" when equal; absent with no pinned id.
- [x] 6.4 Implement in `CandidateTable.svelte` / `ReviewDetail.svelte` / `lib/reviews.ts`: the diff view, the demoted+glossed penalties (D5), and the legacy fallback.
- [x] 6.5 Reframe the ID form label from "MusicBrainz release ID" to source-agnostic "release ID" (verb/contract unchanged); assert the copy.

## 7. Close-out

- [x] 7.1 `pnpm check` green (100% coverage gate) across importer + web.
- [x] 7.2 Verify end-to-end against a live review on flight (or a seeded local one): confirm a real diff renders and the actions still resolve.
- [x] 7.3 Update the contract fixture provenance note if the recorder script needed changes.
