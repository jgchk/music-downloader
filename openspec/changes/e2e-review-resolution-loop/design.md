# Design — e2e-review-resolution-loop

## Context

See proposal.md — Why. The e2e harness (test/e2e) already: runs the real image with WireMock'd
slskd and stubbed outermost third parties, seeds source fixtures at stub-reported locations,
walks HTTP flows with deadline-bounded polling probes, and scrapes UI copy through centralized
phrase maps in `helpers.ts`. The full-loop phase proves submission → auto-apply → library. The
revival loop's production machinery (verdict consumer, decider revival, second delivery) is
fully unit/contract-covered; only the out-of-process composition is unwitnessed.

## Goals / Non-Goals

**Goals:** one deterministic phase for the revival loop; premise-asserting setup so beets drift
fails loudly.

**Non-Goals:** accept-after-review phase; refine-search; any production change (absent
evidence of a broken wire); Playwright involvement (this is the HTTP tier's job).

## Decisions

**D1 — Forcing the review band with real beets.** The seeded fixture's tags deviate from the
stub-metadata identity just enough to score inside the review band (the gap between the
auto-apply threshold and no-match) for the image's pinned beets. The deviation recipe (e.g. a
title variant + a duration nudge) is calibrated at implementation against the pinned version and
documented next to the fixture; the phase's review-queued assertion is the guard that keeps the
calibration honest over time. Alternative considered — lowering the auto-apply threshold via
env for the phase: rejected, it tests a configuration the product doesn't run and weakens the
premise the phase exists to prove.

**D2 — Two-candidate WireMock script.** The slskd stub serves a search yielding the
weak-match candidate first and a second, better candidate for the post-verdict re-hunt
(stateful WireMock scenario, same mechanism the Hold-scenario stubs use). The second candidate's
fixture matches cleanly so the revived story auto-applies — the phase's terminal probe is the
existing delivered/imported narration via the centralized phrase maps.

**D3 — Resolution over HTTP, session via the production codec.** The phase posts the
resolution form exactly as a browser would, authenticated with a cookie minted by the imported
production `signSession` (the tier's established doctrine). After `auth-roles` merges, minted
claims carry a role; this phase needs only the base interface, so it mints a guest — asserting
in passing that review resolution requires no privilege.

**D4 — Staging-cleanup assertion.** The rejection's contract (files deleted, hunt resumes) is
asserted from outside: the staged first-delivery directory is gone after resolution, per the
destructive verb's documented consequence. This doubles as the black-box witness for the
consequence copy's determinism principle.

## Risks / Trade-offs

- **[Beets scoring drift breaks the band calibration]** → The explicit review-queued setup
  assertion names the premise; the fixture-provenance discipline (beets pin recorded beside the
  fixture) makes re-calibration a deliberate act, mirroring the bridge tier.
- **[Phase runtime]** → One extra image boot plus two delivery cycles; bounded by the same
  polling budgets as existing phases. Acceptable against the wire it uniquely covers.
- **[Flake via WireMock scenario state]** → The Hold-scenario precedent shows stateful stubs
  stable in this harness; the journal assertions (single enqueue per candidate) carry over.

## Migration Plan

Test-tier only; lands with `run.sh` registration and the phase-count comment updated (S3 fixes
the current count drift; this change keeps it honest). No version bump unless the wire proves
broken — then the fix rides this change as `fix:` and bumps normally.
