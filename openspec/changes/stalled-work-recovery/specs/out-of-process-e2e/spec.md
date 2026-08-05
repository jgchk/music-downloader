# out-of-process-e2e — delta for stalled-work-recovery

## ADDED Requirements

### Requirement: The stall-recovery phase proves the operator's golden path

The e2e tier SHALL include an isolated phase that forces a genuine dead-letter stall in the
running image — by making the library destination unwritable so the import's apply effect
exhausts its retry budget against real infrastructure — and then witnesses the full recovery
path over HTTP: the user-register surfaces stop claiming progress and tell the stalled truth;
the operations surface (authenticated as an owner) lists the stalled item with its diagnostics;
after the underlying cause is repaired, submitting the redrive resumes the work; and the story
reaches its ordinary imported outcome with the stalled telling gone. The retry budget and
backoff SHALL be tunable through the environment so the phase forces exhaustion in seconds, not
production timings; the tuning SHALL use the ordinary configuration surface, not a test-only
code path in the image.

#### Scenario: A forced stall surfaces, redrives, and completes

- **GIVEN** the image running with an e2e-tuned retry budget and an unwritable library
  destination
- **WHEN** an import's apply effect exhausts its budget, the destination is then repaired, and
  the phase submits the item's redrive through the operations surface
- **THEN** before the redrive the story reads as stalled (not in-progress) and the operations
  surface lists it with diagnostics; after the redrive the import completes into the library and
  the stalled telling is gone

#### Scenario: The stall survives a restart before the redrive

- **GIVEN** a forced stall as above
- **WHEN** the container restarts before any redrive
- **THEN** the item is still reported stalled after boot — the exposure is durable, not
  in-memory — and the redrive path still recovers it
