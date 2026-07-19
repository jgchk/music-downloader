## Why

Fulfilment is provisional and the model doesn't know it yet. The system's own validation (decode + duration match) can pass a candidate whose files a downstream adjudicator later judges unacceptable — music-importer's beets matching is exactly such an adjudicator ("this claims to be the release but a track is a corrupt stub"). Today a bad delivered candidate is a dead end: the acquisition sits terminal at Fulfilled, and getting a different version means manually re-submitting and hoping ranking picks differently — it won't, because the rejected-candidate knowledge lives nowhere.

The retry machinery to handle this already exists: rejection → rejected set → next-best candidate → bounded re-search. This change adds the one missing edge: a **late-arriving external validation failure** that revives a fulfilled acquisition back into that ladder. In the tool's own ubiquitous language this is validation that ran outside the system — no importer concept enters the domain.

## What Changes

- A new command **`RecordExternalValidationFailed`** (acquisition id, the judged candidate's identity, reasons) and event **`FulfillmentRejected`**: on a Fulfilled acquisition whose fulfilled candidate matches, `decide` mints the rejection and re-enters the existing ladder (`CandidateRejected` → select next / re-search / exhaust). Every existing bound applies — revivals spend the same attempt and search-round budgets, so the system still converges to absorbing terminal states.
- **`Fulfilled` becomes stable-but-defeasible**: still the happy resting state, still terminal for every purpose that exists today (sweep, cancellation of nothing, status), but no longer immune to this one command. The folded Fulfilled state retains the fulfilled candidate's identity (the stale-guard: a verdict naming any other candidate is ignored) and the context needed to resume the ladder. All other terminal states remain absorbing. No acknowledgement/sealing flow — a fulfilled acquisition that never hears a verdict rests at Fulfilled forever, exactly as today.
- An **inbound verdict webhook receiver** on the HTTP surface: an edge adapter that accepts a signed webhook delivery, tolerantly reads only the fields it needs (acquisition id, candidate identity, verdict, reasons) from the sender's payload, translates through the anti-corruption layer into the native command, and converges idempotently on redelivery. Config-dormant: no receiver secret configured → the endpoint is not registered.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `acquisition-lifecycle`: fulfilment is stable-but-defeasible — an external validation failure for the fulfilled candidate revives the acquisition into the existing bounded retry ladder; stale or mismatched verdicts are ignored.
- `public-api`: gains the inbound verdict webhook receiver (signed, tolerant-reader, idempotent, config-dormant).

## Impact

- `src/domain/acquisition/{commands,events,decide,state}.ts` — the command/event pair; `FulfilledState` retains candidate identity + resume context (fold-shape change, additive; legacy histories upcast with no retained candidate and simply cannot be revived — the correct degraded behavior).
- `src/interfaces/http/` + `src/interfaces/contracts/` — the receiver endpoint, its tolerant-reader schema, signature verification.
- `src/application/` — command plumbing (no new effects; the revival reuses Download/Search reactions as-is).
- `src/composition/` — receiver config (`VERDICT_WEBHOOK_SECRET`).
- Tests across decide/state/react totality, receiver contract + idempotency, and an e2e reviving a fulfilled acquisition into a second candidate.
