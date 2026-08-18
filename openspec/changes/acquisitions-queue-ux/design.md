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
3. **`requestedAt` on the view, from the stream's first event's `occurredAt`.** The projection records it when it first sees a stream (insertion into the `Map` today) and carries it through `projectStatus`; the facade DTO exposes it as an ISO-8601 string like other timestamps. Alternatives rejected: reversing Map insertion order (keeps ordering implicit — the accident with a minus sign); sorting on the first `history` entry (couples ordering to what the timeline happens to project).
4. **Sort in the web layer, at the layout's server load.** `toSorted` descending on `requestedAt` (tie-break on `acquisitionId` for determinism). Matches the attention-queue precedent (`packages/web/src/lib/attention.ts` — ordering of a human-facing list is a presentation decision); the downloader keeps stating facts, not display order. Alternatives rejected: sorting in the read model or facade (bakes a presentation preference into the bounded context; web is the only consumer).
5. **Test placement.** Requested-at facts: read-model tests (fresh request; stability across later events). DTO exposure: facade + contract-shape tests as the additive-field precedent dictates. Ordering: a unit test on the sort plus an SSR assertion on rendered row order. Collapse: SSR tests assert the modifier class and DOM order (list before detail); the CSS `display: none` behavior itself is asserted at the stylesheet level the way existing responsive rules are covered. E2E: the existing parity spec is order-insensitive and hits detail pages directly — audited, no changes expected (E2E blast-radius check).

## Risks / Trade-offs

- [Existing narrow-width users lose the always-visible queue on child routes] → attested pattern; the queue is one tap away via the back link, and the masthead "Request a download" button remains global.
- [`requestedAt` sourced from first event assumes every stream's first event is the request] → true today by construction (an acquisition stream begins with its request); the read-model test pins it so a future reordering of stream birth would fail loudly.
- [Sorting in the web layer means any future non-web consumer re-implements ordering] → acceptable; ordering is presentation, and the fact (`requestedAt`) is what the contract now guarantees.
- [SSR tests can't execute media queries] → covered by asserting the modifier class + the stylesheet rule, the same altitude existing responsive behavior is tested at; the deferred parity invariants (tab order, CSS-off) remain deferred.

## Migration Plan

Additive DTO field + CSS/layout change; no data migration, no event schema change, no upcasting. Ships as `feat` with a minor bump (`pnpm version:prep`). Rollback = revert the release; the additive field is absent-tolerant in both directions.
