# candidate-search-and-ranking — delta

## ADDED Requirements

### Requirement: A search is harvested only once the source confirms it complete

The system SHALL treat a source search's responses as harvestable only after the source reports the search complete. A search that cannot be confirmed complete within the adapter's polling deadline SHALL surface as a retryable infrastructure fault carrying the last observed search state, never as an empty candidate set. The polling deadline SHALL comfortably exceed the source's own default search duration, so the fault path is the exception rather than the routine outcome.

#### Scenario: Deadline elapses while the search is still in progress

- **GIVEN** a created source search that the source still reports as in progress
- **WHEN** the adapter's polling deadline elapses
- **THEN** the search port yields an infrastructure fault (retryable), not a completed empty result
- **AND** no `SearchCompleted` business fact is recorded from that attempt

#### Scenario: A confirmed-complete search with no responses is a valid empty result

- **GIVEN** a search the source reports complete with zero responses received
- **WHEN** the adapter harvests it
- **THEN** the search port yields an empty candidate set as a valid business outcome

### Requirement: A harvest contradicted by the source's own bookkeeping is a fault

The system SHALL compare the harvested responses against the response count the source reports for the search; a harvest that returns no responses while the source reports one or more responses received SHALL surface as a retryable infrastructure fault, not as an empty candidate set. When the source does not report a response count, the harvest SHALL be accepted as-is (tolerant reader).

#### Scenario: Source reports responses but the harvest is empty

- **GIVEN** a search the source reports complete with a positive response count
- **WHEN** the responses endpoint yields zero responses
- **THEN** the search port yields an infrastructure fault (retryable), not an empty candidate set

#### Scenario: Absent response count does not block the harvest

- **GIVEN** a search state that omits the response count
- **WHEN** the adapter harvests the completed search
- **THEN** the harvested responses are accepted and mapped to candidates
