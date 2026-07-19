## 1. Domain: the revival edge

- [ ] 1.1 Write failing `state.test.ts` cases: `FulfilledState` retains the fulfilled candidate's identity and ladder-resume context (target, policies, working set, request); legacy histories fold to Fulfilled with no retained candidate; `FulfillmentRejected` folds Fulfilled → the rejection path (then `CandidateRejected`/`selectNext` events fold as they already do); implement the fold changes.
- [ ] 1.2 Write failing `decide`/`acquisition.test.ts` cases for `RecordExternalValidationFailed`: matching candidate on Fulfilled → `[FulfillmentRejected, CandidateRejected, selectNext]` (next-best, re-search, and exhaust variants); mismatched candidate → no-op; legacy no-retained-candidate → no-op; absorbing states → no-op; post-revival redelivery → no-op via existing phase guards; implement command + event + decide case.
- [ ] 1.3 Verify `react` totality (`FulfillmentRejected` → no effects; the co-emitted `CandidateRejected` already drives cleanup, and `CandidateSelected`/`SearchRequested` already drive the revival's work); extend totality/upcast tests.

## 2. The verdict receiver (interfaces)

- [ ] 2.1 Write failing contract tests for the tolerant-reader verdict schema (acquisition id, candidate identity, verdict, optional reasons; unknown fields ignored) and Standard Webhooks verification (HMAC, timestamp window, `webhook-id` dedupe).
- [ ] 2.2 Implement the receiver route + ACL translation into `RecordExternalValidationFailed` through the existing command handler; config-dormant registration (`VERDICT_WEBHOOK_SECRET`); failing inject tests first (signed-revives, unsigned-rejected, redelivery-converges).

## 3. Composition + fidelity

- [ ] 3.1 Config schema + wiring; startup log line stating whether the receiver is active.
- [ ] 3.2 In-process e2e: fulfil an acquisition with two ranked candidates, deliver a signed rejection verdict, assert the second candidate downloads and the acquisition re-fulfils; assert a duplicate delivery changes nothing.
- [ ] 3.3 `pnpm check` green; update `openspec/specs` deltas on archive; doc comments for the defeasible-Fulfilled model in `state.ts`/`decide.ts`.
