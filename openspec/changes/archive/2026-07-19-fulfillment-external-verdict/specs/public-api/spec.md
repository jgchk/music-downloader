## ADDED Requirements

### Requirement: External verdicts are received over a signed, idempotent webhook endpoint

The system SHALL expose an inbound webhook endpoint that accepts external validation verdicts for delivered acquisitions: deliveries are verified against a configured shared secret (signature and timestamp) and deduplicated by delivery id; payloads are read tolerantly — only the acquisition id, candidate identity, verdict, and optional reasons this domain needs, ignoring unknown fields — and translated at the boundary into the native external-validation command. Redelivered or stale verdicts SHALL converge without error. With no receiver secret configured, the endpoint SHALL NOT be registered and the system behaves exactly as today.

#### Scenario: A signed rejection verdict revives an acquisition

- **GIVEN** a fulfilled acquisition and a configured receiver secret
- **WHEN** a correctly signed verdict delivery rejects the fulfilled candidate
- **THEN** the acquisition revives into the retry ladder and the endpoint acknowledges the delivery

#### Scenario: An unsigned delivery is rejected before parsing

- **WHEN** a delivery arrives with a missing or invalid signature
- **THEN** it is rejected without any command being issued

#### Scenario: A redelivered verdict converges

- **GIVEN** a verdict delivery already processed
- **WHEN** the same delivery arrives again
- **THEN** it is acknowledged and the acquisition's state is unchanged

#### Scenario: Unknown payload fields are ignored

- **GIVEN** a sender whose payload carries fields this system does not use
- **WHEN** the delivery is processed
- **THEN** the extra fields are ignored and the verdict is handled normally
