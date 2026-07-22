## Context

Metadata resolution turns a request into a canonical `Target` before any search or download. A `Target` (`domain/target/target.ts`) is invalid without a non-empty track manifest — track count and per-track durations are what `download-validation` checks against. A MusicBrainz **release group** is an abstract album identity with no track list; only its member **releases** (editions) carry tracks. So every resolution path ultimately fetches a concrete release: the descriptor path (`resolveReleaseByDescriptor`) searches, groups hits by release group, disambiguates to one group, orders that group's editions via `compareReleases`, and fetches releases until one yields a valid target; the direct path (`resolveReleaseById`) fetches one named release.

There is no way to name a release group directly, even though it is the most precise "this album, any edition" identifier. This change adds that path. Because identity is *given* (the group id), the search / grouping / cross-group ambiguity guard are unnecessary — the work reduces to edition selection within a known group, which the codebase already does; the open questions are which edition is "representative" and what to do when none is confident.

## Goals / Non-Goals

**Goals:**
- Accept a MusicBrainz release-group MBID as a request and resolve it to a canonical target, additively (existing request kinds unchanged).
- Pick a representative edition with a heuristic validated against real data, minimizing `WrongTrackCount` validation failures downstream.
- Fail cleanly (unresolved) — never silently pick a bootleg — when no official edition exists.
- Fix the partial-date edition-ordering defect that already degrades the live descriptor path.

**Non-Goals:**
- Recording/track-level release-group semantics (release groups are album identities; the track path is untouched).
- Human-in-the-loop manual edition selection — deferred to the `manual-edition-selection` follow-up change, which upgrades the "no official edition" dead-end (D3) into a user choice. This change keeps the resolution outcome binary (`resolved | unresolved`).
- Changing MusicBrainz as the metadata source or the `Target` shape.
- A popularity/listen-count signal for "canonical edition" (MusicBrainz exposes none; modal track count is the proxy).

## Decisions

### D1 — A third `AcquisitionRequest` kind, resolved by a new adapter branch

Add `{ kind: 'release-group'; mbid: string; targetType: 'album' }` to the `AcquisitionRequest` union. `targetType` is `'album'` only — a release group has no track analogue. `doResolve` gains a branch that calls a new `resolveReleaseByReleaseGroup(mbid)`, which fetches the group's editions via `GET /release?release-group={mbid}&inc=media+recordings&fmt=json&limit=100`, selects an edition, and reuses `resolveReleaseById` to fetch the full target. Reusing `resolveReleaseById` keeps a single code path for "release id → target" and its skip-on-unusable-data fall-through.

**Alternative considered:** overload the existing `musicbrainz` kind and probe whether the MBID is a release or a group. Rejected — MBIDs are not type-tagged, so it would require an extra classifying request and make the caller's intent implicit. An explicit kind is clearer and cheaper.

### D2 — Edition selection: modal track count, then Official, then earliest date; no title tier

For this path, select among the group's **official** editions (a release-group request wants a canonical, official target; non-official-only groups are handled by D3):
1. **Restrict to official editions.** If none exist, D3 applies.
2. **Filter to the modal track count** — the total track count (sum of `media[].track-count`) held by the most *official* editions in the group. Computing the mode over official editions (rather than all editions) keeps the winner official by construction and avoids a modal count that no official edition has; for the simulation's mainstream albums the official mode equals the overall mode, so the validated 9/9 result is unaffected.
3. Among those, earliest release date (see D4).
4. Stable order as the final deterministic tiebreak.

The exact-title tier of `compareReleases` is dropped: a bare group id carries no edition-title intent, so there is nothing to match against.

Rationale is empirical. A simulation over 9 divergent-edition albums (real MusicBrainz data; script + raw JSON retained) compared candidates:
- Plain "Official → earliest date": picked the modal-track-count edition in **7/9**, failing exactly the albums the picker must get right — *1989* (chose the 19-track deluxe over the 13-track standard) and *good kid, m.A.A.d city* (chose a 15-track vinyl over the 12-track standard).
- Modal-track-count constraint added: **9/9**.

The standard edition is pressed across the most regions/formats, so it dominates both the modal track count among MB editions and what users can actually find; matching it is the best available predictor of validation success.

