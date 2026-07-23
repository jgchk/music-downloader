## 1. Persistence tolerance — the additive upcaster (do first; it de-risks the rename)

- [ ] 1.1 TDD the `ReviewResolved` v1→v2 upcaster in `packages/importer/src/adapters/sqlite/upcaster.ts`: a stored v1 payload whose `resolution.kind === 'reject-and-retry-download'` upcasts to `resolution.kind === 'reject-unusable-delivery'`, preserving `reasons`; a v1 payload with any other resolution kind passes through byte-for-byte; a non-`ReviewResolved` type is untouched.
- [ ] 1.2 Bump `CURRENT_SCHEMA_VERSION` 1 → 2 and register the upcaster in a testable factory (e.g. `buildUpcasterRegistry()`); TDD that the registry returned lifts a v1 `ReviewResolved` and leaves a v2 one alone.
- [ ] 1.3 Wire the populated registry where `composition/runtime.ts` (~:164) constructs `new UpcasterRegistry()`; TDD (composition/runtime test) that the wired store upcasts a raw-inserted v1 `reject-and-retry-download` row on read.
- [ ] 1.4 TDD through `SqliteEventStore`: raw-insert a v1 `ReviewResolved` rejection stream, `readStream`, and assert the folded state settles and the history projection reads `reject-unusable-delivery` identically to a natively-written v2 stream (the legacy-tolerance guarantee).

## 2. Domain — rename to the importer's own language + strip borrowed vocabulary

- [ ] 2.1 TDD-rename the `Resolution` kind `reject-and-retry-download` → `reject-unusable-delivery` in `domain/import/events.ts`; update `PendingRejection` (`state.ts`) and every exhaustive switch. Reframe the `DeliveredCandidate` (~:26) and `ReleaseVerdictRecorded` (~:250) doc comments in the importer's own terms (opaque provenance; consumer owns retry/revival) per design D4.
- [ ] 2.2 Update `decide.ts`: the resolution branch (~:94), the `NoRetainedCandidate` doc (~:21), and the stale-guard comment (~:95) — reframed to "echo back the exact copy the importer judged (opaque provenance); refused precisely without a retained candidate, plain reject stays available." Keep the `NoRetainedCandidate` refusal and the `ReleaseVerdictRecorded` co-emission behavior unchanged; TDD stays green under the new name.
- [ ] 2.3 Update `state.ts` `evolveResolved` and `import/react.ts` (~:72) reject-verb arms to the new kind; reframe the react comment off "the outbound publisher consumes." TDD the fold and effect (`DeleteIntake`) under the new name.
- [ ] 2.4 Rename every domain/application test occurrence (`import.test.ts`, `state.test.ts`, `decide` tests, `read-models.test.ts`, `outbound-feed.test.ts`, `interfaces/contracts/events/mapping.test.ts`) to the new verb; assert none reference `reject-and-retry-download` except the upcaster's legacy-input fixture.

## 3. In-process facade DTO — coordinated rename (no dual-verb; never serialized)

- [ ] 3.1 TDD-rename the request verb in `facade/schemas.ts` `resolveReviewRequestSchema` (`reject-and-retry-download` → `reject-unusable-delivery`) and reword its docstring to the importer's intent ("right thing, bad copy": reject the delivered copy as unusable and record a release verdict).
- [ ] 3.2 Rename the same value in `resolutionVerbSchema` (the history projection DTO); TDD that a `review-resolved` history entry projects the new verb.
- [ ] 3.3 Update `facade/mapping.ts` `resolutionToDomain` case and its tests to the new verb; assert the DTO→domain mapping round-trips.

## 4. Web BFF — synchronized single-deployable update

- [ ] 4.1 Update `packages/web/src/lib/server/forms.ts` reject-verb case and its tests (newline-separated reasons) to `reject-unusable-delivery`.
- [ ] 4.2 Update the `ResolveForms` component hidden `value="…"` and its SSR test; update `reviews/[id]/page.server.ts` and its test. TDD that the form submits the new verb end-to-end through the facade.

## 5. Specs

- [ ] 5.1 Apply the `match-review` delta: verb renamed to `reject-unusable-delivery`, semantics reframed, plus the legacy-tolerance scenario.
- [ ] 5.2 Apply the `importer-outbound-events` delta: trigger re-worded to the new verb; codify that the published `release.verdict` payload/schema is unchanged.

## 6. Gate

- [ ] 6.1 `grep -rn 'reject-and-retry-download' packages/` returns only the upcaster's legacy-input fixture/test (the sole intentional survivor).
- [ ] 6.2 `pnpm check` green (format, lint, typecheck, build, unit test + 100% merged coverage, both contract tiers). Confirm the downloader package and the `release.verdict` contract tier are untouched (no cross-context change).
