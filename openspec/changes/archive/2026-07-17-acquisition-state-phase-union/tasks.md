## 1. State union (`src/domain/acquisition/state.ts`)

- [x] 1.1 Define the shared bases (`Progress`, `Requested`, `Targeted`) and the 11 per-phase variants; replace the wide `AcquisitionState` interface with the discriminated union (design.md D1). Keep `AcquisitionPhase`, `initialState` (now `EmptyState`), `isTerminal`, and `foldEvents` signatures unchanged.
- [x] 1.2 Red: add the table-driven cartesian totality test — every event type × every non-matching phase variant returns the input state unchanged (design.md D6; aggregate spec "Rehydration is a total, tolerant fold"). Include a builder producing a representative state for each phase.
- [x] 1.3 Green: rewrite `evolve` — each case narrows to its legal source phase(s) and falls through to `return state`; construct full variants instead of spreading; `Imported` becomes a state no-op; terminal variants carry only their designed payload (`Conflicted.current` required, `Cancelled.current` only from Validating/Importing, stale `working`/`current` dropped elsewhere).
- [x] 1.4 Verify all existing `evolve`/fold test expectations still hold (adjusting only assertions that inspected fields the target phase no longer carries).

## 2. Decide (`src/domain/acquisition/decide.ts`)

- [x] 2.1 Delete all 10 non-null assertions, letting the existing phase guards narrow the union; retype `selectNext`/`rejectAndAdvance` parameters to the narrowed variants (`DownloadingState | ValidatingState`). No behavior change — the full existing decide test suite must pass untouched.

## 3. React (`src/domain/acquisition/react.ts`)

- [x] 3.1 Red: tests for the new `Cleanup` emissions — on `ImportConflicted` (post-state `Conflicted`), on `AcquisitionCancelled` with a settled `current` (cancel from Validating/Importing), and on `Imported` (post-state `Importing`); plus tests that cancel-from-Downloading and cancel-from-pre-download phases emit no `Cleanup` (library-import spec scenarios).
- [x] 3.2 Red: tests for the no-op fallbacks — each state-consuming event paired with a mismatched post-state phase yields `[]` (design.md D3).
- [x] 3.3 Green: rewrite `react` — replace the 4 non-null assertions with phase narrowing + `[]` fallbacks, and add the three `Cleanup` emissions per design.md D5.

## 4. Aggregate and boundary (`src/domain/acquisition/acquisition.ts`)

- [x] 4.1 Update the `snapshot` getter to read `current`/`location` via phase-aware narrowing (terminal snapshots no longer report a stale in-flight candidate); update/extend aggregate snapshot tests for the cancelled/conflicted cases.

## 5. Cleanup coverage in the e2e tiers

- [x] 5.1 In-process composition e2e (`src/composition/e2e.test.ts`): make the fake library port record `discardStaging` calls, and assert the existing "reports an import conflict" scenario discards the conflicted candidate's staging (currently the fake is a silent stub, so conflict cleanup is otherwise unobserved end-to-end).
- [x] 5.2 Out-of-process e2e (`test/e2e/acquisition.e2e.test.ts`): after the Fulfilled assertion, assert the candidate staging directory (already computed in the test via `candidateStagingDir`) has been removed — poll/retry briefly, since the reactor dispatches the `Imported` Cleanup around the same time the status turns Fulfilled. Note: the out-of-process cancel test (`mcp.e2e.test.ts`) cancels immediately after submit, *before* anything is staged — it exercises no cleanup path and needs no change; settled-phase cancel cleanup is covered by the unit tests in 3.1.

## 6. Verification

- [x] 6.1 Run `pnpm check` (format, lint, typecheck, build, 100%-coverage tests) and confirm zero `!` non-null assertions remain on acquisition state fields (`grep -n 'state\.\w*!' src/domain` is empty).
- [x] 6.2 Run `pnpm test:e2e` against live stubs — all pre-existing assertions pass unchanged (aggregate spec: behavior identical for legal histories), plus the new staging assertions from section 5.
