## Context

The bootstrap build implemented the acquisition core as a functional decider (D2, Chassaing): `decide`, `evolve`, `react` are pure, total functions, state is a fold over events. That choice is spec'd in the constitution (`docs/development/event-sourcing.md`) and load-bearing for the test strategy (D4: given-events → when-command → then-events, mock-free).

What was never chosen deliberately is the domain's *public surface*. Today `state.ts`, `decide.ts`, and `react.ts` export everything, and application code consumes the internals piecemeal:

- `command-handler.ts` imports `decide`, `DomainError`, `foldEvents` and runs the fold-then-decide sequence itself.
- `reactor.ts` imports `foldEvents`, `react` and runs fold-then-react itself.
- `projections/read-models.ts` imports `foldEvents` and `AcquisitionPhase` to derive the status view's phase.
- `interpreter.ts` imports the `Effect` type.
- `composition/e2e.test.ts` imports `AcquisitionPhase`.

There is no named aggregate; the aggregate's mechanics (rehydration, guarding, reaction) are re-assembled at every call site. This change wraps the decider in a pure `Acquisition` aggregate facade — the classic "aggregate as the public face of a decider" resolution — without altering the decider itself or any behavior.

## Goals / Non-Goals

**Goals:**

- One named, pure, immutable `Acquisition` aggregate class as the sole entry point to acquisition decision logic.
- Decider internals (`AcquisitionState` shape, `initialState`, `evolve`, `foldEvents`, `isTerminal`, `decide`, `react`) become private to `src/domain/acquisition/` — unreachable from other layers, enforced by lint.
- Application layer reads as textbook DDD: load → rehydrate → execute/react → append/interpret.
- Zero behavior change; 100% coverage and all existing capability specs hold as written.
- Constitution amended (additively) to record the aggregate-as-facade pattern.

**Non-Goals:**

- No per-intent method sugar (`submit()`, `cancel()`) — `execute(command)` is the only command entry point. The feedback loop is command-shaped by construction (the interpreter turns effect results back into commands); intent methods would re-encode the command union as a method list.
- No uncommitted-events tracking, no repository pattern. The command handler never needs post-command state, so the facade stays immutable and thin.
- No change to commands, events, `DomainError`, or `Effect` — they are the contracts/wire format of the loop and stay public.
- No restructuring of `AcquisitionState` into a phase-discriminated union (explicit follow-up; this change makes it a private refactor).
- No facade treatment for match scoring, validators, or policies (follow-up, if the aggregate proves the pattern).

## Decisions

### D1 — Aggregate as pure facade in the domain layer, decider as its private engine

`Acquisition` lives in `src/domain/acquisition/acquisition.ts`. It performs no I/O and holds no mutable state — it is *not* the imperative shell; the shell (command handler, reactor, interpreter) stays in the application layer. The class wraps a privately-held `AcquisitionState`:

```ts
export class Acquisition {
  private constructor(private readonly state: AcquisitionState) {}

  static fromHistory(events: readonly AcquisitionEvent[]): Acquisition;   // fold via evolve
  execute(command: AcquisitionCommand): Result<readonly AcquisitionEvent[], DomainError>; // delegates to decide
  reactTo(event: AcquisitionEvent): readonly Effect[];                    // delegates to react
  get isTerminal(): boolean;
  get phase(): AcquisitionPhase;                                          // see D3
}
```

*Alternatives considered:* (a) classic mutating ES aggregate with uncommitted-events tracking — rejected: the command handler folds, decides, appends and never needs post-command state, so the tracking machinery would be dead weight and would break "immutability by default"; (b) full OO aggregate replacing the decider — rejected: contradicts `event-sourcing.md` and destroys the D4 mock-free test shape; (c) status quo (functions only) — rejected: no named aggregate, oversized public surface, aggregate mechanics duplicated at call sites.

### D2 — Generic `execute(command)` only; no intent methods

The reactor loop feeds commands produced from effect results back through the same entry point, so command-shaped dispatch must exist regardless. Adding `submit()`/`cancel()` sugar would create a second, redundant API for the same union. If a human-facing caller ever genuinely benefits from named intents, that is an additive follow-up.

### D3 — Public surface: `Acquisition`, `AcquisitionPhase`, commands, events, `DomainError`, `Effect`; everything else private

