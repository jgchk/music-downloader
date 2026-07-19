## ADDED Requirements

### Requirement: Fulfilled acquisitions are published to configured webhook subscribers

The system SHALL publish an `acquisition.fulfilled` event to every configured subscriber URL when an acquisition reaches fulfilment, carrying a self-contained payload — the acquisition id, the resolved target including its MusicBrainz release id, the fulfilled candidate's identity, and the deposited library location with its files — so a consumer can act without calling back. With no subscribers configured, the system SHALL behave exactly as it does today.

#### Scenario: A deposit is announced

- **WHEN** an acquisition is fulfilled and a subscriber is configured
- **THEN** the subscriber receives an `acquisition.fulfilled` payload naming the deposited location, the target's MusicBrainz release id, and the files

#### Scenario: Standalone mode is unchanged

- **GIVEN** no subscriber URLs configured
- **WHEN** acquisitions run to fulfilment
- **THEN** no delivery is attempted and no behavior differs from before this capability existed

### Requirement: Delivery is durable, ordered, and at-least-once

The system SHALL deliver published events through a durable checkpointed consumer of the event store: a delivery is retried with bounded backoff, a subscriber's checkpoint advances only on acknowledged delivery, undelivered events survive restarts and redeliver, and each subscriber receives events in stream order. Subscribers SHALL be isolated: one unreachable subscriber does not affect delivery to another. Each delivery SHALL carry a stable idempotency id so redeliveries are detectable by the receiver.

#### Scenario: A crash between append and delivery loses nothing

- **GIVEN** an acquisition fulfilled moments before a process crash
- **WHEN** the system restarts
- **THEN** the event is delivered from the checkpoint as if the crash had not happened

#### Scenario: A redelivered event is identifiable

- **GIVEN** a delivery whose acknowledgement was lost
- **WHEN** the event is delivered again
- **THEN** it carries the same idempotency id as the first attempt

#### Scenario: One dead subscriber does not starve another

- **GIVEN** two configured subscribers, one unreachable
- **WHEN** events are published
- **THEN** the reachable subscriber keeps receiving them while the unreachable one's checkpoint holds for retry

### Requirement: Published events follow the Standard Webhooks envelope and are signed

Deliveries SHALL use the Standard Webhooks conventions: a `{type, timestamp, data}` body and `webhook-id`, `webhook-timestamp`, and `webhook-signature` (HMAC) headers, signed with a configured secret. The system SHALL refuse to start with subscribers configured but no signing secret.

#### Scenario: A receiver can verify authenticity

- **WHEN** a delivery arrives at a subscriber
- **THEN** its signature verifies against the shared secret and the id/timestamp headers it carries

#### Scenario: Unsigned publishing is impossible

- **GIVEN** subscriber URLs configured without a signing secret
- **WHEN** the system starts
- **THEN** startup fails with a precise configuration error

### Requirement: The outbound contract is producer-owned, additive-only, and published as artifacts

The outbound event schemas SHALL live in this repository as the single contract source, validate every outgoing payload, and be published as generated JSON Schema plus frozen payload fixtures. Evolution SHALL be additive-only within an event type — verified in CI by diffing the generated schema against the last published version — and a breaking payload change SHALL be expressed as a new event type. Committed fixtures SHALL be kept permanently so compatibility is verifiable against every historical version.

#### Scenario: A non-additive schema change fails CI

- **GIVEN** an edit that removes or retypes a published payload field
- **WHEN** the contract gate runs
- **THEN** the build fails identifying the incompatible change

#### Scenario: An outbound payload violating its schema never leaves the process

- **GIVEN** a payload-rendering defect
- **WHEN** the payload fails outbound validation
- **THEN** the delivery is not attempted and the defect surfaces as an error
