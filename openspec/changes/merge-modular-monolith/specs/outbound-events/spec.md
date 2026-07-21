## ADDED Requirements

### Requirement: Fulfilled acquisitions are published on the module's outbound event feed
The system SHALL expose an `acquisition.fulfilled` event on the downloader module's outbound feed when an acquisition reaches fulfilment, carrying a self-contained payload — the acquisition id, the resolved target including its MusicBrainz release id, the fulfilled candidate's identity, and the deposited location with its files — so a consuming module can act without calling back into the producer. The feed SHALL be consumed in-process by tolerant readers behind each consumer's anti-corruption layer; the producer SHALL NOT know its consumers.

#### Scenario: A fulfilment is available to the importer
- **WHEN** an acquisition is fulfilled
- **THEN** the outbound feed carries an `acquisition.fulfilled` payload naming the deposited location, the target's MusicBrainz release id, and the files, and the importer's subscription observes it

#### Scenario: No consumers changes nothing
- **GIVEN** no subscription is registered against the feed
- **WHEN** acquisitions run to fulfilment
- **THEN** the producer's behavior is unchanged and events remain durably stored for any future subscriber

## MODIFIED Requirements

### Requirement: Delivery is durable, ordered, and at-least-once

The system SHALL deliver published events through a durable checkpointed catch-up subscription over the producer's event store: the consumer tails events by global position, each subscription owns a named checkpoint persisted in the consumer's own store, the checkpoint advances only in the same transaction as the consumer's effects, undelivered events survive restarts and redeliver from the checkpoint, and each subscription receives events in global-position order (per-stream order preserved). Subscriptions SHALL be isolated: one halted or lagging subscription does not affect delivery to another. Each delivered event SHALL carry a stable identity (its global position and event id) so redeliveries are detectable by the receiver.

#### Scenario: A crash between append and consumption loses nothing
- **GIVEN** an acquisition fulfilled moments before a process crash
- **WHEN** the system restarts
- **THEN** the subscription resumes from its checkpoint and the event is consumed as if the crash had not happened

#### Scenario: A redelivered event is identifiable
- **GIVEN** a batch whose effects-and-checkpoint transaction did not commit
- **WHEN** the events are delivered again after restart
- **THEN** they carry the same global positions and event ids as the first attempt, and the consumer converges idempotently

#### Scenario: One halted subscription does not starve another
- **GIVEN** two registered subscriptions, one halted by its poison-event policy
- **WHEN** events are published
- **THEN** the healthy subscription keeps advancing its own checkpoint while the halted one's checkpoint holds

### Requirement: The outbound contract is producer-owned, additive-only, and published as artifacts

The outbound event schemas SHALL live with the producing module as the single contract source, validate every outgoing payload, and be published as generated JSON Schema plus frozen payload fixtures. Evolution SHALL be additive-only within an event type — verified in CI by diffing the generated schema against the last published version — and a breaking payload change SHALL be expressed as a new event type. Committed fixtures SHALL be kept permanently so compatibility is verifiable against every historical version. Consuming modules SHALL contract-test their tolerant readers against the producer's frozen fixtures in the same repository's test suite, replacing cross-repo drift detection.

#### Scenario: A non-additive schema change fails CI
- **GIVEN** an edit that removes or retypes a published payload field
- **WHEN** the contract gate runs
- **THEN** the build fails identifying the incompatible change

#### Scenario: An outbound payload violating its schema never reaches a consumer
- **GIVEN** a payload-rendering defect
- **WHEN** the payload fails outbound validation
- **THEN** the event is not exposed to subscriptions and the defect surfaces as an error

#### Scenario: A consumer's reader is verified against producer fixtures in-repo
- **WHEN** the test suite runs
- **THEN** the importer's tolerant reader parses the downloader's frozen `acquisition.fulfilled` fixtures successfully, in the same gate that blocks the merge

## REMOVED Requirements

### Requirement: Fulfilled acquisitions are published to configured webhook subscribers
**Reason**: The only consumer (the importer) now runs in the same process; webhook subscriber URLs and HTTP delivery are replaced by the in-process catch-up subscription over the producer's event store.
**Migration**: Superseded by "Fulfilled acquisitions are published on the module's outbound event feed" (above) and the `cross-module-delivery` capability. The self-contained payload shape is unchanged.

### Requirement: Published events follow the Standard Webhooks envelope and are signed
**Reason**: HMAC signing, timestamp headers, and the Standard Webhooks envelope authenticate a network hop that no longer exists; in-process delivery is authenticated by construction.
**Migration**: Payload authenticity is now the process boundary; contract integrity remains enforced by producer-owned schemas, outbound validation, and in-repo consumer contract tests. If a network transport is ever reintroduced, signing returns with that transport binding.