**Alternatives considered:** format preference (CD/Digital) — noisier and regionally biased; country preference (US/XW) — many canonical editions are `XE`/`XW`/regional, and it does not address track-count divergence; average track count — meaningless (fractional), not a real edition.

### D3 — No official edition → unresolved (manual selection deferred)

A release-group request whose group has **no official edition** resolves to `unresolved` (a clean metadata-resolution failure visible to the caller), rather than silently selecting a bootleg/promo. This matches the existing fail-safe philosophy (ambiguity / no-confident-match → unresolved) and keeps this change's resolution outcome binary. An empty group — no releases at all — is likewise `unresolved`, consistent with the direct path's 404 handling.

**Follow-up:** the product intent is a human-in-the-loop choice here, captured in the `manual-edition-selection` change. It upgrades this dead-end to a `needsSelection` outcome carrying the candidate editions, an `AwaitingManualSelection` aggregate state, and a `SelectEdition` command whose resume reuses the direct-by-release-id path. That work is deliberately separated so this change stays a focused, reviewable slice with no new domain state.

**Alternatives considered:** fall back to any edition regardless of status — rejected, risks silently downloading a bootleg the caller did not ask for.

### D4 — Chronological partial-date ordering (fixes a live defect)

`dateKey` currently returns the raw MusicBrainz date string, so lexical comparison ranks a year-only `2012` before a same-year `2012-10-22`. Replace it with a comparison over normalized `(year, month, day)` components where missing components sort **after** specified ones within the same year — i.e. a fully-specified date is treated as earlier/more canonical than a vague year-only date for the same year. This removes the "imprecision wins" bias and is applied to `compareReleases` for **both** the descriptor path and the new release-group path. This also hardens D2: even before the modal filter, date ordering no longer favors the odd year-only vinyl/deluxe pressings that caused two of the simulation misses.

### D5 — A tolerant browse schema for release-group editions

The by-release-group fetch (`GET /release?release-group={mbid}&inc=media`) returns a `releases` array with each edition's `id`, `title`, `status`, `date`, and `media[].track-count`. This is a new consumer-contract schema (distinct from the scored search schema — a browse has no `score`). All fields are optional so provider drift or a sparse edition never throws; an edition missing a track count is treated as track count 0 for modal computation and simply won't win. Contract-schema violations still surface as `InfraError` at the boundary, never as malformed data reaching the pure selection logic. (The `country` and `media[].format` fields needed only to *present* candidates are added by the `manual-edition-selection` follow-up, not here.)

## Risks / Trade-offs

- **Modal-across-MB-editions ≠ modal-across-what-people-share.** For an album whose deluxe is the culturally definitive version, the mode still picks the standard edition. → Acceptable: a bare group id expresses no edition preference, and the standard edition is the safe default (its track list is the common subset). A future explicit-edition request and the `manual-edition-selection` follow-up remain the escape hatches.
- **Modal-count tie** (two track counts equally common). → Deterministic break specified in the spec (prefer the lower track count — the more conservative, standard-like edition — then earliest date, then stable order). No sample album hit this, so it is defined, not observed.
- **No-official-edition groups fail silently to the caller** (this change resolves them to `unresolved`). → Accepted as an interim behavior; the `manual-edition-selection` follow-up turns it into a surfaced human choice. Never auto-commits to a bootleg in the meantime.
- **Partial-date semantics are a judgment call** (is year-only "earliest" or "latest" in its year?). → We choose "more-precisely-dated wins within a year," which fixes the observed misses and is defensible as preferring the better-catalogued release; documented in the spec so it is intentional, not incidental.

## Migration Plan

Additive and backward-compatible — no data migration. The new request kind appends to the `AcquisitionRequest` union; historical events replay unchanged (tolerant reader), and the resolution outcome stays `resolved | unresolved`. Ship behind the normal release flow. Rollback is a plain revert: no persisted event depends on the new kind unless a caller uses it.

## Open Questions

- Does the release-group request kind warrant exposure on the **MCP tool** surface immediately, or HTTP/UI first? (Contract is additive either way.)
- Confirm the exact MusicBrainz browse parameters (`inc=media`, `limit=100`, paging) return `media[].track-count` for all editions without `inc=recordings`, so the picker needs only one lightweight browse per request before the full by-id fetch.
