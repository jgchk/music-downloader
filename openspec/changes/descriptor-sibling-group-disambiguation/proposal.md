## Why

Descriptor album requests still hit `MetadataFailed` for exactly the popular records the human-friendly path exists for — not because of edition ambiguity (fixed by release-group resolution, v2.1.2) but because of **sibling release groups with derivative names**: resolving "Daft Punk / Discovery" fails on v2.4.0 because the "Discovery" group scores 100 while "Discovery Remixed" scores 94, inside the 10-point ambiguity margin, even though only one group's title is what the user typed. Any album with a similarly-named remix/bootleg/compilation cousin fails the same way (reproduced live 2026-07-19).

## What Changes

- Identity resolution for descriptor album requests gains a **title-exactness preference ahead of the score-margin guard**: when exactly one high-confidence release group's title equals the requested title after normalization (the same strict case/punctuation/whitespace-insensitive equality already used for edition selection), that group is the resolved identity regardless of how closely derivative-named siblings score.
- The score-margin ambiguity guard remains the arbiter everywhere the preference does not decide: when no group's title equals the request (typos, partial titles), and among multiple exactly-matching groups (two distinct albums genuinely sharing a title still fail safe).
- Requests that name the derivative group ("Discovery Remixed") resolve to it by the same rule — the preference is symmetric, not a bias toward "main" albums.
- No change to by-identifier requests, track/recording descriptors (still the known deferred gap), edition selection within a group, or any public contract.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `metadata-resolution`: identity resolution prefers the release group whose title equals the request after normalization before judging score ambiguity; the clean-failure requirement's definition of ambiguity is refined accordingly (comparably-scored sibling groups are not ambiguous when exactly one bears the requested title).

## Impact

- `src/adapters/musicbrainz/mapping.ts` — `releaseCandidateIds` (and its `GroupedRelease` shape, which must retain the release-group title); `normalizeTitle` reused as-is.
- `src/adapters/musicbrainz/mapping.test.ts` — new cases for the preference, symmetry, and fail-safe ties.
- No domain, port, API, or event changes; no config; no fixture/schema-gate impact.
