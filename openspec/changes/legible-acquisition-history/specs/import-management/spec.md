# import-management — delta for legible-acquisition-history

## ADDED Requirements

### Requirement: The import status read model exposes decided settledness

The import status read model SHALL additively expose `settled` — whether the import has reached a
terminal state — decided from the import domain's own terminality, so a consumer never re-derives
"is anything more coming?" by pattern-matching the phase enum (the decided-lifecycle-flags
pattern). A consumer reading an absent flag (an older producer) SHALL be able to degrade
conservatively to unsettled.

#### Scenario: A terminal import reports itself settled

- **WHEN** the status of an applied or rejected import is read
- **THEN** the view carries `settled: true`

#### Scenario: An in-flight import reports itself unsettled

- **WHEN** the status of an import that is matching, awaiting review, or applying is read
- **THEN** the view carries `settled: false`
