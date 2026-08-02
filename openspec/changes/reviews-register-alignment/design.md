# Design — reviews-register-alignment

## Context

See `proposal.md` for motivation. The narration register shipped with legible-acquisition-history
(archive `2026-08-02-legible-acquisition-history`, design D3–D4) governs the acquisition detail;
this change extends it to the `/reviews` surface. Evidence base:
`docs/research/review-surface-ux-best-practices.md` (§1–§7, cited below), which builds on
`docs/research/timeline-ux-best-practices.md`. All decisions below were interviewed to
convergence with the owner (grilling session, 2026-08-02).

Constraints that shape the approach:

- **Zero facade/contract changes.** Everything composes from existing reads
  (`listPendingReviews`, `getImport`, the downloader status read). The unify-at-the-UI-edge
  doctrine of the attention queue (its design D2) applies: the promotion trigger for a
  facade-level shape is a second out-of-process consumer, which does not exist.
- The web package is SSR-first with progressive enhancement; skins are CSS-only over a semantic
  skeleton (web-ui-presentation spec). No browser dialogs, no client-JS-dependent flows.
- The e2e and Playwright parity tiers touch `/reviews` only via `data-testid="empty"` and the
  "Needs attention" nav link — both preserved. No black-box tier asserts the strings changed
  here (verified 2026-08-02). Local `pnpm test:e2e` before PR remains mandatory (ship.md).

## Goals / Non-Goals

**Goals:**

- One narrator across acquisitions and reviews: same identity for the same story, same verb on
  the button as in the timeline's retelling, same direction for the same number.
- An affordance register — the narration register's imperative-side extension — recorded as
  spec requirements and implemented through one copy module.
- Truthful consequences: deterministic outcomes stated plainly, including correcting two shipped
  timeline strings that hedge determinism.
- Destructive resolutions confirm in-page with outcome-named choices, no JS.

**Non-Goals:**

- No facade or wire-contract changes; no importer/downloader source changes beyond the web
  package (the two timeline strings live in the web copy module).
- No `/reviews` liveness/polling — deferred to the SSE change, where live review updates ride
  the driver swap if cheap (owner-directed).
- No new review kinds, resolution verbs, or importer behavior.
- No role-split rendering.

## Decisions

### D1 — The affordance register (research §7, rules 1–3, 5–6)

The narration register D3 rules govern completed/pending *narration*; affordances are imperative
and get their own six rules, adopted from the research synthesis:

1. Labels are short imperative fragments, sentence case, verb-first; verb + object when the verb
   alone is ambiguous. Never OK/Confirm/Yes/Done as a resolution label (§1.1–§1.2).
2. A destructive label names what it deletes (§1.1, §1.4).
3. Consequences follow the label after an em-dash or sit in adjacent supporting text — never a
   parenthesized aside. Label and consequence must agree (§1.3).
4. Danger emphasis is graded: destructive resolutions render in the danger style at low
   emphasis (they are two of several choices), never the page's visually primary action (§1.4).
5. Actions that open further input take a trailing ellipsis (§1.3, Apple's convention).
6. One verb per action across button → confirmation → timeline: the imperative label's verb is
   the timeline's past-tense verb (§6; GitHub's "Request changes" → "requested changes").
   Choosing a button verb is choosing a timeline verb — the copy module keeps a single verb
   inventory for both.

The narration register's vocabulary bans (no enums, no architecture nouns, no internal tool
names) apply to affordance copy in full.

### D2 — The determinism principle; two shipped strings corrected

Consequence copy states the composed system's actual contract. The hedge "a new download may be
tried" came from a contract-review finding that is correct *at the contract* (the importer must
not promise downloader policy) but wrong *at the BFF*, which reads both facades and narrates
with the whole system's knowledge — the one-system rule requires it to.

Domain facts (verified in code):

