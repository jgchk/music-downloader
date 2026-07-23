## Context

`AcquisitionBadge.svelte` renders a status pill plus, for `failed` phases, a "Show/Hide reasons" disclosure that lists a `reasons: readonly string[]` prop (empty by default). Neither call site passes `reasons`:

- `AcquisitionList.svelte:30` → `<AcquisitionBadge phase={statusTone(acquisition.status)} />`
- `AcquisitionDetail.svelte:36` → `<AcquisitionBadge phase={statusTone(acquisition.status)} />`

So the disclosure always expands to its `{:else}` fallback, "No reasons given". The component was built as a spike (its test comment says so), unit- and SSR-tested in isolation with `reasons` passed directly, but never wired into the app.

The failure reasons are not missing data — they live on `acquisition.history` and are *already surfaced twice*:

- **Inline outcome summary** — `outcomeSummary(acquisition)` (`packages/web/src/lib/acquisitions.ts`) flatMaps history into a deduped reason list and renders `Exhausted (timeout, bad bitrate)` in the list's Outcome column and the detail page's outcome line.
- **Per-candidate history log** — `AcquisitionDetail.svelte:109–134` renders each history entry with its candidate path (the richest, non-deduped view).

A UX-literature review (spun out as research for this change) was decisive: a disclosure that reveals the *same deduped, same-source* content as adjacent visible text is redundant, and same-source duplicated content in one region is a recognized anti-pattern, not a neutral convenience. Sources: NN/g *Progressive Disclosure* (defer only genuinely secondary detail), NN/g *Reduce Redundancy* / *The Same Link Twice* ("only show what's needed"), GDS validation pattern (the sanctioned "two places" work because summary and detail *differ*), Shneiderman's visual-information-seeking mantra ("overview first, details on demand"), NN/g *Empty States* (don't offer an affordance that dead-ends), and the W3C ARIA disclosure pattern (an unwired control announcing expandability is itself a defect).

## Goals / Non-Goals

**Goals:**

- Remove the redundant, always-empty "Show reasons" disclosure so the badge is a status indicator only.
- Preserve the two legitimate, differently-pitched failure surfaces: the inline outcome summary (overview) and the per-candidate history log (details on demand).
- Keep the 100% merged-coverage gate green by deleting the disclosure's production branches and their tests together.
- Encode a durable rule in the `web-ui` spec so reasons aren't re-duplicated behind a control in future work, and no empty reason-affordance is ever presented.

**Non-Goals:**

- Wiring the `reasons` prop (explicitly rejected — see Decisions).
- Any change to facade DTOs, `outcomeSummary`/`statusTone`, the downloader/importer domains, or event schemas.
- Redesigning the outcome column, the history log, or the badge's phase labels/tones.
- Revisiting whether `Cancelled` maps to the `failed` tone (noted as an adjacent question, out of scope here — the "no empty affordance" rule already covers cancelled's reason-less case).

## Decisions

**Decision: Remove the disclosure rather than wire the `reasons` prop.**
The prop looks like a bug (unwired), so the reflex is to feed it from history. Rejected because it would create exactly the redundancy the literature warns against: on the list it duplicates the Outcome cell on the same row; on the detail page it duplicates the outcome line *and* is out-classed by the history log directly below. The badge occupies a middle altitude neither view needs. Removing is the fix that also deletes code and clears the unwired-control accessibility defect.
- *Alternative — wire the prop:* rejected as redundant per above.
- *Alternative — repurpose the disclosure* to reveal *non-deduped, per-attempt* reasons inline on the list (real "details on demand"): a defensible feature, but the detail page's history log already serves that need one navigation away, which the overview→detail mantra favors. Out of scope; not worth the interaction cost here.

**Decision: Reduce `AcquisitionBadge` to `{ phase }` only.**
Drop the `reasons` and `initiallyExpanded` props, the `expanded` state, the `toggle` handler, the `{#if phase === 'failed'}` button, the expandable `<ul>`, and the "No reasons given" fallback. The component becomes the single `<span class="badge">` line. Call sites already pass only `phase`, so they need no edit — only confirmation.

**Decision: Delete the disclosure test cases in the same change.**
`AcquisitionBadge.svelte.test.ts` and `AcquisitionBadge.ssr.test.ts` exercise expand/collapse, the reasons list, and the empty fallback. Those tests must go when the branches go, or coverage will reference removed behavior. Retain the phase-label/tone assertions that still apply.

**Decision: Capture the rule as a MODIFIED `web-ui` requirement.**
Tighten "Acquisition progress observation" to state reasons are surfaced through visible outcome text (not a redundant expandable control) and that no reason-affordance is shown when there's nothing to reveal. This makes the decision durable and testable rather than a one-off deletion.

## Risks / Trade-offs

- **Perceived feature loss** ("we removed a button") → The button never worked; it only ever showed "No reasons given". Reasons remain visible via the outcome summary and history log. Net user-facing improvement.
- **Coverage gate breakage if branches and tests are removed out of step** → Remove production branches and their corresponding test cases in the same commit; run `pnpm check` before finishing.
- **Future contributor re-adds a disclosure** → The MODIFIED `web-ui` requirement and its scenarios make the non-redundancy and no-empty-affordance rules explicit and testable.
- **Snapshot/SSR test drift** → SSR test asserts server-rendered markup; update it to the reduced badge output rather than leaving stale expectations.

## Migration Plan

Pure in-process UI refactor; no data, schema, or deploy-shape change. Ships through the normal gate → merge → image → homelab deploy path. Rollback is a straight revert of the change (no state or contract migration involved).

## Open Questions

- None blocking. Adjacent (deliberately out of scope): whether `Cancelled` should keep the `failed` badge tone or gain its own neutral tone — the "no empty reason affordance" rule already prevents the cancelled dead-end regardless of that choice.
