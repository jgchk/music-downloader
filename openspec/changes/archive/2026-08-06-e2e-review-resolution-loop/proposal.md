# Proposal: e2e-review-resolution-loop

## Why

The whole-project review sweep (2026-08-05) found that no tier ever drives a human review
**resolution** out-of-process: e2e only ever observes the review queue empty, so the entire
cross-context loop — importer `ReviewResolved` → published verdict → downloader verdict consumer
→ decider revival → a second delivery — is unwitnessed across the real stores and the real wire,
despite being the path with the scariest silent failure (a user's rejection publishing a verdict
that never revives the hunt). The grilling session (2026-08-05) chose the revival loop as the
one scenario worth the tier's cost: it is the only resolution path whose cross-context half no
other tier exercises, while the accept path's store-crossing is identical to the auto-apply flow
the full-loop phase already proves.

## What Changes

- **A new isolated e2e phase forces a genuine low-confidence review and resolves it as
  `reject-unusable-delivery` over HTTP**, then witnesses the downloader resume the hunt, deliver
  a second candidate, and the story complete into the library. Determinism comes from fixture
  engineering against the pinned beets version: the seeded source's tags land the match in the
  band between the auto-apply threshold and no-match, and the phase asserts the review actually
  queued (so a beets bump that moves the band fails loudly, not silently — the bridge tier's
  provenance discipline extended to e2e).
- **Test-tier only — unless the phase reveals the wire broken.** It did: the intake seam
  consumer converged a rejected import's replacement delivery away, dead-ending the revival
  loop at its last hop. The fix ships in this same change, evidence-driven (the boundary rule
  the slskd contract-truth change established): seam convergence now keys on a stream-level
  feed-position watermark (redeliveries and full replays converge; a later position is a new
  delivery; a new delivery meeting an unsettled cycle holds transiently), with the decider
  owning the invariant. `fix:` — this ships a release.
- **Non-goals:** no accept-after-review phase (covered by unit/Playwright tiers plus the
  full-loop auto-apply path); no free-text re-search coverage (`refine-search` remains
  deferred); no interaction with the stalled-work-recovery phase (independent scenarios; phase
  numbering composes in whichever order ships first).

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `out-of-process-e2e`: the tier additionally proves the review-resolution revival loop across
  both stores and the published-verdict seam.
- `import-management`: intake-seam convergence keys on the delivery's feed position (a
  stream-level watermark) instead of blanket acquisition-id dedupe, so a rejected import's
  replacement delivery starts a fresh cycle (task 4.2 fired).

## Impact

- **Code:** `test/e2e` (one new phase spec, its seeded fixture set, scripted WireMock
  mappings, `run.sh` phase registration, shared-helper growth) — plus, because task 4.2 fired,
  the importer's intake seam (consumer, decider, state fold, projection) and the downloader's
  contract registry for the scripted stubs.
- **Dependencies:** none on other drafted changes; sequencing with `stalled-work-recovery`'s
  phase is cosmetic. The slskd WireMock stubs gain a second-candidate script for the re-hunt.
- **Risk retired:** the review sweep's "no e2e review resolution" Important; the revival wire
  gains a regression gate before any future verdict-schema evolution.
