# Design: descriptor-release-group-resolution

## Context

A descriptor album request today runs `release:"<title>" AND artist:"<artist>"` against MusicBrainz's `/release` search (limit 5) and feeds the scored hits to `bestMatchId` (`src/adapters/musicbrainz/mapping.ts`), which refuses unless the top hit scores ≥90 **and** beats the runner-up by ≥10. MusicBrainz release search operates at *edition* granularity: a popular album returns many pressings of the same album, all scored 100, so the margin test reads edition multiplicity as identity ambiguity and resolution fails (`MetadataFailed`). The more canonical the album, the more certain the failure.

MusicBrainz's own ontology already separates the two levels: a **release-group** is the album identity; its **releases** are editions. The search response carries `release-group.id`, `title`, `status`, and `date` per hit — fields the consumed-contract schema currently strips.

Constraints: the domain is pure and untouched; this is anti-corruption-layer work only. `MetadataPort` / `MetadataResolution` do not change. The contract tier asserts the adapter's outbound requests, so query/limit changes must be reflected in fixtures and stubs.

## Goals / Non-Goals

**Goals:**

- Descriptor album requests for well-known albums resolve instead of failing as ambiguous.
- Genuine identity ambiguity (two *different* albums both matching) still fails cleanly.
- The user's text selects the edition when it names one (`"Midnights (3am Edition)"`); otherwise a deterministic canonical edition is chosen.
- The selected edition's track list is a sensible validation target for downstream download validation.

**Non-Goals:**

- Descriptor **track** (recording) resolution — recordings have no release-group equivalent; the existing `bestMatchId` path is retained for recordings unchanged.
- A version-qualified descriptor request shape (e.g. a `version` field) — the text-match rule leaves room for it later without foreclosing anything.
- A completeness fallback that fetches the full release-group when the canonical edition is absent from the search's top hits (see Risks).
- Any change to ports, domain events, HTTP/MCP API, or policies.

## Decisions

### D1 — Judge ambiguity across release-groups, not releases

High-confidence search hits (score ≥90) are grouped by `release-group.id`; a group's score is the maximum score among its releases. The existing guard semantics apply **across groups**: the best group must score ≥90 and beat the runner-up *group* by ≥10, otherwise unresolved. Thresholds (90/10) are unchanged — the guard's premise (a score gap distinguishes different *albums*) finally holds at the level it is evaluated.

*Alternative considered — search the `/release-group` entity instead:* semantically clean for identity but rejected: edition qualifiers live in **release titles** (`"Midnights (3am Edition)"` is a release inside release-group `"Midnights"`), so an RG search either scores the qualified query below confidence or — worse — silently substitutes the standard edition; it also costs an extra HTTP hop and abandons the recording path entirely.

### D2 — Edition selection: text match first, canonical rule second

Within the winning group, candidate releases are ordered by a two-tier rule:

