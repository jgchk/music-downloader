# Proposal: reviews-register-alignment

## Why

v3.14.0 (legible-acquisition-history) gave the acquisition detail page one narrator under an
explicit copy register; the `/reviews` surface predates it and still speaks its own dialect —
parenthesized asides on buttons ("Reject as unusable (delete files)"), the same match fact
counted in the opposite direction ("13.6% off" vs the timeline's "87% match"), visible
architecture nouns ("Importer"/"Downloader" chips), tool jargon ("Beets found no candidates",
"Remediation"), raw `dataSource · albumId` identifiers inline, and a staged file path as the
page title. The two surfaces the user moves between daily should sound like one system telling
one story. The grilling session (2026-08-02) converged the decisions; the evidence base is
`docs/research/review-surface-ux-best-practices.md` (§1–§7), which extends
`docs/research/timeline-ux-best-practices.md` to imperative decision surfaces.

## What Changes

- **Register extension for affordances.** The narration register (D3 of the archived
  legible-acquisition-history change) gains rules for imperative surfaces: verb-led sentence-case
  labels; destructive verbs name their object; consequence after an em-dash or in supporting
  text, never parenthesized; graded danger emphasis (destructive actions low-emphasis, never the
  page primary); trailing ellipsis on form-opening actions; one verb per action across
  button → timeline narration (research §7 rules 1–3, 5–6, 11).
- **The determinism principle.** Consequence copy states the composed system's actual contract —
  the BFF reads both facades and is allowed to know. `reject-unusable-delivery` deterministically
  resumes the hunt (downloader `decide.ts` revival); plain `reject` is never published to the
  downloader, so nothing more is tried. The two shipped timeline strings that hedge "A new
  download may be tried" are corrected (the plain-reject one was false hope).
- **Review pages titled by musical intent.** Queue rows and the review detail `<h1>` show the
  acquisition's request phrase (same identity as the acquisition detail page), via web-side
  composition (`importId → getImport → acquisitionId → downloader status → targetDescription`),
  falling back to path basename → "Import awaiting review". The staged path demotes to evidence.
- **One system to the user.** The attention queue's rendered "Importer"/"Downloader" module chips
  are removed (`data-module` stays for skins/tests); kind chips are re-worded to name **the ask**
  ("Choose a match", "Fix after import", "Choose an edition"). "Beets" leaves layer-1 copy for
  source-agnostic phrasing; a concrete candidate names its actual `dataSource`.
- **Confidence speaks one direction.** Headline match quality is coarse and higher-is-better
  (category word + rounded percent, "Strong match — 94%"); penalty *reasons* stay visible,
  penalty *numbers* and raw floats move to disclosure (research §3).
- **Candidate diff foregrounds differences.** Unchanged track rows render muted; changed values
  get server-computed word-level highlight marks with a direction cue; raw
  `dataSource · albumId` and raw score move behind one strong-scent disclosure (research §5, §4).
- **Destructive actions confirm in-page.** The two file-deleting verbs (`reject`,
  `reject-unusable-delivery`) render low-emphasis danger and submit into an SSR-modeled confirm
  step with outcome-named buttons ("Delete the files" / "Keep the files") — no JS, no dialogs
  (research §1.4).
- **Skins theme the new anatomy deliberately** (danger/confirm/diff-mark token families),
  structure once, themes three times; forum finishing-pass first.
- **Non-goals:** no facade/contract changes (title data is composed from existing reads); no
  `/reviews` liveness (deferred to the SSE change as a rider on the driver swap); no importer
  domain/verb changes; no role-split rendering.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `web-ui`: the "Import review resolution" requirement gains the affordance register (labels,
  determinism consequences, confirm step, intent titling, ask-oriented chips, source-agnostic
  copy, diff emphasis, disclosure split); "The attention queue unifies work awaiting a human"
  drops its user-visible module identification ("naming its module and kind" → kind-only, ask-
  oriented); "Timeline copy follows a single register" widens from acquisition-detail copy to all
  user-visible surfaces and gains the determinism principle (correcting the two hedged
  resolution strings).
- `web-ui-presentation`: the structural-anatomy requirement extends to the review surface's new
  anatomy — danger emphasis, confirm block, diff highlight marks — themed per skin over semantic
  tokens.

## Impact

- **Code:** `packages/web` only — `$lib/reviews.ts`, `$lib/attention.ts`, review components
  (`ReviewDetail`, `ResolveForms`, `ManualTagsForm`, `CandidateTable`, `AttentionQueue`), the
  `/reviews` routes (load composition + confirm-step action flow), the timeline copy module (two
  string corrections), skin CSS. No downloader/importer source changes.
- **Contracts:** none. Facade schemas untouched; wire DTOs untouched.
- **Tests:** unit/SSR tests for all touched components and copy; black-box tiers verified
  unaffected (e2e keys on `data-testid="empty"` and the "Needs attention" nav link, both kept;
  no tier asserts the changed strings; full-loop never posts a resolution). Local
  `pnpm test:e2e` before PR is mandatory regardless (user-visible strings in the diff).
- **Docs:** research doc already landed; this change's design.md carries the copy table as a
  reviewed deliverable, citing research §n.
