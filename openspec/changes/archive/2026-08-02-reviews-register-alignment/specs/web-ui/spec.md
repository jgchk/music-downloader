# web-ui — delta for reviews-register-alignment

## MODIFIED Requirements

### Requirement: Import review resolution

The web UI SHALL let the user resolve a pending import review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool. Pending reviews SHALL be listed by the attention queue (see "The attention queue unifies work awaiting a human") rather than by an importer-only listing.

**Titling.** The review detail page SHALL be titled by the musical intent — the request phrase of the acquisition the import arrived from, the same identity the acquisition detail page renders for the same story — composed by the web layer from existing facade reads without any new cross-module contract. When the import carries no acquisition correlation, or a composing read fails, the title SHALL degrade to the staged directory's basename, then to a neutral awaiting-review phrase. The staged path SHALL render as labeled supporting detail, never as the title.

**Resolution affordances.** Resolution actions SHALL be labeled as imperative, verb-led, sentence-case fragments; an action's label SHALL name its object where the verb alone is ambiguous, and a destructive action SHALL name what it deletes. Consequence copy SHALL follow the label after an em-dash or sit in adjacent supporting text, and SHALL NOT be a parenthesized aside. Consequence copy SHALL state the composed system's actual contract: deterministic outcomes are stated plainly — rejecting a delivery as unusable resumes the search for a replacement; a plain rejection ends the story with nothing more tried — and hedged wording is reserved for genuine nondeterminism. An affordance that opens further input rather than committing SHALL carry a trailing ellipsis. The narration register's ban on internal vocabulary applies to affordance copy in full.

**Destructive confirmation.** The file-deleting resolutions SHALL render with low-emphasis destructive styling, SHALL never be the page's visually primary action, and SHALL commit only through an in-page confirmation step that restates the specific consequence and offers exactly two outcome-named choices — one that performs the deletion and one that declines it, each named by its outcome, never a bare yes/no. The confirmation SHALL function without client-side scripting and SHALL NOT use a browser dialog. Non-destructive resolutions SHALL NOT acquire a confirmation step.

**Match evidence.** For a match-review, the web UI SHALL present the candidate's **actual differences** as the primary content, not distance scores. It SHALL show a headline comparing the intended release (the submission hint, when present) with the candidate's identity; an album-field diff; and a per-track diff that marks retagged tracks, downloaded files matching no track, and candidate tracks no file supplies. The per-track diff SHALL de-emphasize unchanged rows and SHALL mark changed values with a word-level highlight and an explicit direction cue, so near-identical strings are distinguishable at a glance. Headline match quality SHALL be coarse and higher-is-better — a category word and/or rounded whole-number percentage — never a raw distance, a float, or a lower-is-better figure anywhere in visible text. Penalty reasons SHALL be visible in plain language; penalty amounts, raw distance, source identifiers, and release ids SHALL sit behind a single per-candidate disclosure whose summary names what it reveals. When a review lacks field-level differences (recorded before they were captured), the UI SHALL fall back to the score presentation — glossed in the same register — without error.

**Source-agnostic copy.** Visible review copy SHALL NOT name internal tooling. Absence-of-candidates copy SHALL speak source-agnostically of the connected metadata sources rather than glossing the matcher as any single source; a concrete candidate MAY truthfully name its own data source. The ID-entry action SHALL be labeled as accepting a release id from any connected source.

The web UI SHALL word the hint outcome truthfully: it SHALL state that the pinned release was not the best match only when the best candidate's release id differs from the pinned id, and otherwise (the best candidate is the pinned release) SHALL state that the pinned release matched but confidence was low.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the attention queue

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

#### Scenario: The review is titled by what the user asked for

- **GIVEN** a pending review whose import arrived from an acquisition
- **WHEN** the user opens the review
- **THEN** the page is titled by the acquisition's request phrase — the same identity the acquisition detail page shows — and the staged path appears only as labeled supporting detail

#### Scenario: The title degrades without an acquisition correlation

- **GIVEN** a pending review whose import carries no acquisition correlation
- **WHEN** the user opens the review
- **THEN** the page is titled by the staged directory's basename, and by a neutral awaiting-review phrase if no path is available

#### Scenario: A destructive resolution confirms in-page with outcome-named choices

- **GIVEN** a review offering a file-deleting resolution
- **WHEN** the user submits that resolution
- **THEN** the page re-renders an in-page confirmation restating the specific consequence with exactly two outcome-named choices, no files are deleted until the deleting choice is submitted, and declining returns to the review unchanged

#### Scenario: Consequence copy states the composed contract

- **GIVEN** a review offering both the unusable-delivery rejection and the plain rejection
- **WHEN** the user views the resolution actions
- **THEN** the unusable-delivery rejection's copy states that the search for a replacement continues, the plain rejection's copy states that nothing more will be tried, and neither consequence is a parenthesized aside

#### Scenario: The review page shows what differs, not just how much

- **GIVEN** a match-review whose candidate retags a track, leaves a downloaded file unmatched, and is missing a track
- **WHEN** the user opens the review
- **THEN** the page shows the intended-vs-candidate headline, the album-field diff, and a per-track diff marking the retag with a word-level highlight and direction cue, the extra file, and the missing track
- **AND** unchanged track rows render de-emphasized

#### Scenario: Match quality is coarse and higher-is-better

- **GIVEN** a match-review with candidates
- **WHEN** the user views a candidate's headline
- **THEN** match quality renders as a category word and/or rounded whole-number percentage where higher means better, and the raw distance, penalty amounts, source identifier, and release id are reachable only through the candidate's disclosure

