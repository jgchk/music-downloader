## Why

On a small screen, the acquisitions master-detail shell stacks its two panes — queue first — so reaching the "Request a download" form (or an acquisition's detail) means scrolling past the entire queue. And the queue itself renders in accidental oldest-first order (read-model Map insertion order, which is event-replay order), so the entries a user most likely cares about — the newest — are at the bottom. Both hurt the primary mobile flows: requesting a download and checking on a recent request.

## What Changes

- **Small screens show one pane, not a stack.** Below the existing collapse breakpoint (960px), the child routes `/acquisitions/new` and `/acquisitions/[id]` hide the queue (master) pane and show only the form/detail, with a "Back to queue" link at the top of the pane. This is the unanimously attested "list-detail" single-pane collapse (Material 3, Microsoft list/details, Apple HIG, SAP Fiori — see `docs/research/responsive-master-detail-ux.md`). The bare `/acquisitions` index keeps its current behavior at all widths; desktop behavior is unchanged everywhere. DOM order stays list-then-detail (no CSS reordering — the hidden pane is `display: none`, out of the accessibility tree and tab order), so `web-ui-presentation`'s meaningful-sequence requirement is honored, not amended.
- **The queue lists newest first.** The acquisitions queue orders entries newest-requested first, sorted in the web layer (the attention-queue precedent) on an explicit requested-at fact. The attention queue is untouched — it stays longest-waiting first.
- **The status view states when the acquisition was requested.** `AcquisitionStatusView` (and the facade's status DTO) gain an additive `requestedAt` field, sourced from the stream's first event, so ordering is keyed on a stated fact rather than map-insertion accident.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-ui`: the acquisitions view's requirements gain (1) newest-requested-first ordering for the master queue and (2) small-screen single-pane behavior for the child routes, with a back-to-queue affordance.
- `acquisition-lifecycle`: the acquisition status read model additionally exposes **when the acquisition was requested** (`requestedAt`), additive on the status contract like `cancellable`/`awaitingSelection`.

## Impact

- `packages/downloader`: `AcquisitionStatusView` projection + facade status DTO gain the additive `requestedAt` field (no breaking change; additive within the version, per api-compatibility).
- `packages/web`: acquisitions layout (single-pane collapse CSS + back link), a small newest-first sort in the layout's server load, SSR tests gain DOM-order/visibility assertions (closing an existing gap: today's layout test asserts pane presence but not order).
- `openspec/specs`: delta specs for `web-ui` and `acquisition-lifecycle`.
- Release semantics: user-facing behavior change → ships as `feat` with a minor version bump.
- Out of scope (known cosmetic wart, deliberately deferred): on the mobile `/acquisitions` index the detail-pane placeholder ("Select an acquisition…") still renders below the queue with the page h1; revisit only if it proves to be a real problem.
