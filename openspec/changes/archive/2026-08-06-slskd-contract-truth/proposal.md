# Proposal: slskd-contract-truth

## Why

The whole-project review sweep (2026-08-05) found the slskd contract tier's blind spots
concentrated exactly where production has been burned before: the only recorded transfer is
`Completed, Succeeded`, so the failure/queue vocabulary the classifier consumes (`state`
phrasings, `exception` text, `placeInQueue`, enqueue-rejection bodies) is calibrated entirely by
hand-written stubs; `DELETE /api/v0/searches/{id}` is consumed but invisible to the drift
manifest; the `?remove=` query parameter the teardown design hangs on is asserted nowhere; and
the queued-capture the contract test's docstring still claims was silently lost in a re-record.
The research (`docs/research/slskd-transfer-state-capture.md`, grill 2026-08-05) then proved it
worse than miscoverage: deployed slskd 0.22.5 can only ever emit
`Completed, Succeeded/Cancelled/Errored` — our `Completed, Rejected`/`Completed, TimedOut` unit
stubs model states the provider cannot produce, and real failure differentiation lives in
`exception` text we have never recorded.

## What Changes

- **A soulfind-based recording lab** (docker-compose: soulfind server + a seeded peer slskd +
  the recorder's target slskd) becomes the fixture source for transfer states — used manually
  at record time only, never in CI; the commit gate still runs containerless against frozen
  fixtures exactly as today. Every target state becomes deterministically orchestratable:
  queued with `placeInQueue` (slot-starved peer + the position endpoint — a poll alone never
  carries it), cancelled (`?remove=false`), errored + rejection body (unshared filename),
  peer-offline (`docker stop`). **Gate:** no documented slskd-on-soulfind pairing exists; the
  first task is a smoke test, and if it fails the recorded fallback is live-network capture for
  queued/cancelled (timing-race + DELETE) with documented gaps for the rest.
- **Full-scenario re-recordability.** The lab orchestrates the search→enqueue→events→poll
  scenario end to end, retiring the recorder's "events.json ↔ transfers-poll.json coupling is
  not independently re-recordable" caveat and making per-slskd-version re-recording cheap
  (0.26 changes the state vocabulary — retries, terminal `TimedOut`, `Queued, Locally`).
- **The manifest tells the whole truth.** `DELETE /api/v0/searches/{id}` joins the consumed-
  operations manifest with a replay test asserting the flow issues it; the manifest model gains
  a query-parameter concept so the two-phase `?remove=false → ?remove=true` teardown shape is
  declared and asserted; the transfers-404-as-state contract is pinned by a recorded fixture
  (the plex.tv pattern).
- **The code is made true to the contract.** Unit stubs modeling unreachable states are
  corrected; the classifier is recalibrated to differentiate failures by recorded `exception`
  spellings; whatever the fixtures prove wrong ships as `fix:` in this same change
  (evidence-driven, the boundary decided at grill Q1). State-vocabulary assumptions are pinned
  to the image's slskd version with provenance, so the next version bump forces a re-record.
- **The lying docstring dies** with the queued fixture's genuine return.
- **Non-goals:** no CI containers; no slskd version bump (0.26 adoption is its own future
  change, now cheap); no production behavior change beyond what recorded evidence demands.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `external-api-contracts`: fixture recording gains the lab harness and full-scenario
  re-recordability; the slskd manifest becomes complete (deletion endpoints, query parameters);
  the consumed transfer-state vocabulary becomes witnessed and version-pinned.

## Impact

- **Code:** `packages/downloader/test/contract` (recorder, lab compose + orchestration script,
  fixtures, manifest + spec-compat model, replay tests), unit-tier stub corrections, and —
  contingent on evidence — `packages/downloader/src/adapters/slskd/transfers.ts` classifier
  recalibration as `fix:`.
- **Version:** test-only if the classifier survives the recorded evidence; `fix:` patch bump
  if it does not (the research strongly suggests it will not).
- **Dependencies:** none on other drafted changes. The e2e WireMock stubs inherit corrected
  shapes through the existing stub-conformance gate.
- **Risk retired:** the review's remaining Critical (unwitnessed failure vocabulary) and both
  slskd contract Importants; the misclassified-permanent incident family gets its regression
  floor.
