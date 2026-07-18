## Why

The download adapter reports completed files at a staging path it **recomputes from candidate identity** (`stagingRoot / sanitize(username \0 path \0 size)`), never at the location the source actually wrote them. Against a real slskd this path never exists — slskd saves to `downloads/<remote-folder-leaf>/<file>`, where the folder name and any collision suffix depend on slskd's host OS, its configured destination template, and its filename sanitizer (verified live against slskd 0.22.5). So every real download completes in slskd but import finds nothing and the acquisition silently fails. Reproducing slskd's path scheme app-side would couple us to all three of those slskd internals; instead, slskd's Events API reports the **authoritative** local path of each completed download, so we can read it rather than guess it. The out-of-process E2E is green only because it *defines the bug away*: the harness seeds the fixture at exactly the recomputed path, so the tier can never exercise a real source's layout.

## What Changes

- The download adapter reports each completed file at the **actual on-disk location slskd reports for it**, read from slskd's `DownloadFileComplete` event (`localFilename`) and correlated to our transfer by `transfer.id`. Import then operates on real, existing paths — no path-scheme derivation, no dependence on slskd's OS / template / sanitizer.
- The reported path is captured as event data at download-completion time, so staging-cleanup (`discardStaging`) targets that same captured location rather than recomputing it.
- The E2E slskd stub gains an events endpoint returning a `DownloadFileComplete` whose `localFilename` points at where the fixture is seeded, so the tier exercises the real event-based resolution instead of trivially matching a self-recomputed path. This closes the blind spot that let the mismatch ship.

Not in scope (tracked separately, in the homelab deploy repo, not this codebase):
- slskd writes downloads as `root:root`; the app runs as uid 1000 and cannot move/unlink them. Reconciled operationally by running slskd as `PUID/PGID=1000`. No code change here.
- The `STAGING_ROOT` env value must point at slskd's shared downloads directory. Deployment config, not a code contract.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `download-management`: the completed-download outcome must report file paths obtained from the source's own authoritative record of where it wrote the files, so downstream consumers operate on existing paths rather than a recomputed assumption.
- `out-of-process-e2e`: the real-bytes import scenario must drive the adapter's source-reported location resolution — the stub reports a local path and the fixture is seeded there — so the tier verifies real resolution rather than a path the adapter recomputes for itself.

## Impact

- `src/adapters/slskd/schemas.ts` — add a contract schema for the events endpoint / `DownloadFileComplete` payload (the `data` field is a JSON-encoded string), plus the downloads-root from the options endpoint.
- `src/adapters/slskd/download.ts` — on success, resolve each completed file's real path from slskd's events (matched by `transfer.id`) and map slskd's downloads-root prefix onto `STAGING_ROOT`; `stagedFiles()` reports those paths.
- `src/adapters/slskd/client.ts` — a method to GET events (and options, for the downloads root), reusing the existing client + api-key handling.
- Staging-cleanup: the resolved staged directory is carried as event data from completion so `discardStaging` targets it (precise wiring — carry-as-data vs. re-resolve — decided in design).
- `test/e2e/stubs/slskd/mappings` + `test/e2e/acquisition.e2e.test.ts` — stub the events (and options) endpoints; seed the fixture at the stub-reported location.
- No public-API contract changes; no new dependencies. A small domain/event change is likely (carrying the resolved staged location) — see design.
