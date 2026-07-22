## 1. The AttentionItem view model

- [ ] 1.1 Write failing unit tests for a pure `attentionItems(reviews, acquisitions)` mapping in `packages/web/src/lib/`: maps pending importer reviews and `AwaitingManualSelection` acquisitions to `AttentionItem { module, kind, id, title, waitingSince?, href }`, orders longest-waiting first, excludes every other status; implement it.
- [ ] 1.2 Write failing tests that the mapping is total over sparse inputs (missing dates/titles degrade the item's presentation, never drop the item); implement.

## 2. The queue page

- [ ] 2.1 Write failing `page.server.test.ts` tests for the `/reviews` load: composes both facades into the item list; one facade failing yields the other's items plus a modeled section error (no page-level failure); implement the load.
- [ ] 2.2 Write failing SSR/component tests for the queue rendering: one ordered list, module/kind labels, resolution links, per-section error note, retitled "Needs attention" heading (URL unchanged); implement (extend/replace `ReviewQueue.svelte` composition).
- [ ] 2.3 Keep existing review-resolution behavior intact: existing review detail routes/tests unchanged; update any test pinned to the importer-only listing wording.

## 3. Navigation badge

- [ ] 3.1 Write failing tests for the layout load exposing the attention count and for the nav rendering: count badge when > 0, no badge at zero; implement in the root layout.

## 4. Action-needed presentation

- [ ] 4.1 Write failing tests for the third badge tone: `statusTone('AwaitingManualSelection')` → `attention` (distinct from pending/fulfilled/failed), `isCancellable` unchanged; implement in `acquisitions.ts` / `phase-label.ts` / badge component.
- [ ] 4.2 Write failing tests that an awaiting-selection acquisition never presents as "(resolving…)": list row and detail heading describe the awaited choice; implement in `targetDescription` (or a sibling) and the row/detail components.

## 5. Spec coverage & the gate

- [ ] 5.1 Ensure every scenario in the `web-ui` delta is covered by a test (queue composition, resolution removes item, per-section failure, badge count, zero-badge, action-needed row).
- [ ] 5.2 Run `pnpm check` and `openspec validate unified-attention-queue --strict`; fix gaps.
- [ ] 5.3 Manually verify end-to-end: with one pending review and one awaiting-selection acquisition, the queue lists both, the badge shows 2, resolving each empties the queue.
