## ADDED Requirements

### Requirement: The status view states when the acquisition was requested

The acquisition status read model SHALL expose **when the acquisition was requested** (`requestedAt`) as a field on the status view, taken from the recorded request event itself and NOT from the position an event happens to hold in storage, so a consumer ordering or describing acquisitions by recency reads a stated fact rather than one derived from storage or replay order. The field SHALL be present on the status view of every acquisition whose stream records a request — which is every acquisition the downloader produces — and SHALL be additive on the status contract (absent-tolerant for existing consumers), like the other decided lifecycle facts the view carries. Where a stream records no request at all, the view SHALL state no requested-at time rather than reporting some other event's.

#### Scenario: A fresh request states its requested-at time

- **WHEN** an acquisition is requested and its status view is read
- **THEN** the view's requested-at fact equals the time the request was recorded

#### Scenario: Requested-at is stable across the lifecycle

- **WHEN** an acquisition progresses through later phases and its status view is read again
- **THEN** the requested-at fact still reports the original request time, unchanged by subsequent events

#### Scenario: The stamp follows the request event, not the stored order

- **WHEN** a status view is read for a stream whose earliest stored event is something other than the request
- **THEN** the requested-at fact reports the request event's own time, not that of the event stored first
