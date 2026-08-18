## 1. Downloader: the status view states its requested-at fact

- [x] 1.1 Red: read-model tests — a fresh request's status view carries `requestedAt` equal to the first event's `occurredAt`; later events leave it unchanged (spec: acquisition-lifecycle "requested" scenarios). Green: record the first event's `occurredAt` per stream in the projection and expose it on `AcquisitionStatusView`.
- [x] 1.2 Red: facade tests — the status DTO exposes `requestedAt` (ISO-8601) on list and single-status responses. Green: map the view field through the facade DTO (additive; no existing field or consumer changes).

## 2. Web: the queue reads newest first

- [x] 2.1 Red: unit test for a newest-first ordering function (descending `requestedAt`, tie-break `acquisitionId`) in `packages/web/src/lib`. Green: implement it beside the attention-queue precedent.
- [x] 2.2 Red: layout server-load test — acquisitions arrive at the page newest-requested first (spec: "Newest request appears at the top"). Green: apply the ordering in the acquisitions layout's server load.
- [x] 2.3 Red: `AcquisitionList` SSR test asserting rendered row order (first-requested renders below later-requested — position, not just presence). Green with no component change expected; this pins the order the load supplies.

## 3. Web: single-pane collapse on child routes

- [x] 3.1 Red: layout SSR tests — the shell carries a detail-active marker when a child route renders (new-request and detail), not on the index; DOM order stays list-then-detail in every case (closes the existing presence-only gap). Green: route-conditional modifier class in `+layout.svelte`.
- [x] 3.2 Red: layout SSR test — a "Back to queue" link to `/acquisitions` renders at the top of the detail wrapper on child routes, absent on the index. Green: the link in the layout's detail wrapper.
- [x] 3.3 The `base.css` rules: below 960px a detail-active shell hides the master with `display: none` and reveals the back link; verified no skin overrides `.master-detail`. Pinned by `test/boundaries/master-detail-collapse.test.ts`: the collapse is a bare string agreement between the layout's class names and the stylesheet's selectors, which no type checks and neither SSR nor e2e can see, so a rename on either side would leave the whole suite green while the collapse silently stopped. (An earlier draft of this task waived any assertion, reasoning that nothing in the repo reads a stylesheet. Review corrected it: `test/boundaries/` exists precisely to stop a gate going quiet, and `parity.spec.ts`'s prohibition covers new *browser-driven* a11y specs, not a cheap node-tier pin.) Still deliberately deferred to the a11y-parity suite: whether `display: none` wins the cascade at 959px under each skin, and the spec's "focus never enters the hidden queue pane" scenario.

## 4. Blast radius and verification

- [x] 4.1 Audit `test/e2e` and `packages/web/tests/parity.spec.ts` against the new order and collapse (both believed order-insensitive/detail-routed — confirm, fix if not).
- [x] 4.2 Manual verify via the running app at a narrow viewport: `/acquisitions/new` shows the form immediately with the back link; a detail deep-link stands alone; the queue lists newest first; desktop unchanged.
- [ ] 4.3 `pnpm check` green; `pnpm version:prep` minor bump (`feat`).
