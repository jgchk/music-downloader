## Context

Builds on `request-by-release-group-id`, which added the release-group request kind, the modal-track-count edition picker, and the adapter branch, and which resolves a group with no official edition to `unresolved`. This change turns that dead-end into a human-in-the-loop pause, mirroring the importer's review-queue model for uncertain matches. The edition picker and candidate metadata (id, title, date, country, format, track count) already exist from the prerequisite change; what is new is a resolution outcome that carries candidates, an aggregate state that waits, and a UI to choose.

## Goals / Non-Goals

**Goals:**
- Replace the "no official edition → unresolved" dead-end with a pause that presents the group's editions for manual choice.
- Resume cleanly on a user's edition choice, reusing the existing direct-by-release-id resolution.

**Non-Goals:**
- Manual selection when an official edition exists (the picker auto-resolves) or as an override of a successful auto-pick.
- Any change to the picker heuristic or the release-group request kind (owned by the prerequisite change).

## Decisions

### D1 — A third resolution outcome carrying candidate editions

`MetadataResolution` gains `{ kind: 'needsSelection'; candidates: readonly EditionCandidate[] }` (additive union). `EditionCandidate` is a lightweight presentation value (release MBID, title, date, country, format, track count) — not a `Target`, since presenting an edition needs no track manifest. The MusicBrainz adapter maps the picker's non-official candidate editions to this shape.

### D2 — An `AwaitingManualSelection` aggregate state; resume reuses the direct path

The interpreter maps `needsSelection` to a command → `ManualSelectionRequested { candidates }` event; the aggregate folds into `AwaitingManualSelection`, retaining candidates and emitting no search/download effects. A user-initiated `SelectEdition { releaseMbid }` command, valid only in that state, resolves the chosen release id via the existing `resolveReleaseById` path → `TargetResolved` → normal flow. This is the key simplification: manual selection adds a pause/candidate-carrying state but no new "release id → target" logic. Cancellation follows the existing cancel path.

### D3 — UI and command surface

A pending-selection read model exposes awaiting-selection acquisitions and their candidates; a `SelectEdition` command endpoint (HTTP/MCP) accepts `{ acquisitionId, releaseMbid }` and returns the modeled rejection for stale/unknown selections; a SvelteKit surface lists candidates and submits the choice.

## Risks / Trade-offs

- **Scope: new aggregate state + UI + endpoint.** → Mitigated by reusing the direct-release path for resume; the new surface is a pause state and a candidate read model.
- **Unbounded wait** — an acquisition may sit awaiting selection indefinitely. → Match the importer review-queue's human-paced model (no timeout) initially; revisit if operationally needed.
- **Many bootleg candidates** — a group could present dozens of editions. → Order candidates by the prerequisite change's picker heuristic; present all.
