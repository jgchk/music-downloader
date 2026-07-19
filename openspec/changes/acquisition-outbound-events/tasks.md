## 1. The outbound contract

- [ ] 1.1 Write failing schema tests, then the `acquisition.fulfilled` zod schema in `src/interfaces/contracts/events/` (payload: acquisition id, target incl. MB release id + metadata, candidate identity, location, files; optional fields with explicit defaults) and the mapping from the folded stream to the payload.
- [ ] 1.2 JSON Schema generation script + committed generated schema; CI gate diffing against the committed previous version, failing on non-additive change; wire into `check`/pipeline.
- [ ] 1.3 Frozen payload fixtures under `test/contract/` (recorded from the mapping over fixture histories), kept permanently; contract tests parsing every fixture version with the current schema.

## 2. The publisher

- [ ] 2.1 Write failing tests for the checkpointed publisher consumer: filters mapped events, renders payloads from the stream prefix, advances a per-subscriber checkpoint only on acknowledged delivery, redelivers after restart, preserves order, isolates subscribers.
- [ ] 2.2 Implement the publisher in `src/application/` reusing the checkpoint store (consumer name `webhook:<url-hash>`), with bounded-backoff retries and loud logging on a held checkpoint.
- [ ] 2.3 Write failing tests, then the webhook dispatcher adapter (Standard Webhooks envelope, deterministic `webhook-id`, HMAC-SHA256 signature) over the existing HTTP client seam.

## 3. Composition + config

- [ ] 3.1 Config: `WEBHOOK_URLS` (list) + `WEBHOOK_SECRET`; dormant when unset; startup failure on URLs-without-secret; failing config tests first.
- [ ] 3.2 Wire the publisher into the composition root after the sweep, alongside the reactor.

## 4. Fidelity + gate

- [ ] 4.1 In-process e2e: a fulfilled acquisition drives a delivery to a stub subscriber (assert envelope, signature, payload, idempotency id stability across a simulated redelivery).
- [ ] 4.2 `pnpm check` + `pnpm test:e2e` green; doc comments on the publisher/dispatcher describing the outbox posture and the additive-only rule.
