# acquisition-lifecycle — delta

## MODIFIED Requirements

### Requirement: An acquisition is exhausted when options and budget run out

The system SHALL mark an acquisition as exhausted only when the working set is empty and the retry policy budget is spent — no search rounds remain, or the total-attempt budget is consumed. A search round that yields no usable candidates SHALL NOT by itself exhaust the acquisition while search rounds remain: it spends its round and triggers a fresh search round, including when it is the first round.

#### Scenario: An empty first round triggers a re-search, not exhaustion

- **GIVEN** a newly-started acquisition whose first search round yields zero usable candidates and a retry policy with rounds remaining
- **WHEN** the round's results are recorded
- **THEN** the system requests a fresh search round rather than exhausting the acquisition

#### Scenario: Search-round budget spent on empty rounds

- **GIVEN** an acquisition whose every search round up to the retry policy's maximum has yielded no usable candidates
- **WHEN** the final round's empty results are recorded
- **THEN** the acquisition reaches a terminal exhausted state

#### Scenario: Retry budget spent

- **GIVEN** an acquisition that has reached its maximum search rounds
- **WHEN** the working set empties again
- **THEN** the acquisition reaches a terminal exhausted state
