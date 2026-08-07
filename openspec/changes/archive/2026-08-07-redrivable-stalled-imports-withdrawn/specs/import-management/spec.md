# import-management — delta for redrivable-stalled-imports

## ADDED Requirements

### Requirement: A stalled import is redrivable as a domain fact with a fresh budget

The system SHALL let an operator retry a stalled import's failed effect through a domain command
that records the retry as an event on the import's own stream, legal only while the import is in
its applying phase (terminal states absorb the command as a no-op; other phases refuse it as a
modeled error). Reacting to the recorded retry SHALL re-derive the same apply effect from the
import's state that the original resolution derived, and — by the durable-budget design — the
retried effect SHALL carry a fresh retry budget and its successful processing SHALL clear the
import's dead letters and stalled exposure. The facade SHALL expose the retry as an additive
command that is permitted only while the import is actually exposed as stalled; requesting a
retry for a non-stalled import SHALL be a modeled refusal, never a duplicate concurrent apply.
The import history SHALL narrate the retry through an additive entry kind carrying its
occurrence time. No redrive SHALL require direct store manipulation.

#### Scenario: Retrying a stalled apply re-drives the effect with a fresh budget

- **GIVEN** an import whose apply effect dead-lettered and is exposed as stalled
- **WHEN** the operator dispatches the retry command through the facade
- **THEN** a retry event is recorded on the import's stream, the reactor re-dispatches the apply
  effect with a fresh retry budget, and the import's dead letters and stalled exposure are
  cleared

#### Scenario: A successful redrive completes the import

- **GIVEN** a stalled import whose underlying failure cause has been remedied
- **WHEN** the operator retries and the re-driven apply succeeds
- **THEN** the import reaches its applied phase exactly as an undisturbed apply would, and the
  history narrates the retry between the resolution and the application

#### Scenario: A retry for a non-stalled import is refused, not double-dispatched

- **GIVEN** an import in its applying phase whose effect is still being processed (not stalled)
- **WHEN** a retry command is dispatched
- **THEN** the facade returns a modeled refusal and no additional apply effect is dispatched

#### Scenario: A retry against a settled import is absorbed

- **GIVEN** an import already applied or rejected
- **WHEN** a retry command is dispatched
- **THEN** the command is absorbed without effect and the import's state is unchanged

#### Scenario: A re-driven effect that fails again stalls again, honestly

- **GIVEN** a stalled import whose failure cause persists
- **WHEN** the operator retries and the re-driven apply exhausts its fresh budget
- **THEN** the retry event dead-letters like any other effect and the import is exposed as
  stalled again