#### Scenario: No tool names in visible copy

- **GIVEN** a review with no candidates at all
- **WHEN** the user opens the review
- **THEN** the absence is explained source-agnostically in terms of the connected metadata sources, and no internal tool name appears in visible text

#### Scenario: A pinned release that merely scored low is not called contradicted

- **GIVEN** a match-review reached with a pinned release id whose best candidate is that same release
- **WHEN** the user opens the review
- **THEN** the page states the pinned release matched but confidence was low, not that the hint was contradicted

#### Scenario: A legacy review still renders

- **GIVEN** a match-review recorded before field-level differences were captured
- **WHEN** the user opens the review
- **THEN** the page renders the score/penalty view glossed in the register and the resolution actions, without error

#### Scenario: Picking a candidate and entering an id are the two match actions

- **GIVEN** a match-review with candidates
- **WHEN** the user views the resolution actions
- **THEN** they can apply one of the listed candidates or enter a release id (labeled as accepting a release id from any connected source) to re-propose

### Requirement: The attention queue unifies work awaiting a human

The web UI SHALL present a single attention queue that lists every item across modules currently waiting on a human decision — at minimum the importer's pending match reviews and the downloader's acquisitions awaiting manual edition selection — as one list ordered longest-waiting first. Each item SHALL name **the ask** — the decision waiting on the user — in plain, action-oriented language, SHALL be titled by its musical intent where the correlation is available (degrading as the review titling requirement specifies), and SHALL link to the surface where the decision is made. Visible queue text SHALL NOT name the owning module or any architecture noun; a machine-readable module attribute MAY remain on the row for styling and tests. The queue SHALL be composed by the web layer from the module facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts. When one module's read fails, the queue SHALL render the other module's items alongside a modeled error for the failed section, not fail as a whole. Any capability that adds a new human-decision pause SHALL surface its pending items in this queue.

#### Scenario: Items from both modules appear as one queue

- **GIVEN** a pending import review and an acquisition awaiting manual edition selection
- **WHEN** the user opens the attention queue
- **THEN** both items appear in one list, longest-waiting first, each naming the decision asked of the user in action-oriented language and linking to its resolution surface

#### Scenario: The queue never names the machinery

- **GIVEN** attention items originating from both modules
- **WHEN** the user reads the queue
- **THEN** no visible text names a module or architecture noun, while each row still carries its machine-readable module attribute

#### Scenario: Resolving an item removes it from the queue

- **GIVEN** an attention queue showing an awaiting-selection acquisition
- **WHEN** the user follows its link and selects an edition
- **THEN** the acquisition proceeds and no longer appears in the attention queue

#### Scenario: One module failing does not empty the queue

- **GIVEN** one module's facade read fails
- **WHEN** the user opens the attention queue
- **THEN** the other module's items are listed and the failed section renders a modeled error message

### Requirement: Timeline copy follows a single register

All user-visible copy — the acquisition detail, the attention queue, the review surface, and any surface added later — SHALL follow one register. Completed timeline entries render as past-tense, verb-led fragments in sentence case without trailing periods; the in-progress entry in present progressive; no first-person voice; "you/your" only for user-initiated facts. Imperative affordances follow the affordance rules (verb-led sentence-case labels, object-naming destructive verbs, em-dash consequences, no parenthesized asides). Visible text SHALL contain no internal vocabulary — no enum identifiers, no architecture nouns, no internal tool names — while real-world names the user owns (source network, MusicBrainz, formats, album titles, peer usernames) are permitted. Every failure entry SHALL state what happened and what happens (or can be done) next in at most two sentences. Numbers SHALL be human-formatted: failure reason codes render through a plain-language gloss map with a safe generic fallback (raw code relegated to the entry's disclosure) for unmapped values, and match quality renders coarse and higher-is-better with the raw value only in disclosure. Unknown entry kinds SHALL render a neutral tolerant-reader line in the same register.

Consequence and narration copy SHALL state the composed system's actual contract — the web layer reads both modules' facades and narrates with the whole system's knowledge — hedging only genuine nondeterminism. In particular, the narration of a plain import rejection SHALL state that nothing more will be tried, and the narration of an unusable-delivery rejection SHALL state that the search resumes; neither SHALL suggest a retry that the system will not perform. The narration of a resolved review SHALL reuse the resolving action's verb, tense-shifted — choosing an affordance verb is choosing its timeline verb.

#### Scenario: A failure entry is glossed with its raw code in disclosure

- **WHEN** the timeline renders a download failure whose reason code has a gloss
- **THEN** the visible text carries the plain-language gloss and a next-step clause, and the raw code appears only in the entry's disclosure

#### Scenario: An unmapped reason code degrades safely

- **WHEN** the timeline renders a failure whose reason code has no gloss entry
- **THEN** the visible text falls back to a generic register-compliant failure line and the raw code appears only in the entry's disclosure

#### Scenario: Match confidence is a percentage, not a float

- **WHEN** the timeline renders an automatic confident-match selection
- **THEN** the visible text carries a whole-number match percentage and the raw distance appears only in the entry's disclosure

#### Scenario: Rejection narration tells the truth about what happens next

- **WHEN** the timeline narrates a plain import rejection and an unusable-delivery rejection
- **THEN** the plain rejection's entry states that nothing more will be tried, the unusable-delivery entry states that the search resumes, and neither hedges a deterministic outcome

#### Scenario: The resolution narration echoes the action's verb

- **GIVEN** a review resolved through a labeled resolution action
- **WHEN** the timeline narrates that resolution
- **THEN** the entry reuses the action's verb tense-shifted into the narration register
