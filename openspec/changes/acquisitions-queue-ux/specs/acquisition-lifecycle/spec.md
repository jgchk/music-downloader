## ADDED Requirements

### Requirement: The status view states when the acquisition was requested

The acquisition status read model SHALL expose **when the acquisition was requested** (`requestedAt`) as a field on the status view, taken from the acquisition's first recorded event, so a consumer ordering or describing acquisitions by recency reads a stated fact rather than deriving one from storage or replay order. The field SHALL be present on every status view from the moment the request is recorded, and SHALL be additive on the status contract (absent-tolerant for existing consumers), like the other decided lifecycle facts the view carries.

#### Scenario: A fresh request states its requested-at time

- **WHEN** an acquisition is requested and its status view is read
- **THEN** the view's requested-at fact equals the time the request was recorded

#### Scenario: Requested-at is stable across the lifecycle

- **WHEN** an acquisition progresses through later phases and its status view is read again
- **THEN** the requested-at fact still reports the original request time, unchanged by subsequent events
