## 1. Edition selection & date ordering (pure, MusicBrainz mapping)

- [x] 1.1 Write failing unit tests for chronological partial-date ordering in `dateKey`/`compareReleases`: a fully-specified date sorts before a year-only date of the same year; year/month/day compared as components, not lexically.
- [x] 1.2 Replace `dateKey`'s raw-string key with a component-based (year, month, day) comparison where missing components sort after specified ones within the same year; keep it pure. Confirm 1.1 and existing `compareReleases` tests pass.
- [x] 1.3 Write failing unit tests for the release-group edition picker: select among **official** editions only; filter to the modal (most common) official track count; then earliest date (chronological); stable order as final tiebreak; modal-tie breaks to the lower track count; no title tier. Cover the simulation cases (standard vs deluxe/vinyl divergence).
- [x] 1.4 Write failing unit tests for the empty/no-official cases: a group with no official edition, and an empty group, both yield no candidate ids.
- [x] 1.5 Implement the release-group edition picker in `mapping.ts` (a pure function returning ordered release ids for a group's editions, taking `{ id, status?, date?, trackCount }`). Keep title-tier logic out of this path. Confirm 1.3–1.4 pass.

## 2. MusicBrainz adapter — release-group resolution branch

- [x] 2.1 Add a tolerant browse schema (`schemas.ts`) for `GET /release?release-group={mbid}&inc=media`: `releases[]` with optional `id`, `title`, `status`, `date`, `media[].track-count`. Write failing schema tests including sparse/missing fields.
- [x] 2.2 Write a failing adapter test (HttpClient stub) for `resolveReleaseByReleaseGroup`: fetches the browse URL, computes the pick via the picker, and reuses `resolveReleaseById` to produce the target; 404 / empty group / no-official-edition → unresolved; first pick with unusable data falls through to the next.
- [x] 2.3 Implement `resolveReleaseByReleaseGroup` and the `kind === 'release-group'` branch in `doResolve`; map browse editions to the picker's input and route the picked edition through `resolveReleaseById`.

## 3. Downloader domain & request plumbing

- [x] 3.1 Write a failing domain test adding `{ kind: 'release-group'; mbid; targetType: 'album' }` to `AcquisitionRequest` and asserting it round-trips on `AcquisitionRequested` and drives a `ResolveMetadata` effect.
- [x] 3.2 Add the release-group request kind to `AcquisitionRequest` (`events.ts`); resolve any exhaustiveness breaks the new member surfaces.
- [x] 3.3 Plumb the new kind through the request-entry contract (edge request schema / facade / HTTP / MCP) additively so a caller can submit a release-group id; write failing contract/schema tests first. No existing request shape changes.

## 4. Contract tests, spec scenarios, and the gate

- [x] 4.1 Extend the MusicBrainz contract tier (fixtures + contract test) to cover the release-group browse endpoint.
- [x] 4.2 Ensure every scenario in the `metadata-resolution` delta is covered by a test (map scenario → test).
- [x] 4.3 Run `pnpm check` (format, lint, typecheck, build, test w/ 100% coverage) and `openspec validate request-by-release-group-id --strict`; fix any gaps.
- [x] 4.4 Manually verify against a real release-group MBID (an album with a clear standard/deluxe split resolves to the standard edition; a group with no official edition resolves as unresolved).
