## Context

Release-group resolution (v2.1.2) collapsed the many-editions problem: hits group by release-group id, the 90/10 confidence/margin guard runs across groups, and edition selection happens inside the winner. Live use (2026-07-19) exposed the next failure class: MusicBrainz scores derivative-named sibling groups ("Discovery Remixed" 94, "Re-Discovery" 94) within the 10-point margin of the exact-titled group ("Discovery" 100), so `releaseCandidateIds` declares ambiguity and the descriptor path fails for precisely the well-known albums it exists for. The resolver already owns a strict title-equality relation (`normalizeTitle` — NFC, casefold, punctuation/whitespace collapse, exact equality only) used for edition selection; this change promotes the same relation into identity resolution.

## Goals / Non-Goals

**Goals:**

- A descriptor request whose title names exactly one high-confidence release group resolves to it, regardless of derivative-named siblings' scores.
- Symmetry: naming the derivative group resolves to the derivative group.
- Every case the title relation does not decide keeps today's fail-safe behavior unchanged.

**Non-Goals:**

- No fuzzy or partial title matching — exact-after-normalization equality only (a wrong identity becomes the download validation contract).
- No change to track/recording descriptors (`bestMatchId` path — known deferred gap), by-identifier requests, or edition selection.
- No artist-side disambiguation changes.

## Decisions

### D1 — Title-exactness decides before the margin guard, never instead of confidence

In `releaseCandidateIds`, after grouping and ranking: let `titled` = high-confidence groups (score ≥ `HIGH_CONFIDENCE`) whose release-group title equals the request title under `normalizeTitle`. If `titled` has exactly one member, it is the resolved identity — the margin guard against non-titled siblings is skipped, because the request text itself disambiguates. If `titled` has multiple members (distinct albums genuinely sharing a title), or none (typos, partial titles), the existing margin guard applies over the full ranking — for multiple titled groups this fails safe rather than guessing, and for none it behaves exactly as today. The `HIGH_CONFIDENCE` floor is never waived: an exact-titled group scoring below it does not resolve.

### D2 — The group's title is the release-group title, with the singleton fallback keeping its release title

`GroupedRelease` grows the release-group title (already present on every search hit alongside the id). Hits without a release-group id — today's conservative singleton groups keyed by release id — use their release title as the identity title, preserving the existing "can only widen apparent ambiguity" posture while letting an exactly-titled ungrouped hit still benefit from the preference.

### D3 — Reuse `normalizeTitle` verbatim

Identity comparison and edition comparison intentionally share one equality relation. Divergence between the two would reintroduce the class of bug where a request resolves to a group whose editions can never match the same text.

## Risks / Trade-offs

- **[Derivative group whose title normalizes equal to the base]** e.g. a remaster group also titled exactly "Discovery" — becomes a multiple-titled-groups tie and fails safe, same as today. Acceptable: genuinely underdetermined input.
- **[MB titling noise]** A sloppily-titled derivative group could equal the request and win over a lower-scoring base group... only if the base group is *not* also exactly titled (then it's a tie → fail safe) — the confidence floor plus exactness keeps this at the level of MB data errors, which no margin heuristic survives either.

## Open Questions

- None; scope is deliberately a single mapping-function refinement.
