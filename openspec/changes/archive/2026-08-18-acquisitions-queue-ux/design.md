## Context

See proposal.md — Why. The relevant current state:

- The acquisitions shell is a master-detail grid (`packages/web/src/routes/acquisitions/+layout.svelte`, `.master-detail` in `packages/web/src/lib/styles/base.css:313-336`): queue first in the DOM, detail second, side-by-side ≥960px, stacked (queue on top) below.
- The queue's order is nowhere decided: `AcquisitionStatusReadModel.list()` walks its `Map` in insertion order (`packages/downloader/src/application/projections/read-models.ts:267-269`), which on replay is `global_seq ASC` — accidental oldest-first. No `AcquisitionStatusView` field carries the request time; `history` entries carry `at` but exist for the timeline.
- House constraints that shape the approach: DOM order must equal meaningful reading order — no CSS reordering (`openspec/specs/web-ui-presentation/spec.md:86`); server-rendered progressive enhancement (no JS required); status contract is additive-only (api-compatibility); skins restyle but never reorder.
- Prior-art grounding: `docs/research/responsive-master-detail-ux.md` (2026-08-18) — single-pane collapse is the unanimously attested small-screen master-detail behavior; DOM-flip-plus-grid-placement is affirmatively contraindicated (CSS Grid spec normative text, WCAG F1/C27); explicit back link attested by GOV.UK on top of browser back.

## Goals / Non-Goals

**Goals:**

- Child routes (`/acquisitions/new`, `/acquisitions/[id]`) usable on a small screen without scrolling past the queue.
- Queue ordering as an explicit, tested contract (newest-requested first) keyed on a stated fact.
- Close the existing test gap: layout tests assert pane presence but not DOM order or narrow-width visibility.

**Non-Goals:**

- No change to the bare `/acquisitions` index at any width (the placeholder-below-queue wart is a documented deferral — proposal.md Impact).
- No change to the attention queue's ordering, the desktop two-pane presentation, the 960px breakpoint, or any skin.
- No pagination/truncation of the queue.

## Decisions

1. **Single-pane collapse via route-conditional CSS, not DOM changes** (Option B of the research doc). The layout adds a modifier class (e.g. `detail-active`) to `.master-detail` when a child route is rendering (SvelteKit page state, known at SSR time — no client JS needed). Below 960px, `.detail-active .master` is `display: none`. Alternatives rejected: DOM flip + grid placement (non-conforming per CSS Grid spec §reordering, violates the presentation spec's line-86 mandate); keeping the stack with anchors/FAB (zero attestation in the master-detail literature).
   - `display: none` (not `visibility`/offscreen) so the hidden queue leaves the accessibility tree and tab order — the research doc's "symmetric trap" warning.
   - Route-awareness lives in the layout only; child pages stay ignorant of the collapse.
2. **"Back to queue" link rendered once in the layout's detail wrapper, shown only below the breakpoint.** One implementation site covers both child routes and any future one; at desktop widths the queue is visible so the link is redundant noise (`display: none` — an affordance, not meaningful sequence, so hiding it is spec-clean). Plain `<a href="/acquisitions">` — browser back also works since every pane state is a real URL; the explicit link is the GOV.UK-attested belt-and-braces. Alternative rejected: per-page back links (duplication, drift risk).
3. **`requestedAt` on the view, from the `AcquisitionRequested` event's own `occurredAt`.** `projectStatus` already locates that event to populate `requestedTarget`; the stamp is read there, in the same pass, and the facade DTO exposes it as an ISO-8601 string like other timestamps. Alternatives rejected: reversing Map insertion order (keeps ordering implicit — the accident with a minus sign); sorting on the first `history` entry (couples ordering to what the timeline happens to project); **taking the first stored entry's stamp** (as an earlier draft did — position is bookkeeping, so a stream that ever opened with something else, an upcast marker or a repair entry, would silently retime the acquisition and reorder the queue with no failure anywhere).
4. **Sort in the web layer, at the layout's server load.** `toSorted` descending on `requestedAt` (tie-break on `acquisitionId` for determinism). Matches the attention-queue precedent (`packages/web/src/lib/attention.ts` — ordering of a human-facing list is a presentation decision); the downloader keeps stating facts, not display order. Alternatives rejected: sorting in the read model or facade (bakes a presentation preference into the bounded context; web is the only consumer).
5. **Test placement.** Requested-at facts: read-model tests (fresh request; stability across later events; the stamp read from the request event rather than the stored head; absence when no request is recorded). DTO exposure: facade mapping plus a schema test pinning both the additive optionality and the ISO-instant constraint (a bare accept-the-happy-value test would not distinguish `z.iso.datetime()` from `z.string()`, and the queue's ordering rides on the format). Ordering: unit tests on the sort plus an SSR assertion that the list does not disturb the order it is handed. Collapse: SSR tests assert the modifier class, the back link, and that the master stays present and before the detail — each order assertion preceded by a presence assertion, since `indexOf` returns `-1` for a missing marker and would otherwise pass vacuously; the markup/stylesheet join is pinned in the boundaries tier. E2E: the existing parity spec is order-insensitive and hits detail pages directly — audited, no changes needed (E2E blast-radius check).

## Risks / Trade-offs

- [Existing narrow-width users lose the always-visible queue on child routes] → attested pattern; the queue is one tap away via the back link, and the masthead "Request a download" button remains global.
- [A stream carrying no `AcquisitionRequested` event states no `requestedAt`] → honest absence rather than a wrong instant: such a stream cannot come from the decider, so an absent value means a defect or a hand-repaired stream, and the queue sinks it rather than claiming a recency nobody stated. Pinned by a read-model test.
- [Sorting in the web layer means any future non-web consumer re-implements ordering] → acceptable; ordering is presentation, and the fact (`requestedAt`) is what the contract now guarantees.
- [SSR tests can't execute media queries] → the markup/stylesheet join is pinned in the boundaries tier (`test/boundaries/master-detail-collapse.test.ts`), so a rename on either side fails loudly. Whether `display: none` wins the cascade at 959px under each skin, and the spec's "focus never enters the hidden queue pane" scenario, stay with the deferred a11y-parity suite.
- [The `listFailed` degrade banner lives inside the master pane, so on a child route below the breakpoint a downloader list fault is not shown to the user] → accepted. The banner describes the pane deliberately hidden there; the fault is still logged once by `guardedRead`, the detail route surfaces its own faults, and the banner is one tap away via the back link (the index route never hides the master). Revisit if the queue's availability ever has to be legible while the user is on a child route.
- [`/reviews` shares the layout problem the research doc names] → out of scope here: it is not a `.master-detail` shell today (a standalone attention page plus its own full-page detail route), so it already behaves as the pattern prescribes. Nothing to inherit until it grows a two-pane shell.

## Migration Plan

Additive DTO field + CSS/layout change; no data migration, no event schema change, no upcasting. Ships as `feat` with a minor bump (`pnpm version:prep`). Rollback = revert the release; the additive field is absent-tolerant in both directions.
