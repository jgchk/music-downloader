# Tasks — slskd-contract-truth

Red-first throughout. Task 1.1 is the gate: its outcome selects the lab or fallback path for
group 2 (everything else proceeds regardless).

## 1. The lab and its gate

- [x] 1.1 Smoke test: compose soulfind + peer slskd + target slskd; prove login, search, and a
      completed transfer end to end. Record the outcome (and soulfind/slskd versions) in the
      design doc. On failure: switch group 2 to the documented live-capture fallback.
      **PASSED — lab path taken, no fallback (design.md "Task 1.1 — smoke-gate outcome").**
- [x] 1.2 Lab compose + seeded peer share + named recorder scenarios (`queued`, `cancelled`,
      `errored`, `rejection`, `offline`, `full-flow`), provenance stamped with lab + versions;
      secret-scrub projection discipline carried over.

## 2. Fixtures

- [x] 2.1 Queued: slot-starved peer scenario; poll + position-endpoint fixtures (red first:
      replay test asserting the adapter's queue-position read and the request it sends).
- [x] 2.2 Cancelled: DELETE `?remove=false` scenario + post-cancel poll fixture and replay test.
- [x] 2.3 Errored + rejection: unshared-filename scenario capturing the 500 rejection body and
      the errored row's `exception`; peer-offline via container stop; replay tests calibrating
      each to its source-agnostic reason.
- [x] 2.4 No-transfers 404-as-state fixture + replay to the confirmed-gone outcome (the plex.tv
      pattern).
- [x] 2.5 Full-flow scenario re-record: search→enqueue→events→poll regenerated coherently in
      one run; the coupling caveat comment replaced by the scenario reference; one live-network
      success flow kept as cross-check fixture.

## 3. Manifest completeness

- [x] 3.1 Query-parameter concept in `SlskdOperation`/`checkSlskdSpec` (red first); teardown's
      two-phase `?remove=` declared and asserted; `DELETE /api/v0/searches/{id}` (and the
      position endpoint if consumed) added with replay assertions.
- [x] 3.2 Undeclared-operation enforcement (red first): the tier fails on any asserted request
      whose operation the manifest lacks.

## 4. Code made true to the contract

- [x] 4.1 Reachable-vocabulary pin (version → states record) + the stub-vocabulary test; rewrite
      the `Completed, Rejected`/`Completed, TimedOut` stubs into reachable realities with
      intent preserved.
- [x] 4.2 Classifier recalibration against recorded spellings — each adjustment red-first from
      its fixture; ship as `fix:` if any rule changes, test-only otherwise.
- [x] 4.3 Fix the queued-capture docstring lie with the genuine fixture's arrival.

## 5. Gate and done

- [x] 5.1 Full gate green; contract tier containerless in CI unchanged; e2e stub-conformance
      gate green against corrected shapes.
- [x] 5.2 Drift job sanity: scheduled manifest check passes against the pinned OpenAPI snapshot
      with the grown manifest.
