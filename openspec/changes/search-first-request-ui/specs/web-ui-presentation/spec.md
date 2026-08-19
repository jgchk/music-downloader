## ADDED Requirements

### Requirement: Catalog-search surface anatomy is structural once and themed per skin

The request page's search anatomy — the search field with its in-flight indicator, the entity filter control, the per-entity result presentations (an artwork grid for release groups, an artist row, compact track rows), the artwork frame with its no-art placeholder, and the detail surface (a side panel at wide viewports, a bottom sheet at narrow ones) with its edition groups and selected-edition state — SHALL be defined once at the semantic skeleton/token layer as meaning-based hooks and semantic tokens, alongside the existing timeline and decision-surface anatomies. Every shipped skin SHALL theme this anatomy deliberately, with no skin leaving it unstyled browser-default. Selection and the system's default edition SHALL never be signalled by color alone — the row's text SHALL carry the meaning on its own. The artwork slot SHALL reserve its space before an image loads, so results do not reflow as artwork arrives.

#### Scenario: Anatomy is shared, themes differ

- **WHEN** the active skin changes between shipped skins on the request page
- **THEN** the page's DOM is identical and only CSS differs, while each skin presents a
deliberately styled search field, filter control, per-entity result layouts, and detail surface

#### Scenario: Entity kinds are distinguishable without color

- **WHEN** results of more than one entity kind render together under any shipped skin
- **THEN** each kind is distinguishable by its layout and its labelled text, not by color alone

#### Scenario: The default edition is named, not merely highlighted

- **WHEN** the detail surface presents the edition the system would pick
- **THEN** that row states in its text that it is the default, with styling as reinforcement

#### Scenario: The detail surface follows the viewport

- **WHEN** the request page's detail surface opens at a narrow viewport
- **THEN** it presents as a bottom sheet rather than a side panel, with the same DOM
