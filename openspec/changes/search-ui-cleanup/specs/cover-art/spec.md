## MODIFIED Requirements

### Requirement: Missing art is an expected outcome

A release group or release without cover art SHALL be a modeled, expected outcome — the endpoint answers with a cacheable "no cover" response and the UI renders a placeholder — never an error surfaced to the user. An upstream failure (timeout, refusal) SHALL be distinguished from confirmed absence and SHALL NOT be cached as absence.

An unreachable archive SHALL be remembered as unavailability for a short interval — much shorter than the absence lifetime, and never promoted to absence — so that a page of artwork slots fails fast instead of each slot independently waiting out the full upstream deadline. Once the interval passes, lookups reach the archive again and art that exists is found.

#### Scenario: No cover yields a placeholder

- **WHEN** the UI displays a release group for which the Cover Art Archive has no front cover
- **THEN** a placeholder is rendered in the artwork slot and no error is shown

#### Scenario: Upstream failure is not recorded as absence

- **WHEN** the Cover Art Archive cannot be reached for a lookup
- **THEN** the miss is not cached as "no cover", so a later request may still find the art

#### Scenario: An unreachable archive fails fast for its neighbors

- **WHEN** one artwork lookup has just found the archive unreachable and a second arrives within the unavailability interval
- **THEN** the second is answered as unavailable without waiting out another upstream deadline

#### Scenario: Unavailability expires on its own

- **WHEN** the unavailability interval has passed since the archive was last found unreachable
- **THEN** the next lookup goes upstream, and art that exists is served
