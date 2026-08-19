## MODIFIED Requirements

### Requirement: Download submission and cancellation

The web UI SHALL let a user submit a download (target plus quality policy, matching the downloader facade's submit contract) and cancel a pending download. The request page SHALL be search-first: a single search box whose results — found via the catalog-search capability — are the things the user requests, replacing mode selection and hand-typed identifiers as the primary flow. Failures returned by the facade SHALL render as actionable messages, not crashes.

Search SHALL run as the user types, debounced, and immediately on Enter. Results SHALL present release groups, artists, and recordings in visually distinct layouts (artwork grid, artist row, compact track rows), ordered by the catalog-search read's intent ordering, with tabs to filter to a single entity type. Every requestable result SHALL carry an always-visible primary request action that submits with default policies in one interaction; affordances SHALL NOT be hover-revealed, and the page SHALL remain usable at narrow viewport widths.

Selecting a result SHALL open a detail surface where the user can dig in before requesting: for a release group, its editions grouped by tracklist with an on-demand tracklist view, the pipeline's best-match edition identified as the default alongside the option to pin a specific edition, and quality-policy options; for an artist, a discography to request from; for a recording, its detail and a track request. Pasting a MusicBrainz identifier into the search box SHALL resolve it directly to its entity.

Before the first keystroke the page SHALL show only the search box plus a short hint teaching search-as-you-type and the identifier paste path. A search with no matches SHALL name the query, offer a one-interaction switch to entity types that did match when the user has filtered, and restate the identifier escape hatch; a failed search SHALL be presented as a failure, never as "no matches". Without JavaScript the page SHALL degrade to a native form submission that can still create a download, including by artist and title alone and including the request policies the submit contract accepts.

#### Scenario: Search-as-you-type with instant Enter

- **WHEN** a user types at least two characters and pauses, or presses Enter at any point
- **THEN** results for the current query render (debounced on typing, immediately on Enter), grouped by entity type in the catalog-search read's intent order

#### Scenario: Successful submission

- **WHEN** a user submits a valid download form
- **THEN** the BFF dispatches the downloader facade's submit command in-process and the UI shows the new download with its identifier and current phase

#### Scenario: One-click request with defaults

- **WHEN** a user activates a result's primary request action
- **THEN** the BFF dispatches the downloader facade's submit command in-process with default policies and the UI confirms the new download with its identifier

#### Scenario: Dig-in request with a pinned edition

- **WHEN** a user opens a release group's detail surface, pins a specific edition from its tracklist-grouped editions, and requests
- **THEN** the submit command carries that edition choice and the UI confirms the new download

#### Scenario: The default edition is visible before requesting

- **WHEN** a user opens a release group's detail surface without pinning an edition
- **THEN** the edition the pipeline's selection policy would pick is identified as the default — or the surface states that no automatic pick exists and selection is required

#### Scenario: Entity filter and zero-result recovery

- **WHEN** a user filters to one entity type and the query matches none of that type but does match others
- **THEN** the page names the query, states which entity types matched, and offers a one-interaction switch to them

#### Scenario: Pasted identifier goes straight to the entity

- **WHEN** a user pastes a MusicBrainz identifier into the search box
- **THEN** the matching entity renders as the sole result, ready to request

#### Scenario: Pre-search state is minimal

- **WHEN** a user opens the request page before typing
- **THEN** the page shows the search box and a short hint (including the identifier paste path) and nothing else

#### Scenario: Search failure is not "no matches"

- **WHEN** the catalog-search read returns a modeled failure
- **THEN** the page presents a failure message distinct from the zero-results state

#### Scenario: Rejected submission renders the modeled error

- **WHEN** the facade returns a modeled validation or conflict error for a submission
- **THEN** the UI surfaces the failure's message and no download is created

#### Scenario: No-JS fallback still submits

- **WHEN** a user without JavaScript opens the request page
- **THEN** a native form submission can still create a download through the same facade contract

#### Scenario: Cancellation

- **WHEN** a user cancels a download that is still cancellable
- **THEN** the facade's cancel command is dispatched and the UI reflects the cancelled state
