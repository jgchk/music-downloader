# Tasks — e2e-review-resolution-loop

Red-first: each phase probe is written against its target behavior before the harness wiring
that satisfies it. Test-tier only unless task 4.2 triggers.

## 1. Fixtures and stubs

- [ ] 1.1 Calibrate the review-band fixture against the image's pinned beets (deviation recipe
      documented beside the fixture, provenance note with the beets pin).
- [ ] 1.2 Two-candidate WireMock scenario: weak match first, clean second candidate for the
      re-hunt; journal-assertable single enqueue per candidate.

## 2. The phase

- [ ] 2.1 Setup probes: submission lands, first delivery imports into a queued review — the
      explicit review-queued premise assertion naming its purpose.
- [ ] 2.2 Resolution over HTTP with a production-codec guest session; assert acceptance and
      queue emptiness after.
- [ ] 2.3 Revival probes: hunt resumes without a new submission, second candidate delivers,
      story completes with the ordinary narration (centralized phrase maps only); staged
      first-delivery directory gone.

## 3. Harness integration

- [ ] 3.1 `run.sh` phase registration with honest phase-count comment; per-phase isolation
      (fresh stores) preserved.
- [ ] 3.2 Full local `pnpm test:e2e` green, all phases.

## 4. Evidence gate

- [ ] 4.1 If the revival wire holds: no production change, no version bump — test-tier PR.
- [ ] 4.2 If the phase reveals the wire broken: the failing probe is the red; fix the
      production defect in this change as `fix:` with its own unit-tier regression pin, and
      re-run the full gate.
