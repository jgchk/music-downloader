## Context

The web BFF is a bounded-context boundary: its own view models compose the downloader and importer facades, and it must never carry a business rule that would vanish if the UI were deleted (the `bounded-context-reviewer` invariant). Three consumers violate that today by re-deriving decisions from the wire status enum:

- `lib/acquisitions.ts` — `isTerminal(status)` / `isCancellable(status)` from a `TONE` table over `AcquisitionStatusResponseDto['status']`.
- `lib/attention.ts` — the downloader arm of the attention queue filters `statusTone(entry.status) === 'attention'`.
- `components/ReviewDetail.svelte` — a per-`review.kind` `{#if}` cascade choosing which `ResolveForms` verb props to pass.

The acquisition status DTO already carries a **decided** flag — `stalled` — projected by the downloader and rendered (not recomputed) by the BFF. This change extends that precedent to the three lifecycle/authorization facts above.

Constraints: additive-only (no breaking change to any facade contract — every new field optional/defaulted); the pure domain performs no I/O; the BFF ends presentation-only for these facts; 100% coverage.

## Goals / Non-Goals

**Goals:**
- Move each re-derived lifecycle/authorization decision to the context that owns it, surfaced as an additive DTO field the BFF renders verbatim.
- Fix the latent `reject-and-retry-download` gap: never offer a verb the importer will refuse.
- Leave the badge *color* mapping (`statusTone`) in the BFF — it is genuine presentation vocabulary, not a business rule.

**Non-Goals:**
- Widening the attention queue's membership (stalled acquisitions/imports stay a deferred follow-up).
- Changing any domain decision itself — only exposing decisions already made (downloader) or formalizing one currently trapped in a component (importer).
- Removing `statusTone`/the `TONE` table, or the duplicate-action (replace/keep-both) parameter presentation, both of which are presentation.

## Decisions

### D1: `cancellable` on the acquisition status DTO — a pure projection of the domain's cancel guard

The downloader domain already decides cancellability: `decide`'s `CancelAcquisition` arm emits `AcquisitionCancelled` for every non-terminal state and converges to a no-op (`ok([])`) once `isTerminal(state)` — and the aggregate already exposes `isTerminal`. So `cancellable === !acquisition.isTerminal` is not a new decision; it is the same fact the BFF is re-deriving from the enum, read from its actual source.

`AcquisitionSnapshot`/`AcquisitionStatusView` gains `cancellable: boolean` (folded from the snapshot in `projectStatus`, like `attempts`/`location`), and `acquisitionStatusResponseSchema` gains `cancellable: z.boolean().optional()` mapped in `statusViewToDto`. The BFF's `isCancellable` becomes a read of `dto.cancellable`; `isTerminal` is its exact definitional inverse (the cancel rule *is* "cancellable iff not terminal"), so the BFF may negate the decided flag — that is not the smell being removed. The smell is deciding the rule from the `status` string; the fix is that the rule now lives once, in the downloader.

**Why a flag and not "the BFF keeps a terminal table":** a downloader change to the set of terminal phases (a new absorbing phase, a phase becoming defeasible like `Fulfilled`) must not require a coordinated edit to a UI lookup table. The flag makes the downloader the single author.

### D2: `awaitingSelection` on the acquisition status DTO — the decided human-pause, distinct from badge tone

The attention queue's downloader arm means "this acquisition is paused for the user's edition choice" — exactly the `AwaitingManualSelection` phase. `AcquisitionStatusView` gains `awaitingSelection: boolean` (`phase === 'AwaitingManualSelection'`, folded in `projectStatus`); the DTO gains `awaitingSelection: z.boolean().optional()`. `attention.ts` filters on `entry.awaitingSelection` instead of `statusTone(entry.status) === 'attention'`.

**Why not a single generic `needsAttention` flag:** "needs a human" is a *union* of distinct pauses with distinct surfaces — awaiting-selection (an edition choice, the downloader) and stalled (a dead-lettered effect awaiting an operator, already its own `stalled` flag with a deferred queue arm). Collapsing them into one boolean would itself be a presentation composition — a decision about what the queue lists — and would belong to no single domain fact. Each decided pause is its own honest flag; the queue's *membership rule* (which pauses it lists) stays the web layer's composition, but it composes decided flags rather than re-deriving them from an enum. This keeps the badge-tone table (`statusTone`) as pure presentation: today it maps `AwaitingManualSelection → attention`, but if a stalled acquisition should later badge as attention too, tone and queue-membership diverge cleanly instead of being the same re-derivation.

### D3: `availableActions` on the pending-review DTO — a decision the importer must newly expose