- `AcquisitionPhase` stays public: it appears in the HTTP contract (status views) and is consumed by projections and the e2e suite. The facade exposes it via a `phase` getter; the *full* `AcquisitionState` shape (working set, rejected keys, attempts, …) becomes private.
- **Read snapshot (deviation from a phase-only getter, discovered in implementation):** `projectStatus` reads not just `phase` but `current`, `attempts`, `rejected`, and `location` to build the status view. These are *already* public fields of the HTTP `AcquisitionStatusView` contract — not write-model secrets — so the facade exposes a curated `get snapshot(): AcquisitionSnapshot` (`{ phase, currentCandidate?, attempts, rejectedCount, location? }`) that the projection reads. The write-model state shape and transition logic remain private; only these already-published read facts are surfaced.
- `DomainError` moves its public export point to the facade module (it is `execute`'s error contract); its definition may stay in `decide.ts`.
- `projections/read-models.ts` switches from `foldEvents(...)` + `state.phase` to `Acquisition.fromHistory(events).phase`.
- Files keep their current layout (`state.ts`, `decide.ts`, `react.ts` remain separate modules inside `src/domain/acquisition/`) — privacy is a boundary rule, not a file merge. This preserves git history and keeps modules small.

*Alternative considered:* merging all internals into `acquisition.ts` for language-level privacy — rejected: large diff, worse file ergonomics, and the project already enforces boundaries with lint (D9), so a lint zone is the established mechanism.

### D4 — Enforcement via the existing lint boundary mechanism

Extend the `import/no-restricted-paths` zones in `eslint.config.*`: modules outside `src/domain/acquisition/` may import only `acquisition.js`, `commands.js`, `events.js`, and `react.js`-exported `Effect`/`events`-adjacent types — concretely, imports of `src/domain/acquisition/state.js` and `src/domain/acquisition/decide.js` from outside `src/domain/acquisition/` are lint errors, as is importing `react.js` for anything but the `Effect` type (simplest rule: disallow `state.js`/`decide.js` entirely outside the folder; move the `Effect` type's public export to the facade module so `react.js` can be fully restricted too). A violation fails lint and therefore CI, per the dependency-rule precedent.

### D5 — Tests keep the decider shape, phrased through the facade

`decide.test`-style cases become `Acquisition.fromHistory(given).execute(when)` and assert on returned events; `react` cases become `.reactTo(event)`; `evolve` is covered through `fromHistory` (and `phase`/`isTerminal` observations). Tests live outside the module boundary in spirit but colocated files (`*.test.ts` inside `src/domain/acquisition/`) may still exercise internals where a branch is unreachable through the facade — expectation: none are; 100% coverage must be reachable through the public surface, and any exception is a design smell to fix, not to test around.

### D6 — Constitution amendment (additive)

`docs/development/event-sourcing.md` gains one clause: the decider (decide/evolve/react) is the aggregate's private engine; the aggregate class is its public face, and only the aggregate, commands, events, and effects are visible outside the domain. This resolves the FP-vs-OOP ambiguity between `event-sourcing.md` and `design-principles.md` for future changes.

## Risks / Trade-offs

- [Behavior drift during mechanical rewrites of call sites] → Zero-logic-change discipline: the facade delegates verbatim to the existing functions; the full unit + integration + e2e suite and 100% coverage gate must stay green on every commit.
- [Coverage gaps if some `evolve`/`decide` branch is unreachable through the facade] → Treat as a signal of dead code, not a testing problem; investigate before adding any internal-reaching test. (All current branches are reachable: every event type occurs in histories, every command in decide's union.)
- [`fromHistory` refolds per call in the reactor/projections (no caching)] → Identical to today's `foldEvents` usage; no performance change. Snapshotting/caching remains a future concern behind the facade, now addable without API change.
- [Lint rule too coarse/too fine] → Start with the simplest rule (folder-external imports of `state.js`/`decide.js`/`react.js` forbidden; public types re-exported from `acquisition.ts`/`events.js`); refine only if it fights legitimate use.
- [Facade invites future "just add a getter" state leakage] → The constitution clause (D6) names state as a secret; review against it.

## Migration Plan

Single-branch, behavior-preserving refactor; no data or deployment migration. Rollback is `jj`-level (revert the change). Order of operations is in `tasks.md`: facade first (test-first, alongside existing exports), then call-site migration one consumer at a time, then export restriction + lint zone last so the build never passes through a broken intermediate state.

## Open Questions

None — both design forks raised during exploration were resolved (generic `execute` only; immutable facade without uncommitted-events tracking).
