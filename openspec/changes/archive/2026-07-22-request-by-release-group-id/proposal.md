## Why

Callers can name an album two ways today — a specific MusicBrainz **release** (edition) MBID, or a free-text descriptor that the system searches and disambiguates. But the most natural identifier for "this album, whichever edition" is the MusicBrainz **release-group** MBID, and it is currently unsupported: a release group has no track list, so it cannot become a target directly, and there is no path that turns a bare group id into a canonical edition. This forces callers to pre-resolve an edition themselves or fall back to fuzzy descriptor search for an album whose identity they already know exactly.

## What Changes

- Add a third `AcquisitionRequest` kind — a MusicBrainz **release-group** id — alongside the existing release-MBID and descriptor kinds. Additive to the public request contract; existing kinds are unchanged.
- Resolve a release-group request by fetching the group's editions and selecting a representative **official** one, then producing the canonical target from that edition (reusing the existing by-release-id fetch). Identity is given, so the search / release-group grouping / ambiguity guard of the descriptor path are skipped.
- Define the edition-selection heuristic for this path:
  - **Drop the exact-title tier** — a bare group id carries no edition-title intent to honor.
  - **Constrain to the modal track count first**: among the group's official editions, restrict to those whose total track count equals the most-common (modal) track count, then pick the earliest-dated one (stable order as the final tiebreak). A data-backed simulation over 9 divergent-edition albums showed plain "official → earliest date" picks the standard edition in only 7/9 (missing e.g. Taylor Swift *1989* and Kendrick *good kid, m.A.A.d city*), while the modal-track-count constraint scored 9/9. Modal track count is a proxy for the canonical edition and for what files are commonly findable, minimizing `WrongTrackCount` validation failures.
  - Define a deterministic break when two track counts tie for the mode (prefer the lower count).
- When the release group has **no official edition**, resolve to a clean metadata-resolution failure (`unresolved`), consistent with how other no-confident-match cases fail today — rather than silently selecting a bootleg/promo. (A follow-up change, `manual-edition-selection`, upgrades this dead-end to a human-in-the-loop edition choice.)
- Fix a pre-existing edition-ordering defect that also affects the **live descriptor path**: partial MusicBrainz dates are compared lexically, so a year-only `2012` sorts before a same-year, fully-specified `2012-10-22`, rewarding imprecise dates. Order by true chronology with a defined precision policy instead.

## Capabilities

### New Capabilities

_(none — this extends an existing capability)_

### Modified Capabilities

- `metadata-resolution`: add the release-group-id request kind and its edition-selection heuristic (modal-track-count constraint over official editions, no title tier); correct partial-date edition ordering; specify that a release group with no official edition fails cleanly as unresolved.

## Impact

- **Public contract** (`external-api-contracts`, additive): a new request kind on the acquisition-request API. No existing shape changes; contract tests extended, not broken.
- **Downloader domain**: `AcquisitionRequest` union gains the release-group kind. Domain stays pure; no new events/commands/state (resolution outcome remains `resolved | unresolved`).
- **MusicBrainz adapter**: new by-release-group resolution branch in `doResolve`; a new edition picker in the mapping layer (modal-track-count over official editions, chronological date ordering); a consumer schema for the release-group browse (media/track-count, status, date). Boundary faults still surface as `InfraError`.
- **Tests**: test-first across domain, adapter, contract, and the metadata-resolution spec scenarios; 100% coverage preserved.