1. **Text match**: releases whose title equals the request title after normalization (D3) come first. If the user named an edition, this honors it; if they typed the base title, the base-titled releases are the matches.
2. **Canonical rule** (orders the matched tier internally, and is the sole rule when nothing matches — e.g. every release title carries a qualifier the user didn't type): releases with status `Official` before any other or missing status, then earliest parseable release date, undated last. Ties keep search-relevance order (stable sort).

The first candidate whose full-release fetch yields a valid `Target` wins; an invalid one (sparse track data → `releaseToTarget` returns `undefined`) **falls through to the next candidate** instead of failing the acquisition. Fall-through is bounded by the candidate list; if all candidates are exhausted, the outcome is unresolved as today.

*Alternatives considered:* fuzzy/partial title matching rejected — a wrong-edition guess poisons download validation (its track list becomes the yardstick), so the rule either honors exactly what the user named or defaults to canonical. Relying on MusicBrainz score deltas within a group rejected — scores within a group are saturated ties and carry no edition signal.

### D3 — Normalization is exact-match-enabling, not fuzzy

One normalization function applied to both the request title and release titles: Unicode-casefold, strip punctuation (including parentheses/brackets), collapse runs of whitespace, trim. `"Midnights (3am Edition)"`, `"midnights 3am edition"`, and `"MIDNIGHTS  (3AM EDITION)"` normalize identically; `"Midnights"` does not equal `"Midnights (3am Edition)"`. Equality after normalization is the *only* match relation — no containment, no edit distance. Behavior is pinned by table-driven tests.

### D4 — One search request, limit raised 5 → 100

Grouping needs to see cross-album diversity and enough of the winning group to select an edition; limit 5 shows neither. MusicBrainz allows `limit=100` on a single request, so the HTTP call count is unchanged (one search + one release fetch). The candidate pool is the search's top-100 by relevance, not the group's complete release list — accepted trade-off (see Risks).

### D5 — Additive contract consumption

`mbReleaseSearchSchema` hit entries additionally consume `title`, `status`, `date`, and `release-group.id` (all optional — absence degrades selection, never validation). This stays within the external-api-contracts rule of declaring only consumed fields; fixtures and E2E stubs are extended to carry them.

### D6 — Lucene escaping rides along

Artist/title values are escaped before interpolation into the Lucene query: embedded `"` and Lucene specials (`+ - && || ! ( ) { } [ ] ^ ~ * ? : \ /`) are backslash-escaped inside the quoted phrase. Fixes `"Heroes"`-style titles for both the release and recording query builders.

### D7 — Shape: selection logic stays in the pure mapping module

The grouping/ordering/matching logic is pure and lives in `mapping.ts` (alongside `bestMatchId`, which remains for recordings); `metadata.ts` orchestrates: search → ordered candidate ids → fetch-until-valid-target. Keeps the anti-corruption layer's pure/IO split and unit-tests the selection exhaustively without HTTP.

## Risks / Trade-offs

- **Canonical edition absent from top-100 hits** (mega-groups with 100+ editions) → relevance ranking places exact-title matches high, so the practical pool is sound; a release-group fetch as completeness fallback is explicitly deferred until it demonstrably bites.
- **Earliest official pressing has sparse MusicBrainz data** → D2's fall-through tries the next candidate instead of failing; worst case equals today's behavior (unresolved).
- **Normalization surprises** (diacritics, unicode punctuation variants) → table-driven tests pin behavior; rule is deliberately dumb and predictable, and the MBID path remains the precision escape hatch.
- **Fall-through multiplies release fetches** (one per invalid candidate) → bounded by candidate count and MusicBrainz's 1 req/s etiquette; in practice sparse-data editions are the exception, and the common case stays at two requests.
- **Contract tier asserts outbound requests** → the limit and escaping changes break recorded request assertions by design; fixtures/stubs are updated in the same change, keeping the tier honest.
- **Null track durations** (surfaced by live verification) → MusicBrainz returns `length: null` for tracks whose duration it does not know, and popular albums' canonical pressings sometimes carry them; the contract schema now models length as nullable and the mapping treats null as no-usable-duration, so such a release collapses to no-valid-target and the fall-through moves to the next candidate rather than raising an InfraError. Before this, a resolved-by-descriptor (or by-MBID) request for such a release faulted at the boundary.
- **Edition qualifier absent from MusicBrainz's catalog** (surfaced by live verification) → the quoted-phrase release search on a title MusicBrainz does not carry verbatim (e.g. `"Midnights (3am Edition)"`, where MB's nearest is `"Midnights (The 3am Tracks)"`) returns zero hits, so resolution is *unresolved* — exact-after-normalization deliberately does not bridge the gap (a wrong edition would poison download validation). A possible follow-up is to fall back to a base-title search (stripping the parenthetical qualifier) so the caller at least gets the canonical album; deferred, as base-title extraction is itself heuristic and out of the agreed scope.

## Migration Plan

None needed: adapter-internal, no persisted state, no API surface change. Rollback is reverting the commit. Previously-failed acquisitions are terminal facts and stay failed; users resubmit the same descriptor and it resolves.

## Open Questions

None — identity level (release-group), edition rule (exact-after-normalization, canonical fallback), and deferrals (recordings, version-qualified descriptors, RG completeness fallback) were settled during exploration with the stakeholder.
