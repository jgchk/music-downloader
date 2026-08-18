## 1. Downloader: the status view states its requested-at fact

- [x] 1.1 Red: read-model tests — a fresh request's status view carries `requestedAt` equal to the first event's `occurredAt`; later events leave it unchanged (spec: acquisition-lifecycle "requested" scenarios). Green: record the first event's `occurredAt` per stream in the projection and expose it on `AcquisitionStatusView`.
- [x] 1.2 Red: facade tests — the status DTO exposes `requestedAt` (ISO-8601) on list and single-status responses. Green: map the view field through the facade DTO (additive; no existing field or consumer changes).

## 2. Web: the queue reads newest first

- [ ] 2.1 Red: unit test for a newest-first ordering function (descending `requestedAt`, tie-break `acquisitionId`) in `packages/web/src/lib`. Green: implement it beside the attention-queue precedent.
- [ ] 2.2 Red: layout server-load test — acquisitions arrive at the page newest-requested first (spec: "Newest request appears at the top"). Green: apply the ordering in the acquisitions layout's server load.
- [ ] 2.3 Red: `AcquisitionList` SSR test asserting rendered row order (first-requested renders below later-requested — position, not just presence). Green with no component change expected; this pins the order the load supplies.

## 3. Web: single-pane collapse on child routes

- [ ] 3.1 Red: layout SSR tests — the shell carries a detail-active marker when a child route renders (new-request and detail), not on the index; DOM order stays list-then-detail in every case (closes the existing presence-only gap). Green: route-conditional modifier class in `+layout.svelte`.
- [ ] 3.2 Red: layout SSR test — a "Back to queue" link to `/acquisitions` renders at the top of the detail wrapper on child routes, absent on the index. Green: the link in the layout's detail wrapper.
- [ ] 3.3 Red: stylesheet-level assertion (matching how existing responsive rules are covered) — below the 960px breakpoint the detail-active shell hides the master pane with `display: none`, and the back link is hidden at wide widths. Green: the `base.css` rules; verify no skin overrides `.master-detail`.

## 4. Blast radius and verification

- [ ] 4.1 Audit `test/e2e` and `packages/web/tests/parity.spec.ts` against the new order and collapse (both believed order-insensitive/detail-routed — confirm, fix if not).
- [ ] 4.2 Manual verify via the running app at a narrow viewport: `/acquisitions/new` shows the form immediately with the back link; a detail deep-link stands alone; the queue lists newest first; desktop unchanged.
- [ ] 4.3 `pnpm check` green; `pnpm version:prep` minor bump (`feat`).
