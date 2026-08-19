## 1. Downloader: the status view states its requested-at fact

- [x] 1.1 Red: read-model tests — a status view carries `requestedAt` equal to the `AcquisitionRequested` event's own `occurredAt`, unchanged by later events, taken from that event even when it is not the first one stored, and absent when the stream records no request (spec: acquisition-lifecycle "requested" scenarios). Green: read the stamp in the pass that already locates that event in `projectStatus`, and expose it on `AcquisitionStatusView`.
- [x] 1.2 Red: facade tests — the status DTO exposes `requestedAt` (ISO-8601) on list and single-status responses. Green: map the view field through the facade DTO (additive; no existing field or consumer changes).

## 2. Web: the queue reads newest first

- [x] 2.1 Red: unit tests for a newest-first ordering function (descending `requestedAt`, tie-break `acquisitionId`, undated last, input unmutated) in `packages/web/src/lib`. Green: implement it beside the attention-queue precedent.
- [x] 2.2 Red: layout server-load test — acquisitions arrive at the page newest-requested first (spec: "Newest request appears at the top"). Green: apply the ordering in the acquisitions layout's server load.
- [x] 2.3 Red: `AcquisitionList` SSR test asserting that the component renders rows in the order it is handed, without re-sorting (position, not just presence — and presence asserted first, since `indexOf` returns -1 for a missing row). Green with no component change expected; recency is decided in the load, so what the component owes is not to disturb it.

## 3. Web: single-pane collapse on child routes

- [x] 3.1 Red: layout SSR tests — the shell carries a detail-active marker when a child route renders (new-request and detail), not on the index; DOM order stays list-then-detail in every case (closes the existing presence-only gap). Green: route-conditional modifier class in `+layout.svelte`.
- [x] 3.2 Red: layout SSR test — a "Back to queue" link to `/acquisitions` renders at the top of the detail wrapper on child routes, absent on the index. Green: the link in the layout's detail wrapper.
- [x] 3.3 The `base.css` rules: below 960px a detail-active shell hides the master with `display: none` and reveals the back link; verified no skin overrides `.master-detail`. Pinned by `test/boundaries/master-detail-collapse.test.ts`: the collapse is a bare string agreement between the layout's class names and the stylesheet's selectors, which no type checks and neither SSR nor e2e can see, so a rename on either side would leave the whole suite green while the collapse silently stopped. (An earlier draft of this task waived any assertion, reasoning that nothing in the repo reads a stylesheet. Review corrected it: `test/boundaries/` exists precisely to stop a gate going quiet, and `parity.spec.ts`'s prohibition covers new *browser-driven* a11y specs, not a cheap node-tier pin.) Still deliberately deferred to the a11y-parity suite: whether `display: none` wins the cascade at 959px under each skin, and the spec's "focus never enters the hidden queue pane" scenario.

## 4. Blast radius and verification

- [x] 4.1 Audit `test/e2e` and `packages/web/tests/parity.spec.ts` against the new order and collapse (both believed order-insensitive/detail-routed — confirm, fix if not).
- [x] 4.2 Manual verify via the running app at a narrow viewport: `/acquisitions/new` shows the form immediately with the back link; a detail deep-link stands alone; the queue lists newest first; desktop unchanged.
- [x] 4.3 `pnpm check` green (12/12 lanes); `pnpm version:prep` minor bump (`feat`) applied in the release commit that follows.
