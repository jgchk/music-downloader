# Tasks — extract-eventing-package

Two-commit shape (design D7): groups 1–5 are commit 1 (`checkpointedDrain`), groups 6–8 are commit 2 (correlation). Test-first throughout: every group's tests land red before its production code. Both reactors are out of scope (D3).

## 1. Package scaffold and lint guard (commit 1)

- [x] 1.1 Scaffold `packages/eventing` (package.json, tsconfig, tsconfig.build, vitest project) and wire it into the workspace, the root vitest projects list, and the `pnpm check` lanes in `scripts/check.sh`
- [x] 1.2 Add the leaf-package lint zones — eventing imports nothing from another workspace package; no module may import eventing from its `domain/` layer — and pin both in `test/boundaries/`, alongside the existing dependency-rule pins

## 2. checkpointedDrain, test-first

- [x] 2.1 Port the union of the two subscription suites into one `checkpointed-drain.test.ts` in `packages/eventing`, reconciling the 259 drifted lines; any contradictory pinned behaviour is surfaced in the PR body, not silently resolved
- [x] 2.2 Add the new-behaviour tests: halt-only exhaustion (no park arm), transient-hold vs permanent-halt classification, `tuning` defaults applied when omitted, stop-awaits-in-flight, reset serialized against the drain
- [x] 2.3 Implement `checkpointedDrain({name, checkpoints, feed, step, logger, tuning?})` → `{start, stop, poll, reset, isHalted}` against the suite, with the coalescing pass unexported and the poison policy behind a narrow internal waist (D3/D4)

## 3. Downloader consumes the drain

- [x] 3.1 Rewrite `seam:verdicts` as a `checkpointedDrain` whose step is the existing verdict consumer; delete `packages/downloader/src/application/events/catch-up-subscription.ts` and its drain tests, keeping step-level tests
- [x] 3.2 Trim `connectVerdictFeed` in the downloader's `runtime.ts` to the ~5 required fields; the constants it passed today become drain defaults, and the composition return type stops naming an application class

## 4. Importer consumes the drain

- [x] 4.1 Rewrite `seam:acquisitions` the same way with the intake consumer as its step; delete the importer's `catch-up-subscription.ts` and its drain tests
- [x] 4.2 Trim `connectAcquisitionFeed` in the importer's `runtime.ts` the same way

## 5. Spec deltas and gate (commit 1 close)

- [x] 5.1 Apply the deltas' consequences: no `park` arm survives on either subscription path, and no subscription writes a dead letter (both reactors' dead-letter and parked-effect machinery stays untouched); verify `DeadLetterStore` is still wired where the reactors need it
- [x] 5.2 Full gate green (`pnpm check`), then commit 1 (`refactor(seam): …`) — the e2e full-loop runs once for both commits, pre-push (task 8.3)

## 6. Correlation mechanics, test-first (commit 2)

- [ ] 6.1 Port the correlation suites (context, correlation-id, envelope attach/parse) into `packages/eventing` as one suite over `createCorrelation({contextName})`
- [ ] 6.2 Implement the shared correlation module: mint, adopt-vs-mint, causation chaining, branded `CorrelationId`, envelope schema — no module name in source, identity as an opaque parameter

## 7. Contexts consume correlation

- [ ] 7.1 Switch both contexts' `application/correlation/*` and their fixtures to the shared module; facades keep taking plain `StoryId` strings
- [ ] 7.2 Delete the string-equality describe block in `test/boundaries/correlation.test.ts` and the per-context correlation duplicates it pinned

## 8. Docs and close-out

- [ ] 8.1 Update `CONTEXT-MAP.md`: seam vocabulary gains **checkpointed drain**, poison policy reads halt-only, the no-shared-kernel sentence becomes no-shared-model with a pointer to `packages/eventing`
- [ ] 8.2 Annotate the archived decisions — merge-modular-monolith D1/D7 (incl. the drifted Marten citation) and end-to-end-correlation D13 — pointing at this change's design; cross-link `docs/research/poison-event-halt-vs-park.md`
- [ ] 8.3 File the D8 drift issues (4 reactor items + the `stalled-work-recovery` D1 parity assumption), full gate green, commit 2, then validate and ready the change for archive
