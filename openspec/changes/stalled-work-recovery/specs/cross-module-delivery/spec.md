# cross-module-delivery — delta for stalled-work-recovery

## ADDED Requirements

### Requirement: Dead-lettered work is operator-redrivable without a restart

Each module SHALL expose, through its facade, a stalled-work read (every stalled stream with its
dead-letter diagnostics and recorded stall time) and a per-stream redrive operation. Redrive
SHALL be an infrastructure operation — no domain command, no event appended — that runs on the
same dispatch serialization as the startup re-drive and, in order: verifies the stream is
actually stalled (refusing otherwise as a modeled outcome, idempotent under concurrent
requests); logs the letters it is about to clear (count, errors, ages) so the trail never
vanishes silently; clears the stream's letters and stalled exposure through the module's single
existing clearing seam; and re-dispatches the stream's pending effect, derived from folded
state, through the normal dispatch path with a fresh full retry budget — the ordinary
park/backoff/exhaustion ladder, dead-lettering again at its end. The operation SHALL take no
arguments beyond the stream identity — no payload or state editing — and SHALL return once
dispatch is initiated, not once the work settles. A redriven effect whose earlier execution
partially succeeded SHALL settle through the domain's ordinary stale-command absorption.

#### Scenario: Redrive re-dispatches through the normal ladder

- **GIVEN** a stalled stream whose failure cause has been repaired
- **WHEN** its redrive is invoked
- **THEN** the letters are logged then cleared, the stalled exposure lifts, the pending effect
  dispatches through the normal path, and the stream proceeds to its ordinary outcome

#### Scenario: A still-broken stream re-stalls with a fresh trail

- **GIVEN** a stalled stream whose failure cause persists
- **WHEN** its redrive is invoked and the effect exhausts a fresh retry budget
- **THEN** the stream is dead-lettered and marked stalled again through the ordinary machinery,
  with the new failure recorded

#### Scenario: Redriving a non-stalled stream is refused as a value

- **WHEN** redrive is invoked for a stream with no dead letters
- **THEN** the operation returns a modeled refusal, dispatches nothing, and clears nothing

#### Scenario: A duplicate-settling redrive is absorbed

- **GIVEN** a stalled stream whose dead-lettered effect had actually completed its side effect
  before the failure was recorded
- **WHEN** it is redriven and the effect's outcome reports work already settled
- **THEN** the domain absorbs it as a stale command and the stream converges without corruption

#### Scenario: The event history is untouched

- **WHEN** any redrive is invoked, succeeding or failing
- **THEN** no event is appended, edited, or deleted in either module's store on account of the
  redrive itself
