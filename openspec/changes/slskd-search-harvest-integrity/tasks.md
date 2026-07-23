# Tasks — slskd-search-harvest-integrity

## 1. Domain: an empty round rides the retry ladder

- [ ] 1.1 Red: decider tests — `RecordSearchCompleted` with zero ranked candidates and rounds remaining emits `SearchRequested` (next round), not `AcquisitionExhausted`; including on the first round
- [ ] 1.2 Red: decider tests — zero ranked candidates with the search-round budget spent emits `AcquisitionExhausted`; existing rejection-driven ladder behavior unchanged
- [ ] 1.3 Green: route the empty-`ranked` branch of `RecordSearchCompleted` in `decide.ts` through the ladder choice (`selectNext` semantics against the post-round state)
- [ ] 1.4 State/evolve tests still hold: replaying existing streams is unchanged (no `evolve` edits); phase transitions for the new `SearchRequested` path covered

## 2. Adapter: completion-gated harvest and fault paths

- [ ] 2.1 Add `responseCount` (optional) to `slskdSearchStateSchema` with schema unit tests
- [ ] 2.2 Red: `SlskdSearch` test — deadline elapses while the search state is still incomplete → `InfraError` (kind `slskd.search`), carrying last observed state; no responses fetched, no delete issued
- [ ] 2.3 Red: `SlskdSearch` test — completed search whose state reports `responseCount > 0` but whose responses harvest is empty → `InfraError`; no delete issued
- [ ] 2.4 Red: `SlskdSearch` tests — completed search with `responseCount: 0` or absent `responseCount` and an empty harvest → `Ok([])`; completed search with responses → candidates mapped and search deleted, ledger row marked removed
- [ ] 2.5 Green: rework `awaitCompletion`/`doSearch` — poll until `isComplete`, fault on deadline, self-consistency guard, delete only on the harvest path; raise `DEFAULT_SEARCH_TIMEOUT_MS` to 60_000
- [ ] 2.6 Ledger behavior test: a faulted search leaves its ledger row live (recorded, never marked removed) so the startup sweep retires it; warn-level log carries the observed state

## 3. Contract tier: witness the newly-consumed field

- [ ] 3.1 Extend the slskd recorder script to capture a completed search's state snapshot (carrying `responseCount`) alongside the responses fixture, with provenance
- [ ] 3.2 Record the fixture against a real slskd and commit it sanitized
- [ ] 3.3 Contract replay test: the recorded search-state fixture parses through `slskdSearchStateSchema`; the search adapter's polling request/harvest sequence asserted over real HTTP against the fixture server
- [ ] 3.4 Update the consumed-surface manifest if the search-state operation's consumed shape is declared there

## 4. Verification and ship-readiness

- [ ] 4.1 Full gate green (`pnpm check`) with 100% merged coverage — no waivers added
- [ ] 4.2 Out-of-process E2E still green (`pnpm test:e2e`); confirm the e2e slskd path completes searches within the new deadline
- [ ] 4.3 Live verification on flight after deploy: re-request the two falsely-exhausted acquisitions (Nirosta Steel — MY SKYSCRAPER, Mort Garson — Mother Earth's Plantasia) and confirm they progress past search with candidates; confirm no new "Failed to execute/finalize search" pairs in slskd's log
- [ ] 4.4 Sync delta specs into `openspec/specs` and archive the change
