## 1. Mapping: the titled-group preference

- [x] 1.1 Write failing `mapping.test.ts` cases for `releaseCandidateIds`: exact-titled group wins over a within-margin derivative-named sibling (the Discovery/Discovery Remixed shape); request naming the derivative group resolves to it; two exact-titled high-confidence groups fail safe (`[]`); no titled group → existing margin behavior preserved (both the pass and the ambiguity-fail variants); an exact-titled group below `HIGH_CONFIDENCE` does not resolve; a singleton (no release-group id) hit participates via its release title.
- [x] 1.2 Implement: `GroupedRelease` retains the group's identity title (release-group title; release title for the singleton fallback); apply the `titled`-set decision from design D1 ahead of the margin guard; reuse `normalizeTitle`.

## 2. Gate + fidelity

- [x] 2.1 `pnpm check` green (100% coverage on the new branches); doc comments on `releaseCandidateIds` updated to describe the preference and its fail-safe ties.
- [ ] 2.2 Live verification after merge/deploy: descriptor request "Daft Punk / Discovery" resolves and proceeds past metadata resolution (was `MetadataFailed`), and a control ambiguous request still fails cleanly.
