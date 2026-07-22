## 1. Resolution outcome & candidate mapping

- [x] 1.1 Write failing tests for the `EditionCandidate` value and the additive `{ kind: 'needsSelection'; candidates }` variant of `MetadataResolution`; ensure existing `resolved`/`unresolved` consumers still typecheck.
- [x] 1.2 Add `EditionCandidate` (domain value carried on events) and the `needsSelection` variant to the ports/domain.
- [x] 1.3 Write a failing adapter test: a release group with no official edition returns `needsSelection` with the candidate editions (id, title, date, country, format, track count); implement the mapping from picker output to `EditionCandidate[]` (replacing the prerequisite change's unresolved behavior).
- [x] 1.4 Extend the release-search/browse schema additively with `country` and `media[].format` for candidate presentation; failing schema tests first.

## 2. Aggregate state & commands

- [x] 2.1 Write failing decide/evolve tests: a `needsSelection` resolution produces `ManualSelectionRequested { candidates }`; state folds to `AwaitingManualSelection` retaining candidates; no search/download effects while awaiting.
- [x] 2.2 Add the `ManualSelectionRequested` event, the record command, and the `AwaitingManualSelection` phase in decide/evolve.
- [x] 2.3 Write failing tests for `SelectEdition { releaseMbid }`: valid only in `AwaitingManualSelection`; a known candidate resolves that release (reusing the direct path) → `TargetResolved` and normal flow; unknown candidate or wrong-state is a modeled error with no state change.
- [x] 2.4 Implement `SelectEdition`, its validation, and the resume effect; wire `react` to continue to search.
- [x] 2.5 Write failing tests that cancelling while awaiting selection follows the existing cancel path; adjust decide/evolve.

## 3. Application wiring

- [x] 3.1 Write a failing interpreter test: `needsSelection` maps to `ManualSelectionRequested`; implement the third-outcome branch in `interpreter.ts`.
- [x] 3.2 Write a failing test for the select-edition effect path (resolving the chosen release id) and wire it through the interpreter/command handler.

## 4. Interfaces & UI

- [ ] 4.1 Write a failing test for a read model exposing awaiting-selection acquisitions with their candidate editions; implement it.
- [ ] 4.2 Write a failing test for the select-edition command on the facade / HTTP surface (and MCP if in scope); implement additively, returning the modeled rejection for stale/unknown selections.
- [ ] 4.3 Write failing UI tests and implement the awaiting-selection surface (candidate list + choose action, modeled error on stale selection).

## 5. Contract tests & the gate

- [ ] 5.1 Extend contract tests for the additive select-edition command and the `needsSelection` outcome (no breaking change).
- [ ] 5.2 Ensure every scenario in the `metadata-resolution`, `acquisition-lifecycle`, and `web-ui` deltas is covered by a test.
- [ ] 5.3 Run `pnpm check` and `openspec validate manual-edition-selection --strict`; fix gaps.
- [ ] 5.4 Manually verify end-to-end: a release-group MBID with no official edition pauses, and a manual choice resumes to import.
