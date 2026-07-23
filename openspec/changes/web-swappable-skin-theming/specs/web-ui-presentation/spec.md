## ADDED Requirements

### Requirement: Semantic landmark skeleton

The web UI SHALL wrap every page in an app shell that emits a landmark skeleton — a `banner` header, a labelled primary `navigation`, exactly one `main` region, and a `contentinfo` footer — in reading order, with page content rendered inside `main`. Heading levels SHALL be author-set with one top-level heading per page; the skeleton SHALL NOT rely on any sectioning-implied heading level.

#### Scenario: Every page exposes the landmark set

- **WHEN** any route is served
- **THEN** the response exposes exactly one `banner`, one labelled `navigation`, one `main`, and one `contentinfo`, in that source order

#### Scenario: One main and one page heading

- **WHEN** a page renders
- **THEN** there is exactly one `main` landmark and the page's primary heading is a single top-level `h1` within it

### Requirement: Presentation is CSS-only over a semantic token layer

All visual styling and layout SHALL be delivered by global CSS that reads a semantic design-token layer; components SHALL carry no utility or visual class names that encode theme or layout. Changing the active skin SHALL require no change to any component's markup.

#### Scenario: Components use meaning-based hooks only

- **WHEN** a component is authored
- **THEN** its markup uses semantic elements and meaning-based hooks (roles, `data-*` state/variant attributes, content-role class names) only, and contains no utility or visual class that bakes in color, spacing, or layout

#### Scenario: Restyle needs no markup change

- **WHEN** the active skin changes
- **THEN** the rendered DOM is identical across skins and only CSS differs

### Requirement: A skin swaps theme and layout together

A skin SHALL be selected by the `data-skin` attribute on the document root and SHALL remap both the semantic token layer AND the shell's layout tokens (region placement and navigation orientation). Switching skins SHALL restyle and re-lay-out the entire application — including relocating primary navigation (for example, a top bar versus a side rail) — with no DOM change.

#### Scenario: Same DOM, different theme and layout

- **WHEN** `data-skin` changes from one shipped skin to another
- **THEN** colour, type, spacing, and the region layout (including navigation orientation) all change while the DOM is unchanged

#### Scenario: Layout is token-driven, not markup-driven

- **WHEN** a skin defines the shell layout tokens
- **THEN** region placement follows the skin's `grid-template-areas` tokens rather than element source order or any markup change

### Requirement: Shipped skins and default

The product SHALL ship at least the `forum`, `glass`, and `terminal` skins and SHALL render with `forum` as the server-rendered default when no user preference is set. Each shipped skin SHALL style the entire application with no unstyled or unthemed regions.

#### Scenario: Default skin is server-rendered

- **WHEN** a page is served with no stored skin preference
- **THEN** the document root carries `data-skin="forum"` in the server response

#### Scenario: Each shipped skin renders the whole app

- **WHEN** any shipped skin is the active skin
- **THEN** every page region and control is fully styled with no unstyled or unthemed area

### Requirement: User-facing, persisted skin switch without a flash

The web UI SHALL provide a control that lets a user choose the active skin; the choice SHALL persist across visits; and the initial paint SHALL use the resolved skin without a flash of a different skin. The switch SHALL be a progressive enhancement: with scripting disabled, the server-rendered default skin SHALL still apply and the page SHALL remain usable.

#### Scenario: Switching applies immediately and persists

- **WHEN** a user selects a different skin
- **THEN** the application re-skins at once and the chosen skin is used again on the user's next visit

#### Scenario: No flash of the wrong skin on load

- **WHEN** a page loads for a user with a stored skin preference
- **THEN** the first paint already reflects that stored skin

#### Scenario: Degrades without scripting

- **WHEN** scripting is disabled
- **THEN** the server-rendered default skin applies and every page and action remains usable

### Requirement: Accessible under every skin

Regardless of the active skin, DOM source order SHALL match the meaningful reading and keyboard-focus order (WCAG 1.3.2 Meaningful Sequence); no skin SHALL use CSS to reorder content whose sequence is meaningful. With all CSS disabled, every page SHALL remain a correctly-ordered, operable document with its landmarks and headings intact. Keyboard focus SHALL be visibly indicated under every skin.

#### Scenario: Tab order matches reading order in every skin

- **WHEN** a user tabs through a page under any shipped skin
- **THEN** focus moves in the page's meaningful reading order and never jumps by a visual position produced only by CSS reordering

#### Scenario: A sensible document with CSS disabled

- **WHEN** all stylesheets are disabled for any page
- **THEN** the page reads top-to-bottom in a correct order, its landmarks and headings are intact, and every action is reachable

#### Scenario: Focus is always visible

- **WHEN** a control receives keyboard focus under any shipped skin
- **THEN** a visible focus indicator is shown
