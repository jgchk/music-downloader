## MODIFIED Requirements

### Requirement: Catalog-search surface anatomy is structural once and themed per skin

The request page's search anatomy — the search field with its in-flight indicator, the entity filter control, the per-entity result presentations (an artwork grid for release groups, an artist row, compact track rows), the artwork frame with its no-art placeholder, and the detail view (a side panel at wide viewports, a bottom sheet at narrow ones) with its edition groups and selected-edition state — SHALL be defined once at the semantic skeleton/token layer as meaning-based hooks and semantic tokens, alongside the existing timeline and decision-surface anatomies. Every shipped skin SHALL theme this anatomy deliberately, with no skin leaving it unstyled browser-default. Selection and the system's default edition SHALL never be signalled by color alone — the row's text SHALL carry the meaning on its own. The artwork slot SHALL reserve its space before an image loads, so results do not reflow as artwork arrives.

Widget-button chrome SHALL be opt-in. A button element not marked as a push button carries no widget styling — no imposed alignment, wrapping, type size, or decoration — from the base layer or from any skin, so an interactive surface (a result card, a track row, an edition row) or an inline link-styled action presents as the surface or link it is, themed deliberately by each skin in its own idiom. No skin may attach widget chrome to unmarked button elements. An image that fails to load SHALL never present the browser's broken-image indicator — the reserved placeholder is what shows. The detail view's artwork slot SHALL carry the same no-art placeholder treatment as the result grids. The detail view's side-panel width SHALL stay within a readable band under every shipped skin's type scale — wide enough for an edition's summary line, never collapsing below the anatomy's floor however small a skin's root type is, and never taking more than its allowed share of the window however wide a skin asks it to be.

#### Scenario: Anatomy is shared, themes differ

- **WHEN** the active skin changes between shipped skins on the request page
- **THEN** the page's DOM is identical and only CSS differs, while each skin presents a
deliberately styled search field, filter control, per-entity result layouts, and detail view

#### Scenario: Entity kinds are distinguishable without color

- **WHEN** results of more than one entity kind render together under any shipped skin
- **THEN** each kind is distinguishable by its layout and its labelled text, not by color alone

#### Scenario: The default edition is named, not merely highlighted

- **WHEN** the detail view presents the edition the system would pick
- **THEN** that row states in its text that it is the default, with styling as reinforcement

#### Scenario: The detail surface follows the viewport

- **WHEN** the request page's detail view opens at a narrow viewport
- **THEN** it presents as a bottom sheet rather than a side panel, with the same DOM

#### Scenario: The artwork slot reserves its footprint

- **WHEN** a result card renders before (or without) its cover image arriving, under any shipped skin
- **THEN** the artwork slot occupies its full reserved square with the placeholder visible — never a collapsed box

#### Scenario: A result card is a surface, not a widget button

- **WHEN** a result card, track row, or edition row renders under any shipped skin
- **THEN** it carries no widget-button chrome, its text lays out as the surface's own (titles clipped within their card, track rows reading horizontally), and its type size is the surface's, not the button control's

#### Scenario: A link-affordance reads as a link

- **WHEN** an inline link-styled action renders (a zero-result kind switch, a tracklist disclosure) under any shipped skin
- **THEN** it presents as a link in that skin's idiom, not as a raised button

#### Scenario: A failed image shows the placeholder, not the broken-image glyph

- **WHEN** an artwork request fails outright
- **THEN** the slot shows the placeholder alone, with no browser broken-image indicator

#### Scenario: A skin cannot re-chrome surfaces through bare buttons

- **WHEN** any shipped skin's stylesheet is applied
- **THEN** widget chrome reaches only buttons marked as push buttons — surfaces and link-affordances remain chrome-free under it

#### Scenario: The detail view stays readable under every type scale

- **WHEN** the detail view opens as a side panel under each shipped skin
- **THEN** its width lands within the anatomy's readable band — at least its floor, and never more than the share of the window it is allowed
