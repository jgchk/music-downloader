## Why

The product now has two kinds of work that wait indefinitely for a human — importer match reviews and downloader acquisitions awaiting manual edition selection (added by `manual-edition-selection`) — but only the first has a dedicated "needs you" surface. Awaiting-selection acquisitions sit in the general acquisitions list looking like in-progress work ("(resolving…)", a generic pending badge), so the pause the feature exists for can go unnoticed forever. The original product intent — one queue that unifies anything needing manual intervention, composed by the web UI from per-module surfaces — was never written into the specs, which is exactly why the newest pause defaulted to its own corner.

## What Changes

- The `/reviews` page becomes the **attention queue**: a single ordered inbox listing importer reviews *and* downloader awaiting-selection acquisitions, each item linking to its resolution surface (review detail or acquisition detail).
- The web BFF composes the two in-process facades into a web-owned `AttentionItem` view model (module, kind, title, waiting-since, resolution link). **No shared kernel, no new cross-module contract** — each facade keeps its own vocabulary; the standard format lives at the UI edge where today's only consumer is. The design records the promotion trigger for a facade-level standard shape (a third, out-of-process consumer).
- The site navigation shows a pending-attention count (badge) sourced from the same composition, so waiting work is discoverable from anywhere.
- The acquisitions list presents awaiting-selection rows as **action-needed** (distinct label/tone and no "(resolving…)" heading) rather than in-progress.
- The `web-ui` requirement wording changes from importer-only review listing to the module-agnostic attention queue, so any future pause-adding change lands in the queue **by requirement**, not by luck.

## Capabilities

### New Capabilities

_(none — this is a presentation/composition change; both underlying pause capabilities already exist)_

### Modified Capabilities

- `web-ui`: the review-listing requirement generalizes into the cross-module attention queue (list composition, per-item resolution links, badge count, action-needed presentation for awaiting-selection acquisitions).

## Impact

- **packages/web only.** Both facades already expose everything needed: `listReviews()` (importer) and `listAcquisitions()` filtered to `AwaitingManualSelection` with `candidates` (downloader, since v3.3.0). No downloader/importer package changes, no event or DTO changes, no migration.
- Additive to the public contract; the only removed surface is the importer-only framing of `/reviews`, whose URL and existing content remain.
- Follow-ups that become cheaper: `needsSelection`-for-ambiguous-descriptors and any future pause state inherit the queue automatically.
