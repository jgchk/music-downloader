# Slskd Search Harvest Integrity

## Why

Two production acquisitions (Nirosta Steel — MY SKYSCRAPER, Mort Garson — Mother Earth's Plantasia) terminally exhausted with zero candidates for music that is plentifully available. Root cause, reproduced live: the adapter's 15s polling deadline races slskd's own 15s search timeout, and slskd persists responses only at search finalization — so `/responses` returns 0 rows while the search state already advertises 180+ responses. Any query specific enough to stay under slskd's 250-response early-completion limit deterministically loses the race: the adapter harvests zero, deletes the search mid-flight (provoking slskd-side DB concurrency errors), reports the empty harvest as a valid business fact, and the domain — which exhausts immediately on an empty first round without consulting the search-round budget — permanently kills the acquisition. A truncated read is being misclassified as a permanent "nothing exists" answer: another member of the misclassified-permanent family.

## What Changes

- The slskd search adapter harvests responses only from a search the source has confirmed complete. Reaching the polling deadline while the search is still in progress becomes a retryable infra fault, not an empty `Ok` — and the polling deadline is raised comfortably above slskd's own search timeout so the fault path is the exception, not the rule.
- A harvest that contradicts the search's own state (the source reports responses received, but the responses endpoint returns none) is likewise an infra fault, not an empty result.
- An unharvested (faulted) search is never deleted mid-flight; it is left to finish on the source, its live ledger row retired later by the existing startup sweep. Mid-flight deletion is what corrupts slskd's search task today.
- The domain treats an empty search round as a spent round on the retry ladder: while search-round budget remains, an empty round requests a fresh round; exhaustion happens only when the budget is spent. **BREAKING** for recorded behavior expectations only in the sense that an empty round now emits `SearchRequested` instead of `AcquisitionExhausted` — the event contract itself is unchanged (both events already exist).
- The newly-consumed slskd search-state field (`responseCount`) enters the contract schema with a recorded fixture and replay test, per the contract tier's rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `candidate-search-and-ranking`: a source search yields candidates only once the source confirms completion; an unconfirmable or self-contradictory harvest is an infrastructure fault (retryable), never an empty candidate set.
- `acquisition-lifecycle`: an empty search round consumes search-round budget and triggers a bounded re-search; exhaustion requires the budget to be spent (today an empty round exhausts immediately).
- `source-resource-stewardship`: the "timed-out search is harvested and deleted" requirement is replaced — only a harvested (complete) search is deleted from the source; an abandoned in-progress search is left running with its ledger row live for the startup sweep.

(The `external-api-contracts` spec is unaffected at the requirement level — the newly-consumed `responseCount` field rides the existing fixture/recorder requirements; see Impact.)

## Impact

- `packages/downloader/src/adapters/slskd/search.ts` — completion-gated harvest, higher deadline, fault paths, no mid-flight delete.
- `packages/downloader/src/adapters/slskd/schemas.ts` — `responseCount` on the search-state schema.
- `packages/downloader/src/domain/acquisition/decide.ts` — empty-round branch consults the retry ladder (`selectNext`-style) instead of exhausting directly.
- `packages/downloader/test/contract` — new/updated recorded fixtures for the search-state shape; recorder script coverage.
- Specs: delta files for the four capabilities above.
- No API/facade surface changes; no new dependencies. The two production acquisitions remain Exhausted (terminal) and need re-requesting after deploy.