Unlike D1/D2, this is **not** a pure projection of state the facade already sees. The permitted verb set depends on three things, and the third is not on `OpenReview` today:

1. The review `cause.kind` — a `remediation-review` resolves only through `accept`/`retry-enrichment`; the other kinds (`match-review`, `no-match`, `duplicate-review`) resolve through the review verbs (`decideResolutionForReview` vs `decideResolutionForApplied` in `domain/import/decide.ts`).
2. Whether candidates exist — `apply-candidate` needs a known candidate, so a `no-match` (no candidates) does not offer it.
3. Whether a delivered candidate is retained — `reject-and-retry-download` is refused with `NoRetainedCandidate` unless `state.source?.candidate !== undefined`. **`OpenReview` carries `cause` and `candidates` but not this fact**, so surfacing `availableActions` requires the domain to expose it.

The set is also *curated*, not merely the strict `decide`-legal set: the review UI offers a narrower, meaningful set per kind (e.g. a `duplicate-review` offers apply/reject/retry, not import-as-is), and that curation is importer business knowledge currently living only in `ReviewDetail.svelte`. The importer owns "which actions a human may take on this review" — so the curation moves into the domain.

**Placement:** compute `availableActions` in `domain/import/import.ts` `openReviewOf`, which already folds the full `ImportState` (including `state.source`). Extend `OpenReview` with `readonly availableActions: readonly ResolutionKind[]`, derived by a pure domain helper that is *at least as strict as* `decide` (it never lists a verb `decide` would reject). `PendingReviewView` already carries `review: OpenReview`, so the set flows to the read model for free. The facade's `pendingReviewToDto` reads `review.availableActions`; the status view's embedded review (`statusViewToDto` → `reviewToDto`) does **not** carry it — the status review is informational, the pending review is the actionable surface — so the field lands on `pendingReviewSchema`, not the shared `reviewSchema`.

**Wire shape:** `availableActions: z.array(resolutionVerbSchema)` — a typed set drawn from the existing `resolutionVerbSchema` enum (the same discriminator the resolve request already keys on), so no new vocabulary. It is additive; to keep strict wire-compatibility it is optional in the schema, but the facade always populates it (the same "required in the domain, optional-and-always-present on the wire" altitude `best` already uses in `reviewToDto`). The BFF treats an absent set as "no actions offered" and degrades rather than crashing.

**BFF consumption:** `ReviewDetail.svelte` maps each verb in `pending.availableActions` to its affordance — passing the matching `ResolveForms` props and enabling the per-row apply affordance in `CandidateTable` when `apply-candidate` is present — instead of the hardcoded per-kind cascade. The duplicate-action (replace/keep-both) *parameter* of an `apply-candidate` on a `duplicate-review` stays a presentation refinement keyed on `review.kind` (it is how a permitted verb is presented, analogous to badge color), while *whether* the verb is offered comes from `availableActions`.

### D4: Additive-DTO migration, no coordinated deploy

Every new field is optional/defaulted, so the three producers and the BFF can ship independently in either order: an old facade omits the field and the BFF degrades (cancel affordance hidden, acquisition absent from the awaiting-selection arm, review actions empty — safe, never wrong); a new facade populates it and an old consumer ignores it. No serialized event, no cross-module seam, no existing field changes. Contract tests assert both presence and absence of each field.

## Risks / Trade-offs

- **`availableActions` duplicates legality already in `decide`.** Mitigated by deriving both from the same authority: the helper is unit-tested to never list a verb `decide` rejects, and a `decide`-refuses-a-listed-verb case would fail. The curation (narrower-than-decide) is the importer's, tested as such.
- **Absent-field degradation could hide an action.** Accepted: the facade always populates the fields, so absence only happens against a genuinely older producer, where hiding an affordance is the correct safe degrade (never offering an illegal action). Asserted in the BFF tests.
- **`cancellable` and `awaitingSelection` are folded per-projection, not a joined read model** (unlike `stalled`, which lives in a separate `StalledReadModel`). Correct: they are pure functions of the folded snapshot the projection already computes, so no store or boot-seed is involved — strictly cheaper than `stalled`.

## Migration Plan

Purely additive. New optional DTO fields are absent on old serialized responses (there are none persisted — these are live projections) and ignored by old consumers. `OpenReview` gaining `availableActions` is an in-memory domain type, not a wire or stored shape. No data backfill, no rollback complication.

## Open Questions

None blocking. Whether the attention queue should later also list stalled items (reading the existing `stalled` flag) is a known, deliberately-scoped follow-up, not a question for this change.
