# source-resource-stewardship — delta

## MODIFIED Requirements

### Requirement: A search is deleted from the source once harvested

The system SHALL delete its search from the source only after harvesting a search the source has confirmed complete. A search the system abandons — because the polling deadline elapsed while the search was still in progress, or because the harvest was contradicted by the source's bookkeeping — SHALL NOT be deleted mid-flight (deleting a running search corrupts the source's own search task); it is left to finish on the source, and its live ledger entry is retired by the startup sweep. The ledger entry SHALL be marked removed on a successful deletion; a failed deletion SHALL leave the entry live for later convergence and SHALL NOT fail the search outcome.

#### Scenario: A completed search is deleted after harvest

- **WHEN** a search completes and its responses are collected
- **THEN** the search is deleted from the source and its ledger entry is marked removed

#### Scenario: An abandoned in-progress search is left for the sweep

- **GIVEN** a search still running on the source when the polling deadline elapses
- **WHEN** the system abandons the search with an infrastructure fault
- **THEN** no delete is issued against the running search
- **AND** its ledger entry stays live, so the startup sweep later removes the (by then finished) search from the source
