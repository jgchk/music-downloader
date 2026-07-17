## Why

`AcquisitionState` is one wide interface with six optional fields, so every phase-specific guarantee ("Downloading always has a current candidate") lives only in comments and runtime guards — the type system permits invalid states, the domain carries 14 non-null assertions (`decide.ts` ×10, `react.ts` ×4), and terminal states retain stale in-flight data by accident of object spreading. This violates our "make invalid states unrepresentable" principle. Investigating the restructure also surfaced a real staging leak: import conflicts and cancellations never fire the `Cleanup` effect, so fully-downloaded releases sit orphaned in staging — and fixing that depends on exactly the variant-payload decisions this change must make anyway.

## What Changes

- Restructure the private `AcquisitionState` into a discriminated union keyed on `phase` — one variant per phase (11), with shared base interfaces (a `Progress` core of `rejected`/`searchRounds`/`attempts`, and accreting payload bases) factored out.
- `evolve` narrows to each event's legal source phase(s) and **ignores out-of-protocol events** (returns state unchanged) — adopting the community-standard totality semantics for event-sourced folds (Dudycz, Chassaing, Emmett, Equinox), verified by a table-driven cartesian test (every event × every non-matching phase).
- `react` narrows on the post-event state's phase with a no-op `[]` fallback; `decide`'s existing phase guards now narrow the union, deleting all non-null assertions.
- Terminal variants carry only honest payload: `Conflicted` keeps its `current` candidate (always reachable from `Importing`); `Cancelled` keeps `current` only when cancelled from `Validating`/`Importing` (transfer settled); `Fulfilled`/`Exhausted`/`Cancelled` drop stale working-set data. The read snapshot consequently stops reporting an in-flight candidate on terminal acquisitions.
- **Staging cleanup fixes** enabled by those variants — `react` now emits `Cleanup`:
  - on `ImportConflicted` (the downloaded release will never be imported);
  - on `AcquisitionCancelled` when a settled candidate's files are staged;
  - on `Imported` (removes the now-empty candidate staging directory after files move to the library).
- The `Imported` event becomes a state no-op in `evolve` (`AcquisitionFulfilled`, always co-emitted, carries `location`), so `Importing` needs no optional `location`.
- **Out of scope:** aborting an in-flight slskd transfer on cancel (cancel-during-`Downloading` cleanup is racy without it). The `Cancelled`-without-`current` variant is the deliberate seam for that future change.
- No public contract changes: the state type is a private module internal; commands, events, `DomainError`, `Effect`, and `AcquisitionPhase` are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acquisition-aggregate`: adds a requirement that rehydration is a total, tolerant fold — events that do not fit the current phase are ignored during replay (never throw, never produce an invalid state), with protocol violations surfacing as typed rejections on the next command.
- `library-import`: extends staging hygiene beyond candidate rejection — staged files are also discarded on import conflict and on cancellation once the transfer has settled, and the staging directory is removed after a successful import.

## Impact

- **Code:** `src/domain/acquisition/{state,decide,react,acquisition}.ts` and their tests; new `evolve` totality tests and `react` fallback tests. No changes to ports, adapters, events, commands, or interfaces — the `Cleanup` effect and `discardStaging` port already exist.
- **Behavior:** staged files no longer leak on conflict/cancel/import; `AcquisitionSnapshot.currentCandidate` is absent on terminal acquisitions (previously could report a stale in-flight candidate — a read-model lie, now fixed). Replay of a corrupt/hand-edited history degrades to ignored events instead of a silently invalid folded state.
- **Constraints honored:** domain stays pure and throw-free (totality *is* the errors-as-values design for folds); 100% coverage via cartesian totality tests and reachable fallback branches; additive-only public contracts (nothing public changes).
