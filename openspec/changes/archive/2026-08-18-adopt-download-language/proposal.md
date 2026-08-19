# Proposal: adopt-download-language

## Why

The 2026-08-18 domain-modeling sessions settled the product's ubiquitous language — recorded in `CONTEXT-MAP.md` and `packages/*/CONTEXT.md` — and the code does not speak it: the aggregate the domain calls a **download** is `Acquisition` in code, the importer's **metadata match** is `ProposedCandidate`, the **delivered copy** is `DeliveredCandidate`, and three capability names carry the dead vocabulary (`acquisition-aggregate`, `acquisition-lifecycle`, and the doubly-misnamed `library-import`, which never touches the actual library). Every change drafted from now on is written in one language and implemented in another; the queued `pin-trusting` work should be drafted in the settled language, so the rename goes first.

## What Changes

- **In-memory code renames** (behavior-preserving): downloader `Acquisition*` family → `Download*` (including domain event type names, `AcquisitionPolicies` → `DownloadPolicies`, attempt → try vocabulary); importer `ProposedCandidate` → `MetadataMatch`, `CandidateReference` → `MatchReference`, `DeliveredCandidate` → `DeliveredCopy`, `AcquisitionId` brand → `OriginatingDownloadId`.
- **Storage tokens frozen**: stored event `type` strings and payload field names do not change; the SQLite store adapters map stored tokens ↔ renamed model exhaustively, locked by frozen-fixture tests (verdict of `docs/research/event-language-drift.md`: rename the model, never the log; escalate to a new type + upcaster only when a payload changes for real reasons).
- **Published events, wire DTOs, API routes unchanged**: `acquisition.fulfilled`, `release.verdict`, `acquisitionId`, facade DTO field names, `/api/v1/acquisitions` are additive-only contracts and keep their names permanently.
- **Capability renames** executed directly (precedent: `importer-outbound-events` was renamed on adoption): `acquisition-aggregate` → `download-aggregate`, `acquisition-lifecycle` → `download-lifecycle`, `library-import` → `library-deposit`; plus the bulk prose sweep acquisition → download across specs (the targeted Tier 1/2 language fixes already landed directly).
- **`DEPOSIT_ROOT` environment variable** introduced as the preferred name for the deposit directory; `LIBRARY_ROOT` remains honored as a fallback with a startup deprecation warning (deploy can adopt the new name lazily).
- Docs sweep: CLAUDE.md, README, development docs where they narrate the old names.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `runtime-baseline`: the consolidated environment surface reads `DEPOSIT_ROOT` as the canonical deposit-directory setting, honoring `LIBRARY_ROOT` as a deprecated fallback with a logged warning; setting both with conflicting values fails startup precisely.

The capability directory renames and the acquisition→download prose sweep are deliberate non-deltas: no requirement behavior changes, so they are executed as direct spec maintenance in this change's tasks rather than invented requirements.

## Impact

- `packages/downloader` and `packages/importer`: domain, application, facade-internal, and composition identifiers; store adapters gain the token↔model mapping; all tests follow the renames; contract fixtures must remain byte-identical (that is the proof no wire or storage behavior moved).
- `packages/web`: server config (`DEPOSIT_ROOT` alias); view-model internals may adopt the language freely; no rendered copy changes, no `data-testid` changes (e2e-safe).
- `openspec/specs`: three directory renames plus the prose sweep; `openspec/changes/archive` stays historical and untouched.
- No stored data migration, no published-event change, no API change, no release-note-worthy user-facing behavior. Deploy: homelab env unchanged until `DEPOSIT_ROOT` is adopted at leisure.
- Rationale documents: `docs/research/event-language-drift.md` (storage/wire strategy), `docs/research/bounded-contexts-vs-modules.md` (context boundary), `CONTEXT-MAP.md` + per-package `CONTEXT.md` (the language itself).
