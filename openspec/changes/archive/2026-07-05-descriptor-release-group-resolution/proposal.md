# Proposal: descriptor-release-group-resolution

## Why

Descriptor-based album requests (`{kind: "descriptor", artist, title}`) fail with `MetadataFailed` for precisely the popular albums people are most likely to type. The confidence guard in `bestMatchId` treats a top-two score gap under 10 as ambiguity, but MusicBrainz release search returns *editions* — a well-known album yields many pressings all scored 100, so edition multiplicity is misread as identity ambiguity and the human-friendly input path breaks. Obscure single-pressing albums resolve; OK Computer does not.

## What Changes

- Descriptor album resolution groups MusicBrainz release search hits by **release-group** and applies the existing confidence/ambiguity guard (≥90 score, ≥10 margin) **across release-groups** — the identity level where its premise actually holds — instead of across individual releases.
- Within the winning release-group, the edition is selected by the user's own text: releases whose title matches the input title after normalization (exact-after-normalization only, no fuzzy guessing) are preferred, so `"Midnights (3am Edition)"` selects that edition while `"Midnights"` falls through to a **canonical rule** — official status first, earliest release date first.
- A selected release that cannot yield a valid target (sparse MusicBrainz track data) falls through to the next candidate in selection order rather than failing the acquisition.
- The release search raises its result limit (5 → 100, one request) so grouping sees genuine cross-album diversity, and consumes additional per-hit fields (`title`, `release-group.id`, `status`, `date`) — additive to the consumed contract.
- Search query construction escapes Lucene special characters and embedded quotes in artist/title (rides along; today a title like `"Heroes"` mangles the query).
- Explicitly deferred: descriptor **track** (recording) resolution keeps its current behavior — recordings have no release-group equivalent; a version-qualified descriptor field is likewise out of scope.

No breaking changes: ports, domain events, and the public API are untouched; the change is confined to the MusicBrainz adapter (anti-corruption layer).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `metadata-resolution`: descriptor album resolution changes at the requirement level — ambiguity is judged across release-groups (identity), not across releases (editions); edition selection within the resolved identity is governed by text match with a canonical-release fallback; unresolvable/ambiguous behavior is preserved but re-anchored to the identity level.

## Impact

- **Code**: `src/adapters/musicbrainz/` only — `mapping.ts` (selection logic replaces `bestMatchId` for releases), `metadata.ts` (query escaping, limit, selection wiring), `schemas.ts` (additive consumed fields on release search hits).
- **Contract fixtures/tests**: the MusicBrainz release-search fixture and contract tier must carry the newly consumed fields (`external-api-contracts` requirements themselves are unchanged — schemas still declare only consumed fields); E2E WireMock release-search stubs need the same fields.
- **Behavioral**: descriptor album latency unchanged (same two HTTP calls: one search, one release fetch); descriptor albums that previously failed as ambiguous now resolve; genuinely ambiguous titles (two different albums matching) still fail cleanly.
- **Dependencies**: none added.
