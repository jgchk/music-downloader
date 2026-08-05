# download-management — delta for stalled-work-recovery

## ADDED Requirements

### Requirement: Undeliverable outcomes escalate beyond logs

When a settled download outcome cannot be delivered to the module's decision path, the delivery
loop SHALL retry with bounded escalating backoff up to a configured ceiling — not a fixed
cadence — and persistent delivery failure SHALL be reported into the module's readiness
snapshot (see `runtime-baseline`) so the composed health surface reflects it. Delivery SHALL
remain at-least-once with restart re-emit as the durable recovery; no additional durable store
is introduced for undelivered outcomes. When delivery eventually succeeds, the readiness
contribution SHALL clear.

#### Scenario: Backoff escalates instead of spinning

- **GIVEN** a settled outcome whose delivery keeps failing
- **WHEN** the delivery loop retries
- **THEN** successive attempts are spaced by escalating delays up to the ceiling, not a flat
  cadence

#### Scenario: Persistent failure degrades readiness

- **GIVEN** an outcome whose delivery has failed persistently past the configured threshold
- **WHEN** the module's readiness snapshot is read
- **THEN** it reports the module degraded on account of undeliverable outcomes

#### Scenario: Recovery clears the signal

- **GIVEN** readiness degraded by undeliverable outcomes
- **WHEN** a subsequent delivery attempt succeeds (in-process or after a restart re-emit)
- **THEN** the readiness snapshot no longer reports the delivery failure
