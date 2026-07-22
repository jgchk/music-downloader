## MODIFIED Requirements

### Requirement: Processing survives restarts without duplicating effects

The system SHALL resume in-progress acquisitions after a process restart: for every non-terminal acquisition, the effect its current state is waiting on SHALL be re-derived and re-dispatched idempotently — a mid-flight download re-attaches to its existing transfer where the source still holds it (re-enqueueing otherwise) with its stall and queue-wait budgets restarted, a pending resolution re-fires, and an acquisition awaiting manual selection correctly re-derives no effect. Resumption SHALL NOT start a second download for a candidate whose transfer is already in flight at the source. Within the at-least-once crash window — an effect was dispatched and its follow-on outcome recorded, but the consumer's checkpoint was not yet saved — redelivery SHALL converge: a re-dispatched effect is idempotent or its stale outcome is ignored by the decision logic, the acquisition's recorded history gains no duplicate outcome, and redelivery SHALL NOT wedge processing. A follow-on command rejected by the decision logic as stale or illegal SHALL be recorded and skipped.

#### Scenario: Restart mid-download resumes the transfer

- **GIVEN** an acquisition whose candidate download was dispatched before the process restarted
- **WHEN** the process restarts
- **THEN** the download is driven again — re-attached to the source's existing transfer or re-enqueued — and its stall and queue-wait budgets apply from resumption
- **AND** the candidate is not downloaded a second time when its transfer is already in flight

#### Scenario: Restart mid-resolution re-fires resolution

- **GIVEN** an acquisition that was resolving metadata when the process restarted
- **WHEN** the process restarts
- **THEN** the resolution effect is re-dispatched and the acquisition proceeds on its outcome

#### Scenario: Restart while awaiting manual selection stays paused

- **GIVEN** an acquisition awaiting manual edition selection when the process restarted
- **WHEN** the process restarts
- **THEN** the acquisition remains awaiting selection with its candidates intact and no effect is dispatched for it

#### Scenario: Restart inside the crash window re-dispatches without duplicating outcomes

- **GIVEN** an acquisition whose effect was dispatched and whose follow-on outcome was recorded, but whose consumer checkpoint was not saved before a crash
- **WHEN** the process restarts and redelivers the already-reacted event
- **THEN** the re-dispatched effect converges — the stale follow-on outcome is ignored and the acquisition's recorded history is unchanged

#### Scenario: A stale re-dispatched outcome does not wedge the consumer

- **GIVEN** a redelivered event whose re-dispatched effect produces a follow-on command that the decision logic rejects
- **WHEN** the consumer handles the rejection
- **THEN** it records the rejection and continues with subsequent events

## ADDED Requirements

### Requirement: A failing effect stalls only its own acquisition, within a bounded retry budget

The system SHALL isolate effect-dispatch failures per acquisition: an infrastructure fault retrying one acquisition's effect SHALL NOT delay the processing of any other acquisition's events. Retries SHALL back off exponentially and SHALL be bounded by a configurable budget. When the budget is exhausted, the system SHALL land the failure somewhere modeled and visible: an effect whose permanent failure has a modeled business outcome SHALL degrade to that outcome through the normal decision path; an effect without one SHALL be dead-lettered with its full context, and the owning acquisition SHALL be exposed as stalled by the status read model. Every park, retry, degradation, and dead-letter transition SHALL be observably logged with the acquisition, effect, and attempt. Ordering within an acquisition SHALL be preserved while it is parked: its later events wait behind the parked effect; other acquisitions' events do not.

#### Scenario: Other acquisitions flow past a poisoned effect

- **GIVEN** one acquisition whose resolution effect fails on every attempt
- **WHEN** another acquisition is submitted and processed
- **THEN** the second acquisition proceeds to its own outcome while the first retries independently

#### Scenario: An exhausted retry budget degrades to the modeled failure

- **GIVEN** an acquisition whose resolution effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the acquisition terminates through the modeled metadata-failure path, visibly, and retries stop

#### Scenario: An effect with no modeled failure dead-letters visibly

- **GIVEN** an acquisition whose staging-cleanup effect has failed for the entire retry budget
- **WHEN** the final retry fails
- **THEN** the effect is dead-lettered with its context and the acquisition is exposed as stalled by the status read model

#### Scenario: A transient outage rides out the backoff

- **GIVEN** an effect failing because its upstream is briefly unavailable
- **WHEN** the upstream recovers within the retry budget
- **THEN** a backed-off retry succeeds and the acquisition proceeds normally
