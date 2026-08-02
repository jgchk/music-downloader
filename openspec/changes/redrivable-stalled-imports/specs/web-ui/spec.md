# web-ui — delta for redrivable-stalled-imports

## ADDED Requirements

### Requirement: A stalled import is visible and redrivable from the acquisition detail

The web UI SHALL render the import's decided stalled flag — rendered, never re-derived from
retry internals — as an attention state on the acquisition detail page: the overall status and
the in-progress row SHALL say, in the register, that adding to the library stopped and needs a
retry, never an indefinite progress phrase. The page SHALL offer a retry affordance in the
affordance register (imperative verb-led label, consequence stating the composed contract, no
parenthesized asides) that dispatches the facade's retry command; a modeled refusal (the import
settled or resumed meanwhile) SHALL render as the modeled action error. The stalled state SHALL
NOT present a spinner or progress animation. Diagnostic detail (the dead-lettered effect's error
text, where exposed) belongs in disclosure, not the visible line.

#### Scenario: A stalled import stops claiming progress

- **GIVEN** an acquisition whose import is exposed as stalled
- **WHEN** the user views the acquisition detail
- **THEN** the status and the now-row present an attention state saying the add stopped and
  needs a retry, with no progress animation and no indefinite "Adding to the library…" claim

#### Scenario: One click retries the stalled import

- **GIVEN** the acquisition detail of a stalled import
- **WHEN** the user activates the retry affordance
- **THEN** the facade's retry command is dispatched and the page reflects the resumed apply

#### Scenario: A stale retry renders the modeled error

- **GIVEN** a stalled import that resumed or settled after the page loaded
- **WHEN** the user activates the retry affordance
- **THEN** the facade's modeled refusal renders as the action error and the page's next load
  shows the import's true state

### Requirement: Stalled imports join the attention queue

The attention queue SHALL list every stalled import as an item whose ask names the decision
(retrying the import), titled by its musical intent where the acquisition correlation composes
and degrading through the established title fallbacks otherwise, linking to the acquisition
detail where the retry affordance lives. An item whose import carries no acquisition correlation
SHALL still be listed rather than dropped. The navigation's attention count SHALL include
stalled imports.

#### Scenario: A stalled import appears in the queue with an ask

- **GIVEN** an import exposed as stalled whose acquisition correlation composes
- **WHEN** the user opens the attention queue
- **THEN** the queue lists the item titled by the musical intent with an ask-oriented chip,
  linking to the acquisition detail

#### Scenario: Retrying clears the queue entry

- **GIVEN** a stalled import listed in the attention queue
- **WHEN** the user follows the link and retries, and the re-driven apply succeeds
- **THEN** the import no longer appears in the attention queue
