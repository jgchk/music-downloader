## Context

The download adapter's `stagedFiles()` (`src/adapters/slskd/download.ts:131`) reports each completed file at `candidateStagingDir(stagingRoot, identity)` = `join(stagingRoot, sanitizeSegment(candidateKey(identity)))`, i.e. a **single flat directory** named `sanitize(username \0 path \0 size)`. The filesystem library's `discardStaging()` (`src/adapters/filesystem/library.ts:62`) recomputes the same path. Neither observes where the source actually wrote the bytes.

Verified live against slskd 0.22.5 on the deployment host:

- **The transfer entity carries no local path.** `GET /transfers/downloads/{user}` and the per-transfer detail endpoint expose only `filename` (the *remote* Windows path) and a `directory` field that is also *remote*.
- **slskd's real completed layout is `downloads/<leaf-of-remote-parent-folder>/<file>`** (default), but the folder name is produced by `DeriveDestination` (a configurable template, leaf-only by default) and `FileSafety.SanitizePathSegment`, whose character rules are **OS-dependent** (Linux replaces only `\0` `/` `\`; Windows strips far more), and a name collision appends a numeric suffix (`name_123456.ext`). Reproducing this app-side means encoding slskd's OS, its template config, and its sanitizer — three coupling points that drift silently.
- **slskd's Events API reports the authoritative local path.** `GET /api/v0/events?offset=&limit=` returns a persisted, newest-first, paginated log (verified: 200, `X-Total-Count: 825`). Each completed download emits a `DownloadFileComplete` event whose `data` (a JSON-encoded string) carries `localFilename` — the exact absolute path slskd wrote — `remoteFilename`, and the full `transfer` **including its `id`**. Live sample: `localFilename = /app/downloads/2007 - Alive 2007/13 Human….mp3`, `transfer.id = 2f3b3fd5-…` (the same id returned by the transfers poll).

So the source will *tell us* where it wrote each file; we do not have to derive it. This eliminates the OS/template/sanitizer coupling entirely.

The E2E tier does not catch the original bug: the fixture is seeded at exactly `candidateStagingDir(...)`, "mimicking what real slskd's shared download dir does." Because the fixture is defined to sit where the adapter looks, the tier is green regardless of whether that location matches reality.

## Goals / Non-Goals

**Goals:**
- Report completed files at, and clean up from, the location slskd itself reports for the completed download.
- Remove all dependence on slskd's path-scheme internals (OS, destination template, sanitizer, collision suffix).
- Make the E2E tier drive the real event-based resolution, so a regression fails the tier.

**Non-Goals:**
- No re-derivation of slskd's on-disk layout (the rejected approach).
- No public-API contract changes; no new dependencies.
- Deployment concerns (`STAGING_ROOT` pointing at slskd's downloads dir; slskd's `root:root` ownership reconciled via `PUID/PGID=1000`) live in the homelab deploy repo, not here.

## Decisions

### D1 — Read the authoritative local path from slskd's `DownloadFileComplete` event; do not derive, do not scan

