## 1. Downloader — decided lifecycle flags (D1, D2)

- [x] 1.1 TDD `projectStatus` (`application/projections/read-models.ts`): `AcquisitionStatusView` gains `cancellable` (`!isTerminal`, from the snapshot) and `awaitingSelection` (`phase === 'AwaitingManualSelection'`); assert every terminal phase reads `cancellable: false`, every non-terminal `true`, and only the awaiting phase reads `awaitingSelection: true`.
- [x] 1.2 TDD `acquisitionStatusResponseSchema` (`facade/schemas.ts`): add `cancellable: z.boolean().optional()` and `awaitingSelection: z.boolean().optional()`; assert each parses present (`true`/`false`) and absent (additive, mirroring the `stalled` schema test).
- [x] 1.3 TDD `statusViewToDto` (`facade/mapping.ts`): map both flags through to the wire; assert a cancellable/awaiting view serializes them and a terminal non-awaiting view serializes `false`.
- [x] 1.4 Confirm (test) the flags flow through `getAcquisition`/`listAcquisitions` and the facade unchanged (they ride on the projected view; no `withStalled`-style join needed).

## 2. Importer — `availableActions` on the pending review (D3)

- [x] 2.1 TDD a pure domain helper in `domain/import/import.ts` that computes the permitted resolution verbs for a folded `ImportState` review: remediation → `{accept, retry-enrichment}`; the review kinds → the curated set, including `apply-candidate` only when candidates exist and `reject-and-retry-download` only when a delivered candidate is retained (`state.source?.candidate !== undefined`). Assert it never lists a verb `decide` would reject (cross-check against `decide`).
- [x] 2.2 Extend `OpenReview` with `readonly availableActions: readonly ResolutionKind[]`, populated in `openReviewOf`; keep `ImportSnapshot`/existing `openReview` consumers green.
- [x] 2.3 TDD `pendingReviewSchema` (`facade/schemas.ts`): add `availableActions: z.array(resolutionVerbSchema).optional()`; assert present and absent both parse.
- [x] 2.4 TDD `pendingReviewToDto` (`facade/mapping.ts`): carry `review.availableActions` onto the DTO; assert each review kind projects its permitted set and that the status view's embedded review (`reviewToDto`/`statusViewToDto`) does NOT gain the field.
- [x] 2.5 TDD the facade query path (`facade/index.test.ts` / read-model): a review for an import with no retained candidate omits `reject-and-retry-download`; one with a retained candidate includes it.

## 3. Web BFF — render decided facts, stop computing (D1–D3)

- [x] 3.1 TDD `lib/acquisitions.ts`: `isCancellable` reads `dto.cancellable`; `isTerminal` reads `!dto.cancellable` (and `outcomeSummary`'s gate follows); drop the `TONE`-based `isTerminal`/`isCancellable` derivation. Keep `statusTone`/`TONE` (badge color is presentation). Assert cancel-legality tracks the flag, not the enum.
- [x] 3.2 TDD `lib/attention.ts`: the downloader arm filters `entry.awaitingSelection` instead of `statusTone(entry.status) === 'attention'`; assert an awaiting acquisition is queued and a non-awaiting one is not, independent of tone.
- [x] 3.3 TDD `components/ReviewDetail.svelte`: derive the `ResolveForms` props and the `CandidateTable` apply affordance from `pending.availableActions` (map verb → affordance) instead of the hardcoded per-kind cascade; keep the duplicate-action parameter keyed on `review.kind`. Assert each review kind renders exactly its permitted verbs and that a review lacking a retained candidate shows no reject-and-retry-download form.
- [x] 3.4 TDD the absent-field degrade: a DTO without `cancellable`/`awaitingSelection`/`availableActions` renders no cancel affordance / no queue membership / no actions, without error.
- [x] 3.5 Update `AcquisitionDetail.svelte` (and any other consumer of `isCancellable`) to the flag-backed helper; keep component/SSR tests green.

## 4. Gate

- [x] 4.1 `pnpm check` green (format, lint, typecheck, build, unit test + 100% merged coverage, both contract tiers). Fix any regression.
