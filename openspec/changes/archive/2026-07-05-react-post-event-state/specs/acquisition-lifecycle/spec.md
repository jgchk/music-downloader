# acquisition-lifecycle — Delta

## MODIFIED Requirements

### Requirement: Processing survives restarts without duplicating effects
The system SHALL resume in-progress acquisitions after a process restart without starting a second download for a candidate that is already in flight. Within the at-least-once crash window — an effect was dispatched and its follow-on outcome recorded, but the consumer's checkpoint was not yet saved — redelivery SHALL converge: a re-dispatched effect is idempotent or its stale outcome is ignored by the decision logic, the acquisition's recorded history gains no duplicate outcome, and redelivery SHALL NOT wedge processing. A follow-on command rejected by the decision logic as stale or illegal SHALL be recorded and skipped (the checkpoint advances past it); only infrastructure faults SHALL leave the checkpoint unadvanced for retry.

#### Scenario: Restart mid-download
- **GIVEN** an acquisition whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts and resumes from its checkpoint
- **THEN** the candidate is not downloaded a second time

#### Scenario: Restart inside the crash window re-dispatches without duplicating outcomes
- **GIVEN** an acquisition whose effect was dispatched and whose follow-on outcome was recorded, but whose consumer checkpoint was not saved before a crash
- **WHEN** the process restarts and redelivers the already-reacted event
- **THEN** the re-dispatched effect converges — the stale follow-on outcome is ignored and the acquisition's recorded history is unchanged

#### Scenario: A stale re-dispatched outcome does not wedge the consumer
- **GIVEN** a redelivered event whose re-dispatched effect produces a follow-on command that the decision logic rejects
- **WHEN** the consumer handles the rejection
- **THEN** it records the rejection, advances its checkpoint past the event, and continues with subsequent events

#### Scenario: An infrastructure fault is retried, not skipped
- **GIVEN** an event whose effect dispatch fails with an infrastructure fault
- **WHEN** the consumer handles the failure
- **THEN** the checkpoint is not advanced and the event is processed again on the next catch-up