- `reject-unusable-delivery` → `ReleaseVerdictRecorded` is published → downloader ACL →
  revival (`decide.ts` `RecordExternalValidationFailed`): in every non-pathological case
  (non-legacy fulfilment, non-stale verdict — and a Fulfilled acquisition cannot be cancelled)
  the hunt deterministically resumes via `selectNext`: next candidate, another search round, or
  an immediate honest "Gave up". The truthful promise is **"the search resumes"** — not "will
  be downloaded" (may exhaust) and not "may be tried" (reads as system indecision).
- Plain `reject` → `ImportRejected`, which the importer **never publishes** (only
  `ReleaseVerdictRecorded` crosses the boundary). Nothing more is ever tried. The shipped
  "A new download may be tried." on the `rejected` row is false hope and is corrected to state
  that nothing more will be tried (re-requesting remains the user's move and the copy says so).

Hedged wording remains only for genuine nondeterminism. Alternative considered: keeping the
hedge for symmetry with the contract's decoupling — rejected, because the UX cost (a user
waiting on a retry that cannot come) is real and the architectural concern is already solved at
the right layer (the verb rename, v3.11.0).

### D3 — Intent titling via web-side composition (research §2)

The review detail `<h1>` and the attention queue's review rows are titled by the acquisition's
request phrase — the same `targetDescription` identity the acquisition page uses — through a
fallback chain: composed acquisition title → staged directory basename → "Import awaiting
review". Composition: `pending.importId` → importer `getImport` → `acquisitionId?` → downloader
status read → `targetDescription`. All in-process reads; each link is failure-tolerant (a failed
or absent link degrades to the next fallback, never an error). The staged path renders as a
labeled supporting line on the detail page (and in disclosure where space is tight), never the
title (§2: a path "describes storage, not content"; Lidarr/Stripe/GitHub all title by the human
subject).

Alternatives considered: titling by the best candidate's artist–album (rejected: it presumes
the answer to the question under review); an additive `acquisitionId` on `PendingReviewDto`
(rejected: a contract change to save two in-process reads on a single-user app; the promotion
trigger has not fired).

### D4 — The copy table (the deliverable; reviewed as content)

All strings live in the web layer's copy modules; every closed union is matched exhaustively
(`satisfies`-checked maps, tolerant runtime fallback behind a compile-time exhaustiveness
check), mirroring the timeline module's regime. `{…}` computed. Draft wording — content review
happens on this table.

**Resolution affordances** (button label — consequence · timeline echo, rule D1.6):

| Verb | Label + consequence | Timeline `review-resolved` echo |
| --- | --- | --- |
| `apply-candidate` | `Approve this match` (per-candidate; duplicate reviews add a choice labeled `Replace the existing copy` / `Keep both copies`) | `you approved a match` |
| `supply-id` | summary `Supply a release ID…` → field `Release ID` (hint: `from any connected source`), submit `Search with this release ID` | `you supplied a release ID — the candidates were searched again` |
| `refresh-candidates` | `Refresh the candidates — search the connected sources again` | `you refreshed the candidates` |
| `import-as-is` | `Import as-is — keep the current tags` | `you imported it as-is` |
| `manual-tags` | summary `Import with manual tags…`, submit `Import with these tags` | `you imported it with your own tags` |
| `accept` | `Accept it as-is — leave the failed steps undone` | `you accepted it despite the failed steps` |
| `retry-enrichment` | `Retry the failed steps` | `you retried the failed steps` |
| `reject-unusable-delivery` | `Reject the files — delete them and search for a replacement` (danger, low emphasis; confirm per D5) | `you rejected the files — the search resumed` |
| `reject` | `Reject the import — delete the files; nothing more will be tried` (danger, low emphasis; confirm per D5) | `you rejected the import` |
| unknown verb (tolerant) | *not rendered (absent from `availableActions` handling is unchanged)* | `Review resolved` + raw code in disclosure (unchanged) |

**Corrected timeline strings (D2):**

