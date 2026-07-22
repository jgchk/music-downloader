## Context

Two bounded contexts now pause for humans: the importer's match-review queue (surfaced at `/reviews`) and the downloader's `AwaitingManualSelection` acquisitions (surfaced only on each acquisition's detail page, per `manual-edition-selection`). The web package is a BFF that calls both module facades in-process (web-ui spec, "BFF calls facades in-process only"), so it already holds everything needed to compose one queue. The original intent — modules expose their own intervention surfaces, the web unifies them — predates both features but was never specified.

## Goals / Non-Goals

**Goals:**
- One inbox: everything waiting on a human, in one ordered list, discoverable from the navigation.
- Keep the bounded-context seam intact: neither module learns the other exists; no shared kernel.
- Make "interventions surface in the queue" a written requirement future pauses inherit.

**Non-Goals:**
- Inline resolution in the queue (candidate tables, resolve verbs). Items link to their existing resolution surfaces; inlining is a possible later enhancement.
- A facade-level standard `Intervention` contract (see D2's promotion trigger).
- New pause states (e.g. needsSelection for ambiguous descriptors) — separate changes; they inherit this queue.

## Decisions

### D1 — Web-owned `AttentionItem` view model, composed in the BFF

The `/reviews` load queries both facades — importer pending reviews and downloader acquisitions filtered to `AwaitingManualSelection` — and maps each into a web-owned `AttentionItem`: `{ module: 'importer' | 'downloader'; kind: 'match-review' | 'edition-selection'; id; title; waitingSince?; href }`. Ordering is oldest-first (longest-waiting leads); mapping is pure and lives beside the other presentation vocabulary (`src/lib/`), unit-tested in the node project. This is the altitude-correct shape: the unification is a parsed UI view model at the edge, not a wire type — per the read-model-shape research recorded in the `manual-edition-selection` review discussion (Wlaschin's DTO encoding on the wire; Feldman/King "parse into precision" at the consumer).

### D2 — No shared kernel; an explicit promotion trigger instead

Each facade keeps its own vocabulary; the standard format exists only where its only consumer lives. A facade-level `listPendingInterventions()` shared shape is deliberately rejected *for now*: it would be a shared kernel coupling both contexts to a UI concern, and its generic shape would merely duplicate `AttentionItem` below the layer that uses it. **Promotion trigger, recorded here on purpose:** the moment a second, out-of-process consumer needs the unified shape (MCP resurrection, notifications, mobile), promote the shape into each facade additively and reduce the web mapping to pass-through. Until then, adding a module's new pause kind costs one arm in the web mapping.

### D3 — Badge count from the same composition

The root layout exposes a pending-attention count (sum of both lists) rendered as a badge on the `/reviews` nav entry. It is computed by the same load-time composition — no polling endpoint, no client-side fetch loop; freshness is page-navigation freshness, consistent with how the rest of the UI reads projections.

### D4 — Action-needed presentation for awaiting-selection acquisitions

`statusTone` gains a third tone (`attention`) so awaiting-selection rows badge distinctly from pending/fulfilled/failed; `targetDescription` stops rendering "(resolving…)" for a request whose group identity is known — awaiting rows title from the request (release-group id or, later, a resolved group title) with an explicit "waiting for your choice" line. The acquisitions list remains the full history; the queue is the filtered inbox.

## Risks / Trade-offs

- **Queue staleness between navigations** (D3, no polling) → acceptable: identical to every other projection-backed page; revisit only with a real-time requirement.
- **`/reviews` naming now undersells its content** → keep the URL (bookmarks, muscle memory), retitle the page "Needs attention"; a redirect-worthy rename is not worth the churn.
- **Two-facade load on one page doubles failure surface** → each half degrades independently: a failing module renders its section's error note while the other lists normally (mirrors the health endpoint's per-module reporting).
- **UI-level composition means each new pause kind edits the web mapping** → intended cost; one mapping arm per kind, and the modified web-ui requirement makes forgetting it a spec violation caught in review.
