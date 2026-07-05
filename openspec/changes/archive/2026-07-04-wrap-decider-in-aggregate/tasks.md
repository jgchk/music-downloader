## 1. Aggregate facade (test-first, additive — existing exports untouched)

- [x] 1.1 Write `src/domain/acquisition/acquisition.test.ts` with failing tests for `Acquisition.fromHistory` + `execute`: port a representative set of existing `decide` given/when/then cases through the facade (same events / same `DomainError` expected), plus repeatability on one instance (execute twice → same result, `phase`/`isTerminal` unchanged)
- [x] 1.2 Implement `src/domain/acquisition/acquisition.ts`: immutable `Acquisition` class with private constructor over `AcquisitionState`, `static fromHistory` (delegates to the existing fold), `execute` (delegates to `decide`), `reactTo` (delegates to `react`), `isTerminal` and `phase` getters; re-export `DomainError` and `Effect` from this module as the public export points
- [x] 1.3 Extend the facade tests to cover `reactTo` (port representative `react` cases) and `phase`/`isTerminal` across rehydrated histories for every phase

## 2. Migrate consumers to the facade (one at a time, gate green after each)

- [x] 2.1 `command-handler.ts`: replace `foldEvents` + `decide` with `Acquisition.fromHistory(...).execute(...)`; import `DomainError` from the facade module; update its tests' imports/phrasing only where they referenced internals
- [x] 2.2 `reactor.ts`: replace `foldEvents` + `react` with `Acquisition.fromHistory(...).reactTo(...)`; update reactor tests likewise
- [x] 2.3 `projections/read-models.ts`: replace `foldEvents(...).phase` with `Acquisition.fromHistory(...).phase` (via a read snapshot — projectStatus also needs current/attempts/rejected/location); keep importing `AcquisitionPhase` from its public export point
- [x] 2.4 `interpreter.ts` (and any other `Effect` importers): switch `Effect` imports to the facade module's re-export
- [x] 2.5 `composition/e2e.test.ts` and remaining test files: switch `AcquisitionPhase`/type imports off `state.js` to the public export point

## 3. Seal the boundary

- [x] 3.1 Migrate the existing `decide.test.ts` / `state.test.ts` (fold coverage) / `react.test.ts` cases to phrase through the facade (consolidated into `acquisition.test.ts`, three old files deleted); confirmed 100% coverage of `decide.ts`, `state.ts`, `react.ts` reached via the public surface alone — no dead code, no testing-around
- [x] 3.2 Add the lint boundary: extend `import/no-restricted-paths` zones so imports of `src/domain/acquisition/state.js`, `decide.js`, and `react.js` from outside `src/domain/acquisition/` fail lint; verify a deliberate violation fails, then remove it
- [x] 3.3 Update `src/domain/index.ts` header comment (and any barrel exports) to name the aggregate facade as the acquisition module's public face

## 4. Constitution and verification

- [x] 4.1 Amend `docs/development/event-sourcing.md` (additive): the decider is the aggregate's private engine; the aggregate class is its public face — only the aggregate, commands, events, effects, and phase are visible outside the domain
- [x] 4.2 Run the full gate (`pnpm check`: format, lint, typecheck, build, tests with 100% coverage) and the e2e suite; confirm zero behavioral diffs and all existing capability specs' scenarios still pass unmodified — gate green (390→326 unit tests after test consolidation, 100% coverage), out-of-process Docker E2E passed against the rebuilt image