| Entry | Was | Becomes |
| --- | --- | --- |
| importer `rejected` | `Import rejected — {reason}. A new download may be tried.` | `Import rejected — {reason}. Nothing more will be tried — request the release again for another attempt.` |
| `review-resolved` (reject-unusable gloss) | `you rejected the files. A new download may be tried.` | `you rejected the files — the search resumed` |
| `release-verdict-recorded` | `Marked this delivery unusable — a new download may be tried` | `Marked this delivery unusable — searching for a replacement` |

**Attention-queue chips (the ask; module chip removed, `data-module` attribute retained):**

| Kind | Chip |
| --- | --- |
| `match-review` | `Choose a match` |
| `no-match` | `No match found` |
| `duplicate-review` | `Already in the library` |
| `remediation-review` | `Fix after import` |
| `edition-selection` | `Choose an edition` |

**Queue context summaries:**

| Kind | Summary |
| --- | --- |
| `match-review` | `{n} candidate match{es} — best: {category} ({pct}%)` + hint note where present |
| `no-match` | `No release matched in any connected source` |
| `duplicate-review` | `Already in the library: {artist} — {album}` |
| `remediation-review` | `Added to the library, but {glossed stage} failed` |

**Detail-page headings/notes:** no-match note `No release matched these files in any connected
source — it may not exist there yet. Supply a release ID to point the search at it.`;
remediation heading `Added to the library, but some finishing steps failed`; duplicate heading
`Already in the library` (unchanged); unknown review kind keeps its tolerant line, reworded to
the register: `This needs your attention, but this page can't describe it yet` + raw kind in
disclosure.

**Match-quality categories (D6):** `Strong match` ≥ 95, `Good match` 85–94, `Weak match` < 85 —
`pct = round((1 − distance) × 100)` (the shipped formula). Categories are presentation bands,
`satisfies`-checked at the boundaries.

**Remediation stage gloss map** (open string → English; unmapped falls back verbatim with the
raw value in disclosure): `embedart` → `embedding album art`, `fetchart` → `fetching album art`,
`lyrics` → `fetching lyrics`, `scrub` → `cleaning old tags`, `replaygain` → `volume analysis`.
The penalty gloss map from v3.8.0 carries over unchanged.

### D5 — In-page destructive confirmation (research §1.4)

The two file-deleting verbs submit into an SSR-modeled confirm step: the resolve action, when
the form lacks a `confirmed` marker, does not dispatch — it re-renders the page with a modeled
pending-confirmation state carrying the verb and its form values. The confirm block restates the
specific consequence (`This deletes the downloaded files from staging.` + the D2 determinism
clause for that verb) and offers exactly two outcome-named submits: `Delete the files` (carries
`confirmed`, dispatches) and `Keep the files` (returns to the review unchanged). No JS, no
browser dialog (GOV.UK additional-step pattern, NN/g outcome-named options). Non-destructive
verbs dispatch directly — no habituation (§1.4 "cry wolf").

Alternatives considered: `<details>`-gated forms (rejected: hiding affordances behind disclosure
has no research support and weak information scent — §4); a separate confirm page (equivalent
pattern, more routing surface for the same behavior); client-side `confirm()` (banned: dialogs,
JS dependence).

### D6 — Confidence: coarse, higher-is-better, one direction (research §3)

