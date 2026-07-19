## Why

A fulfilled acquisition deposits validated files into the intake directory — and then nothing tells anyone. The new sibling service, music-importer, needs to learn "a release was deposited, here is where and what it is" near-instantly, without polling and without either tool knowing the other exists. More broadly, an event-sourced tool that keeps its facts private is only half a citizen of a composable ecosystem: the facts already exist on the stream; this change publishes the relevant ones.

The contract posture follows the researched cross-tool standard for this ecosystem: **this repo owns the schemas of the events it emits**, validates them outbound, and publishes them as versioned artifacts (generated JSON Schema + frozen fixtures); consumers are tolerant readers behind their own anti-corruption layers. No shared package, no broker, no knowledge of any consumer.

## What Changes

- A **durable webhook publisher**: a new checkpointed consumer of the event store (the store *is* the transactional outbox — same machinery as the reactor and projections) that translates selected domain events into published event payloads and POSTs them to configured subscriber URLs. At-least-once delivery: the checkpoint advances only on acknowledged delivery, retries with backoff, and a restart redelivers anything unacknowledged.
- The **first published event type: `acquisition.fulfilled`** — a self-contained ("fat") payload carrying the acquisition id, the resolved target (including its MusicBrainz release id), the fulfilled candidate's identity, and the deposited library location with its files — everything a consumer needs to act without a callback. The catalog is additive: future types (failures, verdict acks) join without breaking anything.
- **Standard Webhooks envelope**: `{type, timestamp, data}` body with `webhook-id` / `webhook-timestamp` / `webhook-signature` (HMAC) headers, so any receiver gets idempotency keys and authenticity for free; a breaking payload change is expressed as a new event `type`, never a mutation.
- **Producer-owned contract artifacts**: the outbound zod schemas live in `src/interfaces/contracts/events/` as the single source; CI generates JSON Schema from them and diffs against the last published version, failing on any non-additive change (the additive-only rule, mechanized); frozen fixtures of real payloads are committed and kept forever (webhook retries deliver old-version events after deploys).
- **Config-dormant standalone mode**: subscriber URLs and the signing secret come from the environment; with none configured, the publisher idles and the tool behaves exactly as today.

## Capabilities

### New Capabilities

- `outbound-events`: the published-event contract (ownership, envelope, payload, additive-only evolution) and the durable at-least-once publisher.

### Modified Capabilities

<!-- none — the publisher is a new, purely additive consumer of the existing stream -->

## Impact

- `src/interfaces/contracts/events/` — outbound event schemas (zod, single source) + payload mapping from domain events.
- `src/application/` — the publisher as a checkpointed stream consumer (reusing the checkpoint store; its own consumer name).
- `src/adapters/` — the webhook HTTP dispatcher (signing, retries/backoff) over the existing HTTP client seam.
- `src/composition/` — config (`WEBHOOK_URLS`, `WEBHOOK_SECRET`), wiring, startup.
- CI — JSON Schema generation + additive-only diff gate; fixture recording under `test/contract/`.
- No public HTTP API surface change; no domain change.
