## MODIFIED Requirements

### Requirement: Download submission and cancellation

The web UI SHALL let a user submit a download (target plus quality policy, matching the downloader facade's submit contract) and cancel a pending download. The request page SHALL be search-first: a single search box whose results — found via the catalog-search capability — are the things the user requests, replacing mode selection and hand-typed identifiers as the primary flow. Failures returned by the facade SHALL render as actionable messages, not crashes.

Search SHALL run as the user types, debounced, and immediately on Enter, with the search box focused on arrival. Results SHALL present release groups, artists, and recordings in visually distinct layouts (artwork grid, artist row, compact track rows), ordered by the catalog-search read's intent ordering, with tabs to filter to a single entity type. The mixed view SHALL present each kind's top results — the leading slice of its ranking, sized for a person scanning — while a kind's filter tab presents all of that kind's results; a trimmed section's heading SHALL state the trim ("10 of 25") as a one-interaction way to that kind's full results. Every requestable result SHALL carry an always-visible primary request action that submits with default policies in one interaction; affordances SHALL NOT be hover-revealed, and the page SHALL remain usable at narrow viewport widths.

Selecting a release group or recording SHALL open a detail view where the user can dig in before requesting. The detail view SHALL name what it presents beyond the bare title: for a release group, its artist credit, year, and type where the catalog states them, and its MusicBrainz identifier; for a recording, its artist credit, the release it appears on, and that release's artwork. A release group's detail view SHALL present its editions grouped by tracklist with an on-demand tracklist view, a format filter that narrows the editions and regroups what remains, quality-policy options, and an always-visible best-match summary stating the pipeline's pick and its distinguishing details — or that no automatic pick exists — visible regardless of which edition groups are expanded and regardless of the format filter, with the group containing the pick opened. The user MAY designate a chosen edition, making the request target that exact pressing; the best-match summary is itself the control for letting the system choose, clearing any chosen edition.

The detail view SHALL behave as the non-modal panel it is: the page behind it stays interactive and unobscured, Escape closes it from anywhere on the page, activating anything outside it closes it, a visible close control is always present, and on close focus returns to the result it was opened from.

Selecting an artist SHALL open the artist discography view: the results area presents that artist's release groups in the same artwork-grid presentation search results use, headed by the artist's name, with a one-interaction way back to the held search results that does not repeat the search. Typing a new query leaves the discography view, and activating an entity filter tab returns to the held results with that filter applied. Each discography entry SHALL carry the primary request action and SHALL open the standard release-group detail view.

Pasting a MusicBrainz identifier into the search box SHALL resolve it directly to its entity, presented with the same display fields a searched result carries.

A request submitted from a search result, a discography entry, or the detail view SHALL confirm on the request page itself — at the form that submitted it, naming the new download's identifier with a way to open it — leaving the query, its results, and any in-progress browsing intact, so several downloads can be requested from one search. While a request is in flight, only the form that submitted it SHALL be busy; other results' request actions stay live. The no-JS fallback form keeps its full-page round trip.

Before the first keystroke the page SHALL show only the search box plus a short hint teaching search-as-you-type and the identifier paste path, including a pasteable example identifier. A search with no matches SHALL name the query, offer a one-interaction switch to entity types that did match when the user has filtered, and restate the identifier escape hatch; a failed search SHALL be presented as a failure, never as "no matches" — a failure that may pass (the catalog could not be reached) SHALL name the catalog and the retry path, while one that will not (the catalog's answer could not be read) SHALL be worded as this application's fault, not the user's or the network's. Without JavaScript the page SHALL degrade to a native form submission that can still create a download, including by artist and title alone and including the request policies the submit contract accepts.

#### Scenario: Search-as-you-type with instant Enter

- **WHEN** a user types at least two characters and pauses, or presses Enter at any point
- **THEN** results for the current query render (debounced on typing, immediately on Enter), grouped by entity type in the catalog-search read's intent order

#### Scenario: The mixed view shows top results with an honest count

- **WHEN** a search matches more results of a kind than the mixed view presents
- **THEN** the mixed view lists that kind's top results, its heading states the trim as "shown of matched", and activating the stated count presents all of that kind's results

#### Scenario: A kind's tab shows everything

- **WHEN** a user filters to one entity kind
- **THEN** every fetched result of that kind renders, not only the mixed view's slice

#### Scenario: Successful submission

- **WHEN** a user submits a valid download form
- **THEN** the BFF dispatches the downloader facade's submit command in-process and the UI shows the new download with its identifier and current phase

#### Scenario: One-click request with defaults

- **WHEN** a user activates a result's primary request action
- **THEN** the BFF dispatches the downloader facade's submit command in-process with default policies and the UI confirms the new download with its identifier

#### Scenario: Requesting keeps the search

- **WHEN** a user requests a download from a search result and the submission succeeds
- **THEN** the confirmation renders at the form that submitted it, naming the new download's identifier with a way to open it, and the query, its results, and any open detail view remain as they were

#### Scenario: Only the submitted form goes busy

- **WHEN** a request from one result is in flight
- **THEN** that form alone is disabled against a second submission while the other results' request actions remain usable

#### Scenario: Dig-in request with a pinned edition

- **WHEN** a user opens a release group's detail view, designates a chosen edition from its tracklist-grouped editions, and requests
- **THEN** the submit command carries that edition choice and the UI confirms the new download

#### Scenario: The default edition is visible before requesting

- **WHEN** a user opens a release group's detail view
- **THEN** the pipeline's pick is presented as an always-visible summary stating its distinguishing details — even when the edition group containing it is collapsed and under any format filter — or the view states that no automatic pick exists and selection is required; activating the summary clears any chosen edition, letting the system choose

#### Scenario: The detail view names its subject

- **WHEN** a user opens a release group's detail view
- **THEN** it presents the artist credit, year, and type the catalog states, and the release group's MusicBrainz identifier

#### Scenario: Editions filter by format

- **WHEN** a user narrows the detail view's editions to one format category
- **THEN** only editions of that category present, regrouped with truthful group counts, the best-match summary stays visible, and clearing the filter restores the full grouped listing

#### Scenario: A track's detail view carries its context

- **WHEN** a user opens a recording's detail view
- **THEN** it presents the recording's artist credit, the release it appears on, and that release's artwork slot, alongside the track request

#### Scenario: The artist discography view takes over in place

- **WHEN** a user selects an artist result
- **THEN** the results area presents that artist's discography as the artwork grid, headed by the artist's name, and a single interaction returns to the held search results without re-searching

#### Scenario: A discography entry digs in like any album

- **WHEN** a user opens a release group from the artist discography view
- **THEN** the standard release-group detail view opens with its editions, best-match summary, and request actions

#### Scenario: Leaving the discography view

- **WHEN** a user types a new query, or activates an entity filter tab, while the artist discography view is open
- **THEN** typing searches anew, and the tab returns to the held results with that filter applied — neither leaves a stale discography on screen

#### Scenario: The detail view dismisses like a panel, not a modal

- **WHEN** a detail view is open and the user presses Escape with focus anywhere on the page, or activates anything outside the view
- **THEN** the view closes, focus returns to the result it was opened from, and the results are as they were

#### Scenario: Entity filter and zero-result recovery

- **WHEN** a user filters to one entity type and the query matches none of that type but does match others
- **THEN** the page names the query, states which entity types matched, and offers a one-interaction switch to them

#### Scenario: Pasted identifier goes straight to the entity

- **WHEN** a user pastes a MusicBrainz identifier into the search box
- **THEN** the matching entity renders as the sole result, ready to request

#### Scenario: Pre-search state is minimal

- **WHEN** a user opens the request page before typing
- **THEN** the page shows the search box and a short hint (including the identifier paste path with a pasteable example identifier) and nothing else

#### Scenario: Search failure is not "no matches"

- **WHEN** the catalog-search read returns a modeled failure
- **THEN** the page presents a failure message distinct from the zero-results state

#### Scenario: An unreachable catalog names the retry path

- **WHEN** a search fails because the catalog could not be reached
- **THEN** the message names the catalog and advises the retry (pause, or press Enter to try again)

#### Scenario: A drifted catalog is not blamed on the user

- **WHEN** a search fails because the catalog's answer could not be read
- **THEN** the message states this application went wrong — never advice to check the connection or retype the query

#### Scenario: Rejected submission renders the modeled error

- **WHEN** the facade returns a modeled validation or conflict error for a submission
- **THEN** the UI surfaces the failure's message and no download is created

#### Scenario: No-JS fallback still submits

- **WHEN** a user without JavaScript opens the request page
- **THEN** a native form submission can still create a download through the same facade contract

#### Scenario: Cancellation

- **WHEN** a user cancels a download that is still cancellable
- **THEN** the facade's cancel command is dispatched and the UI reflects the cancelled state
