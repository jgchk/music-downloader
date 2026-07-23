## ADDED Requirements

### Requirement: Acquisition detail presents the full download-through-import lifecycle

The web UI's acquisition detail SHALL present the acquisition's complete history spanning both bounded contexts — the downloader's steps and, once the acquisition has been handed off, the importer's steps — as a single timeline ordered by occurrence time, with each entry attributed to its originating module. The timeline SHALL be composed by the web layer from the downloader and importer facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts (the same principle as the attention queue). When the importer read fails or no import exists yet for the acquisition, the detail SHALL render the downloader's timeline alongside a modeled, non-failing indication that the import has not started or is momentarily unavailable, never a page-level failure. The correlation between an acquisition and its import SHALL be the acquisition id.

#### Scenario: A fulfilled, imported acquisition shows both contexts as one timeline

- **GIVEN** an acquisition that was handed off to the importer and applied into the library
- **WHEN** a user opens that acquisition's detail
- **THEN** the timeline shows the downloader steps followed by the importer steps (matching, any review and its resolution, applied) in occurrence order, each entry attributed to its module

#### Scenario: An import rejection and its retry interleave correctly

- **GIVEN** an acquisition whose import was rejected-and-retried, reviving it for another download and import round
- **WHEN** a user opens that acquisition's detail
- **THEN** the timeline interleaves the importer rejection, the downloader's revived attempt, and the subsequent import strictly in occurrence order rather than as two disjoint blocks

#### Scenario: The import section degrades independently

- **WHEN** the importer read fails or no import exists yet for an acquisition
- **THEN** the downloader timeline still renders, accompanied by a modeled "import not started or unavailable" indication, and the page does not fail

#### Scenario: Hand-off and library import are not conflated

- **WHEN** the timeline renders the downloader's hand-off and the importer's applied outcome
- **THEN** the hand-off entry reads as staged/handed off to the importer and the applied entry reads as imported into the library, each naming its own distinct location
