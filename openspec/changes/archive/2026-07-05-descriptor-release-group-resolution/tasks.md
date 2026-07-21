# Tasks: descriptor-release-group-resolution

Test-first throughout: each task's tests are written red before the production change that turns them green (one gate-passing commit per coherent step).

## 1. Consumed contract: release-search hit fields

- [x] 1.1 Extend `mbReleaseSearchSchema` hit entries in `src/adapters/musicbrainz/schemas.ts` to consume `title`, `status`, `date`, and `release-group` (`{id}`) — all optional — with schema tests covering presence, absence, and tolerated unknown fields
- [x] 1.2 Extend `test/contract/fixtures/musicbrainz/release-search.json` for the newly consumed fields — the recorded Dark Side of the Moon response already carries real multi-edition, single-release-group data with `title`/`status`/`date`/`release-group.id`; only the request `limit` was updated (5 → 100) to match the adapter
- [x] 1.3 Tolerate `length: null` on tracks/recordings in `schemas.ts` (MusicBrainz reports unknown durations as null, not drift) so a real release with unknown durations collapses to no-valid-target and falls through rather than raising an InfraError — surfaced by the live check (task 6.3), where a popular album's canonical pick had null track lengths; mapping already coerces null → 0 (unusable) via `?? 0`, with schema + mapping tests for the null case

## 2. Pure selection logic (mapping.ts)

- [x] 2.1 Add a title-normalization function (`normalizeTitle`: NFC, casefold, collapse non-alphanumeric runs incl. parens/brackets, trim) with table-driven tests pinning the equal/not-equal cases from the delta spec (case/punctuation/whitespace variants equal; base title vs qualified edition title not equal)
- [x] 2.2 Add release-group grouping (`releaseCandidateIds`) with the cross-group confidence/ambiguity guard (group score = max hit score; best group ≥90 and ≥10 over runner-up group, else no candidates): tests for single-group many-editions (resolves), two groups within margin (ambiguous), clear-winner group, sub-90 best (weak), empty/missing input, ungrouped-hit singleton, id-less hit skipped, scoreless-hit default
- [x] 2.3 Add edition ordering within the winning group — normalized-title matches first, then canonical rule (Official before other/missing, earliest date first via a lexicographic key, undated last, stable on ties) — returning ordered candidate release ids; tests for base-title request, edition-qualified request, no-title-match fallback to canonical, missing status/date, and undated-stable ordering
- [x] 2.4 `bestMatchId` remains and is still the recording-descriptor path (no behavior change for recordings); its existing tests are intact and its doc-comment now points at `releaseCandidateIds` for the album path

## 3. Lucene query escaping

- [x] 3.1 Add `lucenePhrase` escaping (backslash and quote backslash-escaped inside the quoted phrase) applied in both the release and recording query builders in `src/adapters/musicbrainz/metadata.ts`; test captures the sent URL for a quoted title (`"Heroes"`) and asserts the escaped Lucene phrase

## 4. Adapter orchestration (metadata.ts)

- [x] 4.1 Raise the release search to `limit=100` (release path; recording path keeps its configured limit) and switch `resolveReleaseByDescriptor` to the new selection: search → ordered candidate ids → fetch releases in order until one yields a valid `Target`, unresolved when the list is exhausted; unit tests with a stubbed HTTP client for the resolve, ambiguous, edition-honored, and all-candidates-unusable paths
- [x] 4.2 Test the sparse-data fall-through explicitly: the canonical pick's release fetch yields no valid target (missing track data), and resolution falls through to the next candidate

## 5. Contract tier and E2E stubs

- [x] 5.1 Update `test/contract/musicbrainz.contract.test.ts` for the new behavior (famous album now resolves by grouping its editions; asserts recorded search query, canonical-pick fetch attempt, and end-to-end resolution via fall-through) and keep the recording tier on `bestMatchId`; the recording script now emits `limit=100` for release search and selects the canonical release for the lookup, and the drift replay replays the (updated) recorded request set
- [x] 5.2 Add the E2E WireMock release-search stub `test/e2e/stubs/musicbrainz/mappings/search.json` (multi-edition, single release-group, resolves to `release-1`) and register it in `stubSchemas` so the stub-conformance contract test validates it against `mbReleaseSearchSchema` in the gate

## 6. Verification

- [x] 6.1 Full gate green: `pnpm check` — format, lint, typecheck, build, unit tests at 100% coverage (all four metrics), contract tier, release tier
- [x] 6.2 Out-of-process E2E green: `pnpm test:e2e` built the image, brought up app + both stubs, and passed (3 tests, exit 0) with the new search stub loaded. The change does not touch the MBID resolution path, the download/validate/import cascade, or ports, so the existing MBID acquisition E2E is the e2e gate. A dedicated descriptor-acquisition e2e was **not** added: it would resolve to the same `release-1` and collide with the existing test's library/staging-cleanup state, while descriptor resolution itself is already exercised over real HTTP by the contract tier.
- [x] 6.3 Live-MusicBrainz sanity check (rate-limited through the real adapter): **OK Computer** resolves (12 tracks); **Midnights (The Til Dawn edition)** resolves to that exact 23-track edition (edition text honored); **Midnights** base resolves to the 13-track base album (not the edition); a nonexistent album resolves cleanly to *unresolved*. This run caught two issues since fixed: the null-track-length InfraError (task 1.3) and the fact that an edition qualifier absent from MusicBrainz's catalog (e.g. the literal "Midnights (3am Edition)", which MB does not carry — its nearest is "Midnights (The 3am Tracks)") yields *unresolved*, since the quoted-phrase search returns no hits and exact-after-normalization deliberately does not guess. See design.md "Risks / Trade-offs" — a base-title fallback for unmatched edition qualifiers is a possible follow-up, deferred pending a scope decision.