Three strategies were on the table: **derive** (reproduce slskd's `<downloads>/<leaf>/<file>` rule), **scan** the downloads dir (Files API / directory listing) and match by basename+size, and **read** slskd's completion event. We choose **read**:

- *Derive* couples to slskd's OS + template config + sanitizer + collision-rename — the exact fragility this change exists to remove. Rejected.
- *Scan* (the Files API, `GET /api/v0/files/downloads/directories?recursive`) returns real relative paths but gives no correlation — we would match our files by basename+size, which **breaks precisely when slskd renames** (sanitizer or `_123456` collision suffix): our expected basename no longer matches the on-disk name. It also fetches the whole downloads tree. Rejected as a primary; viable as a fallback.
- *Read* is authoritative and pre-correlated: `localFilename` is the final name slskd chose (whatever the OS/template/collision produced), and `transfer.id` ties it to our exact transfer.

### D2 — Correlate by `transfer.id`; map slskd's downloads-root prefix onto `STAGING_ROOT`

The transfers poll already yields each of our transfers' `id`. On a settled+succeeded outcome, the adapter queries `GET /api/v0/events` (newest-first), reads `DownloadFileComplete` events, `JSON.parse`es their `data`, and selects those whose `transfer.id` is in our set — one per file. `localFilename` is slskd's *container* absolute path (`/app/downloads/…`); the app sees the same bytes under `STAGING_ROOT`. Map by stripping slskd's downloads root and rejoining: `ourPath = join(STAGING_ROOT, relative(slskdDownloadsRoot, localFilename))`. `slskdDownloadsRoot` is read once (cached) from `GET /api/v0/options` → `directories.downloads`.

Paging: right after completion our events are at the top; bound the scan by `limit` and stop once all our transfer ids are found or the scanned events predate the download's start. If not all are found within a small bounded number of polls (the event can lag the transfer-state flip by moments), treat as an infra fault and let the existing retry semantics handle it.

Downloads-root discovery: the prefix cannot be inferred by string-subtracting the filename (slskd sanitizes/renames both folder and file — the very thing we refuse to reproduce), so the root must be obtained. We **autodiscover** it from `GET /api/v0/options` → `directories.downloads` (verified live: `/app/downloads`), read once and cached since it does not change at runtime. *Alternatives rejected*: a `SLSKD_DOWNLOADS_ROOT` config env (adds an operator-synced knob that drifts silently from slskd's actual config); and a same-path mount convention where `STAGING_ROOT` is set equal to slskd's container downloads path so `localFilename` is used verbatim (zero code, but hard-codes slskd's `/app/downloads` internal into our deployment and breaks if slskd changes it). Autodiscovery is the only option with no operator coordination beyond the already-required shared volume.

### D3 — Cleanup uses event-carried staged files, not a recomputed or re-queried location (settled)

`discardStaging` currently recomputes the path from `candidateStagingDir(identity)`; with the path now coming from slskd it is no longer identity-derivable. **Settled: carry the staged files as event-carried data; do not re-query slskd at cleanup.**

This is not a greenfield choice — the staging location is *already* an event-carried domain fact here: `DownloadedFile.path` ("absolute path in the staging area", `events.ts:34`) rides on `DownloadCompleted.files`, and the `Validate` and `Import` effects already consume it (`react.ts:59`, `react.ts:67`). `Cleanup` is the lone effect that recomputes from identity instead of using the captured path. And it cannot simply read `state.downloadedFiles`, because at each of its four sites the prefix fold has moved past it (`CandidateRejected`→`Selecting`; `ImportConflicted`→`Conflicted`; `AcquisitionCancelled`→`Cancelled`; only `Imported`'s no-op state still holds it). This is exactly why `Imported` already stamps `candidate` onto the event rather than trusting post-state (`react.ts:73-75`).

Mechanism: `decide` stamps the completed download's staged files onto the cleanup-triggering events (`CandidateRejected`, `Imported`, `ImportConflicted`, `AcquisitionCancelled`) — feasible because each meaningful cleanup is decided from a `Validating`/`Importing` state that still holds `downloadedFiles` (`decide.ts:78` `rejectAndAdvance(DownloadingState | ValidatingState)`, `decide.ts:166`). `react` passes them into a now-self-contained `Cleanup` effect; `discardStaging` removes exactly those files and prunes the emptied directory. The `candidateStagingDir` recomputation is deleted.

*Why not re-query slskd at cleanup (rejected).* It makes slskd a second source of truth for a fact the stream already witnessed (Greg Young, *Versioning in an Event Sourced System*: events must be self-contained), it is not point-in-time stable (Fowler, *Event Sourcing*; slskd prunes its event log / a later download to the same folder redefines the mapping), it reintroduces availability coupling on a compensating action that must work when slskd is down (Vernon/Richardson, saga compensation), and it would smuggle non-deterministic I/O into effect interpretation — illegal in the pure `react`/decider core (Chassaing, *Functional Event Sourcing Decider*; the "domain is pure" non-negotiable). *Honest alternative:* a strict "no infra path in a domain event" reading would keep identity in the event and resolve the location in an adapter-owned projection (identity→dir, built from the completed stream); legitimate but heavier, and inconsistent with this codebase, which already carries paths in domain events. Under no school is re-query correct.

Refinements: carry the **files** (not just the parent dir) — symmetric with `Validate`/`Import`, and it lets cleanup remove the candidate's specific files rather than `rm -rf`-ing slskd's shared leaf folder (safe if two candidates ever share a leaf folder that slskd disambiguated per-file). The added event fields are additive (additive-only rule); make them optional / upcast for any pre-existing history.

### D4 — Fix the E2E fidelity gap in the same change

The WireMock slskd stub gains an `/api/v0/events` mapping returning a `DownloadFileComplete` whose `localFilename` points at where the harness seeds the fixture (and an `/api/v0/options` mapping for the downloads root). The fixture is seeded at that stub-reported location. The tier then exercises the real event query + path mapping, so a regression that broke resolution fails the tier instead of silently passing.

## Risks / Trade-offs

- **[Event not yet written when transfer flips to succeeded]** A brief race: the transfers endpoint may report `Completed, Succeeded` a moment before the `DownloadFileComplete` event is persisted. → Bounded re-poll of the events endpoint for the missing transfer ids; on persistent absence, an infra fault that the existing acquisition retry handles.
- **[Events API disabled / retention]** The events log could in principle be disabled or pruned. → It is on by default and persisted (verified live, 825 retained); resolution happens seconds after completion. D3 captures the path immediately so later cleanup does not depend on continued retention. Fallback if ever needed: the Files API scan (D1 alternative).
- **[Container-vs-host path prefix]** `localFilename` is slskd's container path; mapping assumes `STAGING_ROOT` is the same volume as slskd's downloads root. → That shared-volume assumption is already a deployment prerequisite; the prefix is read from `/api/v0/options` rather than hard-coded.
- **[Ownership, not path]** Even with the correct path, slskd's `root:root` files block the app's move/unlink as uid 1000. → Out of scope here (deploy-repo `PUID/PGID` fix); flagged so the code change isn't mistaken for the whole fix.

## Migration Plan

Additive adapter behavior (new events/options reads + path mapping), a small domain/event addition for the captured staged directory (D3), and the E2E stub/fixture update. No data migration; no public-API contract change. Ships behind the existing test gate (unit + the corrected E2E tier). Rollback is a straight revert. The deployment-side `STAGING_ROOT` and slskd `PUID/PGID` alignment are prerequisites for the end-to-end flow but are applied in the deploy repo independently.

## Open Questions

- **Resolved** — slskd exposes the authoritative local path via `DownloadFileComplete.localFilename`, correlatable by `transfer.id`, present and persisted on the deployed 0.22.5. Derivation (and therefore slskd's OS/template/sanitizer) is no longer needed.
- **Resolved (D3)** — cleanup uses event-carried staged files stamped by `decide` onto the cleanup-triggering events; no re-query, no identity recomputation. Grounded in this codebase's existing pattern (`DownloadedFile.path` already event-carried and consumed by `Validate`/`Import`) and the ES canon (self-contained events, point-in-time facts, pure decider core).
