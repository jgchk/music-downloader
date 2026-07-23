## Why

The whole-codebase review found the web BFF re-deriving business and lifecycle rules from a wire status enum instead of rendering decisions the owning bounded context already made. Three sites:

- `packages/web/src/lib/acquisitions.ts` computes `isTerminal`/`isCancellable` by pattern-matching the acquisition `status` enum — re-deciding the downloader's cancel-legality rule in the UI.
- `packages/web/src/lib/attention.ts` decides "this acquisition needs a human" by filtering on `statusTone(status) === 'attention'` — re-deriving the downloader's awaiting-selection pause from the enum plus the badge-tone table.
- `packages/web/src/lib/components/ReviewDetail.svelte` hardcodes which resolve verbs are legal for each review kind — importer authorization knowledge, encoded in a Svelte component, with `PendingReviewDto` carrying no permitted-verb set.

Each is a business rule that would vanish if you deleted the UI, living on the wrong side of the anti-corruption layer. When the owning context changes a rule (a new terminal phase, a new pause kind, a changed verb legality), the BFF's copy silently drifts — exactly how awaiting-selection once hid as generic pending. Two of these are also latent correctness gaps: the review component offers `reject-and-retry-download` for every review kind, but the importer refuses it (`NoRetainedCandidate`) unless a delivered candidate is retained, so the UI presents a button the domain will reject.

The fix is the pattern the acquisition status DTO already sets with its decided `stalled` flag (`packages/downloader/src/facade/schemas.ts`): have the owning context decide these facts and surface them as **additive** DTO fields the BFF renders. The badge *color* mapping may stay in the BFF (it is genuine presentation); the lifecycle and authorization booleans must not.

## What Changes

- **The downloader surfaces decided lifecycle flags on the acquisition status DTO.** Two additive, optional fields — `cancellable` (whether a cancel command would do anything, the exact fact the domain's `CancelAcquisition` guard already decides) and `awaitingSelection` (the acquisition is paused for a human's edition choice, the `AwaitingManualSelection` phase). Both are pure projections of already-decided domain state, joined onto the view beside `stalled`.
- **The importer surfaces the permitted verb set on the pending-review DTO.** A new additive `availableActions` field on `PendingReviewDto` — the resolution verbs legal for that review, computed by the importer from the review kind, candidate presence, and whether a delivered candidate is retained. This requires the importer domain to *newly expose* a decision (the retained-candidate precondition and the per-kind curation currently live only in the Svelte component); it is not a pure projection of what the facade already sees.
- **The BFF stops computing and starts rendering.** `isCancellable`/`isTerminal` become reads of `cancellable`; the attention queue's downloader arm reads `awaitingSelection`; `ReviewDetail` maps each verb in `availableActions` to its affordance instead of hardcoding per-kind lists. The badge-tone table stays — it is presentation. The BFF ends up presentation-only for these facts.
- **Additive-only, no wire break.** Every new field is optional/defaulted; a producer that omits it and a legacy consumer that ignores it both keep working. No serialized event, cross-context seam, or existing facade field changes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `acquisition-lifecycle`: add that the acquisition status read model exposes the acquisition's own decided lifecycle flags — cancellability and awaiting-selection — so a consumer reads them rather than re-deriving them from the status enum.
- `match-review`: add that the importer computes and exposes, per pending review, the set of resolution verbs permitted for it (`availableActions`) — the authoritative per-kind legality including the retained-candidate precondition for `reject-and-retry-download` — so a consumer offers exactly the legal verbs.
- `web-ui`: add that the BFF renders these decided lifecycle and authorization facts from the facades rather than re-deriving them from wire enums, and adjust the awaiting-selection presentation to read the decided flag.

## Impact

- **All three packages, additive.** Downloader: two projected flags on the status view/DTO + facade join (mirrors the `stalled` `withStalled` pattern). Importer: a newly-exposed domain decision (`availableActions` on `OpenReview`) threaded through the read model, facade mapping, and `pendingReviewSchema`. Web: three consumers stop computing and start rendering; the badge-tone map and the duplicate-action parameter presentation stay.
- **No breaking changes.** All new DTO fields are optional/defaulted; the BFF degrades gracefully if a field is absent. Release type: minor (`feat:` — additive DTO fields and a new domain query), no `BREAKING`.
- **Deferred (documented, not built):** surfacing a stalled acquisition/import in the attention queue (it already carries a decided `stalled` flag; wiring it into the queue is a separate presentation change, as it was for the downloader). This change does not widen the attention queue's membership beyond today's awaiting-selection + pending-review arms.
