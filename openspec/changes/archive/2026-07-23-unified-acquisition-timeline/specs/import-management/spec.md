## ADDED Requirements

### Requirement: An import is retrievable by its originating acquisition id

The importer's reads SHALL expose an import by the acquisition id it was submitted from, returning the same import status view as a lookup by import id, or a modeled not-found when no import exists for that acquisition. The import status view SHALL carry its originating acquisition id when the import arrived from an acquisition, so a consumer holding only an acquisition id can retrieve and identify the corresponding import without knowing the importer's own content-addressed id. This lookup SHALL be served from the reverse index the intake seam already maintains and SHALL NOT require scanning all imports.

#### Scenario: Lookup by acquisition id returns the corresponding import

- **GIVEN** an acquisition that was handed off and submitted as an import
- **WHEN** the import is read by that acquisition id
- **THEN** the same import status view is returned, carrying that acquisition id

#### Scenario: Lookup for an acquisition with no import is a modeled not-found

- **WHEN** an import is read by an acquisition id that has no submitted import
- **THEN** the read returns the modeled not-found value, not an error or a crash

### Requirement: Import history entries carry their occurrence time

Each entry of the import status view's history SHALL carry the occurrence time of the event it projects, sourced from the timestamp already stamped on that stored event, so a consumer can order the import's history against another context's history in real time.

#### Scenario: Each history entry reports when it happened

- **WHEN** an import's history is read
- **THEN** every entry carries the ISO-8601 occurrence time of its underlying event
