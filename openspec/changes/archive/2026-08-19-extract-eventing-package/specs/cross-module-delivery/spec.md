# cross-module-delivery — delta

## MODIFIED Requirements

### Requirement: Poison-event policy per subscription

A subscription SHALL retry a failing event a bounded number of times with backoff; on exhaustion it SHALL **halt**: stop the subscription without advancing the checkpoint, surfacing the stall via structured logs, leaving later events unprocessed and other subscriptions unaffected. Failures classified transient SHALL hold the checkpoint for redelivery (the fallback poll retries them indefinitely) rather than counting toward exhaustion-halt; only failures classified permanent halt the subscription. Recovery from a halt is a restart (or explicit reset) after the defect is fixed: the subscription resumes from the held checkpoint in order.

#### Scenario: Halt preserves order

- **WHEN** an event exhausts its retries on a subscription
- **THEN** the subscription stops advancing, later events remain unprocessed, the stall is logged, and other subscriptions continue unaffected

#### Scenario: Restart after a fix is the redrive

- **WHEN** a halted subscription's process restarts after the causing defect is fixed
- **THEN** the subscription resumes from the held checkpoint and processes the formerly poison event and all successors in feed order, with no event skipped

#### Scenario: Transient failure holds without halting

- **WHEN** an event's handler reports a transient failure
- **THEN** the checkpoint is not advanced, the event is redelivered by the poll loop, and the subscription does not halt

> Delta note — what this modification removes: the former **park** arm (dead-letter-and-advance) and its "Park preserves progress" scenario. It had zero production callers, and `docs/research/poison-event-halt-vs-park.md` (2026-08-18) finds halt-only is the field-attested policy for this seam's profile: ordered feed, deploy-coupled poison (schema bugs, so parking dead-letters a type's whole traffic anyway), and fix-then-restart as the natural in-order redrive. No behaviour changes in production. Per-stream parking (the one attested synthesis, Axon's SequencedDeadLetterQueue) stays recorded in the research doc as a named, non-adopted upgrade path; the policy seam stays a narrow waist so a future park arm would be additive.
