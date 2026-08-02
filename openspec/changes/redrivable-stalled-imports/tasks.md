# Tasks — redrivable-stalled-imports

Test-first throughout: every production line lands behind a failing test, run red first (repo
non-negotiable; see memory `tdd-authorship-order-enforced`). References: design.md D1–D5.

## 1. Importer domain (D1)

- [ ] 1.1 `RetryApply` command + `ApplyRetryRequested` event types (red: decide/evolve/react
      tests first)
- [ ] 1.2 `decide`: applying → emit; terminal → absorb; other phases → modeled illegal
- [ ] 1.3 `evolve`: identity on applying (and a degradation arm consistent with the fold's
      tolerant regime)
- [ ] 1.4 `react`: re-derive the Apply effect from state, mirroring the existing arms

## 2. Application + facade (D2, D3)

- [ ] 2.1 `retryImport` use-case: stalled-exposure gate (`NotStalled` modeled refusal),
      dispatch through the normal command path
- [ ] 2.2 Facade command `retryImport({id})` with modeled error mapping; response `{importId}`
- [ ] 2.3 Additive `apply-retried` history kind in the projection + facade schema (with `at`)
- [ ] 2.4 Reactor integration test: dead-lettered apply → retry event → fresh budget, dead
      letters cleared, effect re-dispatched; failure path stalls again

## 3. Web (D4, D5)

- [ ] 3.1 Copy additions (status phrase, now-row, affordance label, timeline entry, NotStalled
      error) in the copy modules' `satisfies`-checked regime
- [ ] 3.2 Acquisition detail: stalled attention state (decided-flag gated), retry affordance +
      route action dispatching `retryImport`, modeled-error rendering
- [ ] 3.3 Attention queue: `stalled-import` arm from `listImports()`, optional-href rendering,
      composed titles; nav badge follows
- [ ] 3.4 SSR/page-server tests for all of the above; timeline renders `apply-retried`

## 4. Gate and verification

- [ ] 4.1 `pnpm check` green (100% coverage both packages)
- [ ] 4.2 Local `pnpm test:e2e` (user-visible strings in the diff; ship.md Phase 5 step 1)
- [ ] 4.3 Verify the full loop against the dev app or e2e stack: stall → queue entry → retry →
      applied
