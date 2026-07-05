## Why

The domain layer currently exports its decider internals (`AcquisitionState`, `initialState`, `evolve`, `foldEvents`, `isTerminal`, `decide`, `react`) as loose functions and bare data, and application-layer code consumes them piecemeal — the reactor folds events and calls `react(event, state)` itself; the command handler folds and calls `decide` itself. This scatters the aggregate's mechanics across its callers, leaves no single named home for the acquisition aggregate, and makes the domain's real API surface far larger than its actual contract. Wrapping the (deliberately functional, spec'd-in-D2) decider in a pure `Acquisition` aggregate facade restores traditional DDD legibility and encapsulation without giving up the functional core or its mock-free test shape.

## What Changes

- Introduce a pure, immutable `Acquisition` aggregate class in `src/domain/acquisition/` — the single public face of the acquisition domain:
  - `static fromHistory(events): Acquisition` — rehydrate by folding.
  - `execute(command): Result<readonly AcquisitionEvent[], DomainError>` — the one command entry point (no per-intent method sugar).
  - `reactTo(event): readonly Effect[]` — event reactions without exposing state.
  - `isTerminal: boolean`.
- `decide`, `evolve`, `react`, `AcquisitionState`, `initialState`, `foldEvents`, and `isTerminal` become private module internals of the aggregate — no longer part of the domain's public API.
- Commands, events, `DomainError`, and `Effect` remain public: they are the contracts/wire format of the loop; state and decision logic become the secrets.
- Application layer consumes only the facade: `command-handler.ts` becomes load → `fromHistory` → `execute` → append; `reactor.ts` becomes load → `fromHistory` → `reactTo` → interpret.
- Decider tests keep their given-events → when-command → then-events shape, rephrased through the facade (`Acquisition.fromHistory(given).execute(when)`) — still pure, still mock-free.
- Additive constitution amendment to `docs/development/event-sourcing.md`: the decider is the aggregate's private engine; the aggregate class is its public face.
- Zero behavior change. Pure refactor of encapsulation and API surface; 100% coverage holds.

Out of scope (enabled by this change, deliberate follow-ups):

- Restructuring `AcquisitionState` into a phase-discriminated union (would eliminate the `state.target!` / `state.policies!` non-null assertions in `react.ts`) — becomes a private refactor once state is encapsulated.
- Similar facade treatment for match scoring, validators, and policies.

## Capabilities

### New Capabilities

- `acquisition-aggregate`: The acquisition domain's decision logic is exposed solely through the `Acquisition` aggregate facade — rehydration, command execution, and event reaction go through the aggregate; decider internals (state shape, fold, decision functions) are private to the domain and unreachable from other layers.

### Modified Capabilities

None — no external behavior changes. All existing capability specs (acquisition-lifecycle, candidate-search-and-ranking, download-management, download-validation, library-import, metadata-resolution, public-api, out-of-process-e2e) remain satisfied as written.

## Impact

- **Code**: `src/domain/acquisition/` (new `acquisition.ts` facade; `state.ts`, `decide.ts`, `react.ts` demoted to module internals), `src/application/acquisition/command-handler.ts`, `src/application/acquisition/reactor.ts`, `src/application/acquisition/use-cases.ts` (transitively, via command handler), domain test files (rephrased through the facade), `src/domain/index.ts` exports.
- **APIs**: No public HTTP/MCP contract changes. Internal domain module API shrinks substantially.
- **Docs**: `docs/development/event-sourcing.md` gains an additive line on aggregate-as-facade.
- **Enforcement**: lint/architecture boundary rules updated so layers outside the domain cannot import decider internals.
- **Dependencies**: none added or removed.
- **Risk**: low — behavior-preserving refactor guarded by the existing 100%-coverage test suite and E2E gate.
