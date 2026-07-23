## 1. Durable ParkedEffectStore (CORE 1)

- [x] 1.1 Add `ParkedEffect` + `ParkedEffectStore` port (`application/ports/parked-effect-port.ts`), keyed by `globalSeq`, carrying `{ globalSeq, streamId, attempt, parkedAt, lastError }` (no `nextRetryAt`/`due`), documenting the hold-model divergence.
- [x] 1.2 Add the `parked_effects` table to `adapters/sqlite/schema.ts` (created on open).
- [x] 1.3 TDD `SqliteParkedEffectStore` (`adapters/sqlite/parked-effects.ts`): park/upsert, find, clear-idempotent, storage faults as infra errors.
- [x] 1.4 Add a `FakeParkedEffectStore` to the application `__fixtures__/fakes.ts` (with `peek`/fault flags).

## 2. Stalled read model + dead-letter widening (CORE 2)

- [x] 2.1 Widen `DeadLetter`/`DeadLetterStore` (port) with optional `streamId`, `clearStream`, and `prune` (additive).
- [x] 2.2 Update `SqliteDeadLetterStore` + schema `dead_letters.stream_id` column with an in-place `table_info`-guarded migration; TDD the new methods and streamId round-trip.
- [x] 2.3 Update `FakeDeadLetterStore` to implement `clearStream`/`prune`/`streamId`.
- [x] 2.4 TDD `StalledReadModel` (mark/clear/isStalled) and `seedStalledReadModel` (prune + seed, fault-tolerant) in `application/projections/read-models.ts`.

## 3. Reactor budget durability + stalled marking

- [x] 3.1 TDD: replace the in-memory attempts `Map` with `ParkedEffectStore` reads/writes; below budget → park + hold, exhaustion → dead-letter (with `streamId`) + clear + mark stalled + advance.
- [x] 3.2 TDD restart-survival: a reactor parks, a fresh reactor instance over the same store resumes the tally and dead-letters at the correct total (does NOT re-retry from zero).
- [x] 3.3 TDD: a previously-stalled stream that drives successfully clears its stalled mark and dead letters (`wasStalled` path).
- [x] 3.4 Update the reactor test harness (`ReactorDeps` now include `parked` + `stalled`); keep all existing reactor tests green.

## 4. Facade exposure

- [x] 4.1 Add `stalled: StalledReadModel` to `UseCaseDeps`; join `stalled: true` onto the status view via a `withStalled` helper in `getImport`/`listImports`.
- [x] 4.2 Add optional `stalled` to `ImportStatusView`, the `importStatusResponseSchema` DTO, and the `statusViewToDto` mapping (additive).
- [x] 4.3 Update facade/use-case test wiring (`testWiring`, `use-cases.test` deps) to supply a `StalledReadModel`; TDD that a marked stream reads `stalled: true` through the facade.

## 5. Composition wiring

- [x] 5.1 In `composition/runtime.ts`: instantiate `SqliteParkedEffectStore` and a `StalledReadModel`; `seedStalledReadModel` at boot (with a retention horizon config/default); pass `parked` + `stalled` to the reactor and `stalled` to `UseCaseDeps`.
- [x] 5.2 TDD in `runtime.test.ts`: a dead letter recorded before boot seeds the import as stalled through the facade; verify the store/read-model are actually instantiated and used (not wired empty).

## 6. Gate

- [x] 6.1 Run the full `pnpm check` (format, lint, typecheck, build, test + 100% coverage, both contract tiers) and make it green.