`formatDistance`'s lower-is-better percentages ("13.6% off", "best 13.6% away") are retired from
visible text. Headline match quality renders as category + rounded percent (`Strong match —
96%`). Penalty *reasons* remain visible in plain language ("Why this score: album title, extra
files"); penalty *amounts*, raw distance floats, `dataSource`, and `albumId` move to the
per-candidate disclosure (D7). Rationale: no surveyed product (beets, Picard, the *arrs) shows a
raw or lower-is-better number; precise percentages invite overtrust (§3.2). The timeline's D6
percent formula is reused so both surfaces compute identically.

### D7 — Candidate diff: differences foregrounded, internals disclosed (research §4, §5)

The per-track table keeps every row (the full tracklist is coverage evidence — the reviewer
judges "did all 12 tracks map?"), but unchanged rows render de-emphasized (muted token), and
changed values carry word-level highlight marks computed server-side by a pure string-diff
helper (Picard's documented weakness is unhighlighted near-identical strings), plus an explicit
direction cue (current → proposed), never color alone. Extra/missing rows keep their tags.
Each candidate gains one strong-scent disclosure — `Matching details — source, release ID, raw
score` — holding `dataSource`, `albumId`, raw distance, and per-penalty amounts. Album-field
rows are unchanged (already labeled values, no `[none]` leakage).

Alternative considered: beets-style changed-rows-only (rejected: hides coverage evidence behind
interaction, bumping the decision-evidence rule — §4's decision-relevance criterion).

### D8 — One system in the queue

`AttentionQueue` stops rendering `moduleLabel` chips; the function dies with its render site.
`data-module` stays as a DOM attribute for skins and tests (the timeline's D3 precedent for the
`Import` tag). Kind determines module (`MODULE_OF`), so no information is lost even for the
operator. Kind chips re-word to the ask (D4 table); queue row titles adopt D3's composition.

### D9 — Source-agnostic matcher copy

"Beets" leaves visible copy (both no-match strings and the supply-id hint) for source-agnostic
phrasing — the matcher may be configured with backends other than MusicBrainz, so glossing
"beets" as "MusicBrainz" would be inaccurate; naming the tool violates the one-system rule. A
concrete candidate truthfully names its own `dataSource` — in its disclosure per D7. Tool names
remain available in disclosure copy where diagnostically useful. Precedents: the timeline's
importer rows never say beets; v3.8.0's source-agnostic ID decision.

### D10 — Skin anatomy: structure once, themes three times

The semantic skeleton gains the decision anatomy — danger token family (low-emphasis destructive
affordance), the confirm block, diff highlight marks, muted-row state, candidate disclosure —
themed deliberately by all three skins (forum finishing-pass first, per the v3.14.0 practice).
Danger color is never the only signal; the label text carries the consequence on its own.

### D11 — Copy module organization

Review-surface strings consolidate into the reviews copy module (`$lib/reviews.ts` and a
components-consumed sibling if size warrants), with the same regime as the timeline copy module:
one place to review strings, `satisfies`-checked gloss maps, no bare `default` arms, tolerant
fallbacks always tracing the raw value into disclosure. The verb inventory (D1.6) lives here
once — button label and timeline echo derive from one entry per verb, so a future verb cannot
diverge its two retellings.

### D12 — Testing

Copy functions and the diff helper are pure — unit-tested in the node project. Components via
existing SSR/svelte test tiers; the confirm flow via the route's `page.server` tests (no
dispatch without `confirmed`, dispatch with it, decline round-trip). Black-box tiers unaffected
(verified; testids and nav link retained). Local `pnpm test:e2e` before PR per ship.md — the
diff touches user-visible strings.

## Risks / Trade-offs

- [Title composition adds two in-process reads per review row on the queue] → single-user
  scale; reads are in-process facade calls; each link failure-tolerant with a designed fallback.
- [The confirm step adds one round-trip to destructive resolutions] → intended friction for an
  irreversible act; rare action, no habituation risk.
- [Category bands (95/85) are invented thresholds] → presentation-only, in one module,
  reviewed as content; adjusting them is a copy change, no contract touch.
- [Correcting the two timeline strings changes shipped copy some tests assert] → in-diff
  unit/SSR updates; no black-box tier asserts them (verified).
- [Word-level diff highlighting could mis-segment odd unicode tags] → the helper is pure and
  unit-tested; worst case is a coarser highlight, never wrong data.
- [Same-page confirm state could be bookmarked/refreshed mid-confirm] → the state is derived
  from the POST re-render, not a URL; a refresh simply re-renders the plain review.

## Migration Plan

Web-layer only; standard release pipeline; rollback is a redeploy of the prior image. No
storage, schema, or contract changes.

## Open Questions

None blocking. Deferred by intent: `/reviews` liveness (SSE change, as a rider on the driver
swap); exact final wording of the D4 table is reviewed as content during implementation review.
