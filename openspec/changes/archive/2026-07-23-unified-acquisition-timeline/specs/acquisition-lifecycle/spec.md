## ADDED Requirements

### Requirement: Acquisition history entries carry their occurrence time

Each entry of the acquisition status read model's history SHALL carry the occurrence time of the event it projects, sourced from the timestamp already stamped on that stored event, so a consumer can order the acquisition's history against another context's history in real time. This is additive to the existing history entries and SHALL NOT change which events surface as history or their carried detail.

#### Scenario: Each history entry reports when it happened

- **WHEN** an acquisition's status is read
- **THEN** every history entry carries the ISO-8601 occurrence time of its underlying event
