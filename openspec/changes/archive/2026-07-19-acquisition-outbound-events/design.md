## Context

music-importer (sibling repo, bootstrapped 2026-07-19) will consume "a release was deposited" facts to trigger imports. The coupling design was settled after a literature survey (Newman, Evans, Fowler/Robinson CDC, Bellemare, Hohpe, CloudEvents/Standard Webhooks): producer-owned event schemas, tolerant-reader consumers, no shared contracts package, webhooks as the broker-less transport. This repo already has every mechanical ingredient: an event-sourced store with global ordering, checkpointed durable consumers (the reactor), and zod-first contracts.

## Goals / Non-Goals

**Goals:**

- Publish `acquisition.fulfilled` reliably (at-least-once, ordered, restart-safe) to configured HTTP subscribers, with authenticity and idempotency conveyed per Standard Webhooks.
- Own the outbound contract: schema in this repo, validated outbound, additive-only forever, published as generated JSON Schema + frozen fixtures other repos can test against.
- Zero behavior change when no subscriber is configured; zero knowledge of any specific consumer.

**Non-Goals:**

- No broker (MQTT/Kafka) — transport is swappable later behind the publisher seam if fan-out ever demands it.
- No consumer-side anything (music-importer's intake adapter lives in its repo).
- No event types beyond `acquisition.fulfilled` in this change — the catalog grows additively.
- No delivery guarantees beyond at-least-once (consumers deduplicate by `webhook-id`/acquisition id).

## Decisions

### D1 — The event store is the outbox; the publisher is a checkpointed consumer

No dual-write problem exists here by construction: domain events are already durably appended before anything else happens, so the publisher is simply another checkpointed consumer of the global stream (exactly the reactor's shape, with its own consumer name). It folds nothing and decides nothing: it filters for events that have a published mapping (`AcquisitionFulfilled`, joined with its stream's context for the payload), renders the outbound payload, delivers, and advances its checkpoint only on success. Crash anywhere → redelivery from the checkpoint. This is the transactional-outbox pattern with zero new infrastructure.

### D2 — One publisher checkpoint, per-delivery retries, bounded then parked

Delivery failures retry in-process with capped exponential backoff; a subscriber that stays down does not advance the checkpoint, so the events redeliver on the next cycle/restart — the same convergence posture as the reactor. Deliveries to multiple subscribers are independent per URL (one slow subscriber must not starve another → per-subscriber checkpoints, keyed `webhook:<url-hash>`). Ordering is preserved per subscriber (deliver in global-seq order; do not skip ahead past an undelivered event) because the consumer contract is easier to reason about ordered, and the volume (a handful of fulfillments) makes head-of-line blocking irrelevant.

### D3 — Fat, self-contained payloads in the producer's own language

The payload carries acquisition id, target (with MusicBrainz release id, artist/title metadata), fulfilled candidate identity, deposited location, and file listing — a consumer can act with no callback. The vocabulary is this tool's ubiquitous language ("acquisition", "candidate", "fulfilled"); consumers translate at their own ACLs (the settled anti-corruption posture — there is deliberately no "neutral" vocabulary to co-own). Optional fields carry explicit defaults in the schema, so absent-field behavior lives in the contract, not in receiver code (Hohpe's optional-field trap).

### D4 — Standard Webhooks envelope and evolution rules

Body `{type: 'acquisition.fulfilled', timestamp, data}`; headers `webhook-id` (deterministic: consumer idempotency key, derived from global seq + subscriber), `webhook-timestamp`, `webhook-signature` (HMAC-SHA256 over id.timestamp.body with the configured secret). Evolution: **additive-only within a type; a breaking change is a new `type`**. CI mechanizes the rule: zod schemas → generated JSON Schema, diffed against the committed previous version, failing on non-additive change; frozen payload fixtures are committed and never deleted (old-version events legitimately arrive after deploys via retries).

### D5 — Config-dormant; secrets and URLs from the environment

`WEBHOOK_URLS` (comma-separated) and `WEBHOOK_SECRET` via config (12-factor). Unset → the publisher does not start; nothing else changes. Misconfigured (URLs without secret) → startup fails loudly rather than publishing unsigned.

## Risks / Trade-offs

- **[Payload from folded context]** `AcquisitionFulfilled` alone doesn't carry the target/candidate detail; the publisher folds the stream (cheap, same as projections) to render the payload. → Render at delivery time from the stream prefix — deterministic and replay-safe.
- **[Slow/dead subscriber]** Blocks its own checkpoint indefinitely. → By design (convergence over loss); per-subscriber isolation keeps others unaffected; log loudly.
- **[Schema-diff gate false confidence]** JSON Schema diffing catches structure, not semantics. → Frozen fixtures + consumer contract tests (in consumer repos) cover meaning; the gate is one layer, not the whole story.

## Open Questions

- Whether `webhook-id` derivation should include the event's stream version vs global seq only — decide in implementation with the idempotency tests.
