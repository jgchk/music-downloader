# react-post-event-state — Tasks

## 1. Reactor checkpoint semantics for domain rejections (design D5 — must land before the prefix fold)

- [x] 1.1 Red: reactor test — a re-dispatched effect whose follow-on command returns a `DomainError` logs at warn and ADVANCES the checkpoint past the event (no perpetual retry); subsequent events keep processing
- [x] 1.2 Red: reactor test — an `InfraError`/`ConcurrencyConflict` from effect dispatch still logs at error and leaves the checkpoint unadvanced (existing behavior pinned alongside the new branch)
- [x] 1.3 Green: split the `interpretEffect` error handling in `Reactor.process` on `DomainError` vs `AppendError | InfraError`; update the reactor doc-comment

## 2. Prefix fold — react receives post-event state (design D1/D2)

- [x] 2.1 Red: reactor test — for a co-emitted batch (`Imported` + `AcquisitionFulfilled`), reacting to `Imported` folds only the prefix through `Imported`. NOTE: confirmed at first delivery every non-final co-emitted reaction is payload-keyed or effect-free (proposal's "zero first-delivery diff"), so this is a documentation/guard test that passes under both folds; the observable divergence is exercised by the redelivery tests (2.2, 3.x).
- [x] 2.2 Red: reactor test — a redelivered event (crash window: checkpoint behind an already-advanced stream) is reacted against the same state as first delivery and produces the same effects (ValidationPassed → Import re-fires; fails under whole-fold)
- [x] 2.3 Red: determinism property — covered by 2.2/3.3: reacting to event *i* against a stream that already holds events beyond *i* yields the prefix-fold effects, not the latest-fold effects
- [x] 2.4 Green: in `Reactor.process`, slice the stream to `entry.version <= stored.version` before `Acquisition.fromHistory(...)`; facade API unchanged

## 3. Crash-window convergence matrix (design D6, lifecycle delta scenarios)

- [x] 3.1 Red: `Imported` redelivered → `Cleanup` re-fires → `discardStaging` on already-discarded staging converges (idempotent port contract exercised through the reactor)
- [x] 3.2 Red: `ValidationPassed` redelivered after `Imported`/`AcquisitionFulfilled` appended → `Import` re-fires → library outcome is ignored (`ok([])` against terminal state); recorded history unchanged (checkpoint advances)
- [x] 3.3 Red: `CandidateSelected` redelivered after `DownloadCompleted` appended → `Download` re-fires → stale `RecordDownloadCompleted` is an IllegalTransition that D5 records and advances past; checkpoint advances
- [x] 3.4 Green: no production changes needed beyond tasks 1 and 2; existing port fakes returned idempotent results (`discardStaging`/`import` okAsync)

## 4. Retire the whole-stream-fold workaround contract (design D3/D4)

- [x] 4.1 Rewrite the doc-comment in `src/domain/acquisition/react.ts`: `state` is the state as of the event; phase guards are type-narrowing + tolerant-fold totality checks (deleted rules 1 and 2)
- [x] 4.2 Update the `Imported` reaction comment: payload-keyed because `evolve` treats `Imported` as a state no-op so the identity lives on the event (event-carried data). `CandidateRejected`'s comment (D13) did not invoke the fold rationale — left unchanged.
- [x] 4.3 Confirm existing tolerant-fold/guard fall-through tests still cover every guard's no-effect branch — 100% branch coverage held (999 stmts / 648 branches / 285 funcs / 858 lines)

## 5. Documentation

- [x] 5.1 `docs/development/event-sourcing.md`: clarify `react (event, state) -> effects` — `state` is the state as of the event (fold up to and including it)

## 6. Gate and wrap-up

- [x] 6.1 `pnpm check` passes (format, lint, typecheck, build, 547 tests with 100% coverage, contract + release suites)
- [x] 6.2 Out-of-process e2e (`pnpm test:e2e`) passes unchanged (image built, 3 tests green across the process boundary)
- [x] 6.3 `openspec validate react-post-event-state` passes; no design decisions changed during implementation (2.1's zero-first-delivery-diff was already predicted in the proposal/design)
