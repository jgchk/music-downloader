# Design — legible-acquisition-history

## Context

The acquisition detail page composes a download-through-import timeline web-side (`mergeTimeline`
over the two facades' read models, per-entry `at` since v3.7.0). Three defects make it feel
machine-generated:

1. **Coverage.** The downloader history projection (`read-models.ts`) emits only five
   attempt-level kinds (`selected`, `download-failed`, `validation-failed`, `imported`,
   `fulfillment-rejected`). Everything before candidate selection and every terminal outcome is
   dropped, so a fresh acquisition renders an empty list captioned "Nothing has happened yet." —
   as does a *failed* one.
2. **Copy.** Entries leak internal vocabulary: enum names (`TransferError`, `apply-candidate`),
   architecture nouns ("Handed off to importer"), raw floats (`distance 0.1363750628456511`), full
   peer paths inline, and a per-entry `Import` tag that collides with entry text ("Import Import
   requested").
3. **Time.** `at` exists on every entry and is never rendered; the page never refreshes itself
   ("freshness is page-navigation freshness"), so even a correct timeline reads as frozen.

Decisions below were interviewed to convergence with the owner and are backed by cited UX research
in `docs/research/timeline-ux-best-practices.md` (NN/g heuristics/error/empty-state/progress
guidance, design-system timeline patterns, GitHub/Stripe/Sonarr precedents). Referenced there as
§n.

## Goals / Non-Goals

**Goals:**

- History always tells a complete story: request → resolution → search → attempts → hand-off →
  import → explicit ending, with a live "now" row while active.
- One narrator voice under an explicit copy register; zero internal vocabulary in visible text.
- Rendered timestamps, self-refreshing detail page while active.
- Diagnostic detail retained but one click deep; the whole detail page (status line, header,
  queue sidebar) adopts the same register.
- All three skins style the new anatomy deliberately.

**Non-Goals:**

- No SSE/push (future change; this design keeps a seam for it — D8).
- No `/reviews` surface changes.
- No role-split rendering (single copy for the trusted circle).
- No importer facade changes; no new cross-module contract.
- No full event log — curation is deliberate (`CandidatesRanked`, `ValidationPassed`,
  `DownloadCompleted`, `CandidateRejected` stay internal; a rejection is implied by the failure
  row that precedes it).

## Decisions

### D1 — New downloader facade history kinds (additive)

The history projection and facade schema gain these kinds, each carrying `at` like the existing
five:

| Kind | Source event | Payload beyond `at` |
| --- | --- | --- |
| `requested` | `AcquisitionRequested` | the request target (discriminated: mbid / release-group / descriptor artist+title+album?) — carried so the UI can title never-resolved acquisitions (D10) |
| `resolved` | `TargetResolved` | resolved artist, title, year where present |
| `search-started` | `SearchRequested` | `round` |
| `fulfilled` | `AcquisitionFulfilled` | `location` |
| `exhausted` | `AcquisitionExhausted` | — |
| `conflicted` | `ImportConflicted` | `location` |
| `metadata-failed` | `MetadataResolutionFailed` | — |
| `cancelled` | `AcquisitionCancelled` | — |

Additive union members only — api-compatibility's additive-only rule; existing consumers are
tolerant readers (the web view already has an unknown-kind fallback arm). Because history is
folded from the event store at read time, **existing acquisitions retroactively gain full
timelines** — no upcaster, no migration.

`EditionSelected`/`ManualSelectionRequested` get no rows: awaiting-selection is presented by the
existing edition-picker section and the pending row (D5); the chosen edition is reflected in the
`resolved`/search flow.

### D2 — Curated milestones, not an event log

Rationale (owner-confirmed; §2.2, §3): every premium precedent (Stripe, Vercel, order tracking)
curates to user-meaningful state changes. The full log remains available in the event store.
`CandidateRejected` in particular is bookkeeping co-emitted with a failure that already has a row;
its meaning is folded into the failure row's closing clause ("Trying the next source.").

### D3 — One narrator; the copy register

Six rules (research §7.1; Material "Message sent" register, Apple HIG, GOV.UK):

1. Completed rows: past-tense, verb-led fragments, sentence case, no trailing period.
2. The single pending row: present progressive + ellipsis.
3. No first person ("we"/"I" banned); "you/your" only for user-initiated facts.
4. No internal vocabulary in visible text: no enum names, no architecture nouns (importer,
   staged, projection, hand-off), nothing parenthesized-because-unplaced. Real-world names the
   user owns (Soulseek, MusicBrainz, FLAC, album titles, peer usernames) are allowed.
5. Every failure line = what happened + what happens next, ≤ 2 sentences, em-dash over period
   where one row needs both.
6. Numbers human-formatted only (D6 for the distance gloss).

The rendered `Import` module tag is removed; `data-module` stays as a DOM attribute for skins and
tests. The user never learns there are two systems.

### D4 — The copy table (the deliverable; reviewed as content)

Layer 1 = always-visible row text. Layer 2 = per-entry `<details>` payload (D7). `{…}` computed.

**Downloader-originated entries:**

| Kind | Layer 1 | Layer 2 |
| --- | --- | --- |
| `requested` | `Requested` | request detail (mbid or descriptor as given) |
| `resolved` | `Matched to MusicBrainz — {artist}, {title} ({year})` | — |
| `search-started` (round 1) | `Started searching for a download` | — |
| `search-started` (round > 1) | `Searched again for another source` | round |
| `selected` | `Chose a download from {username}` | full remote path, size |
| `download-failed` | `Download failed — {gloss(reason)}. Trying the next source.` | raw reason code, remote path |
| `validation-failed` | `The files failed quality checks — {gloss(reasons)}. Trying the next source.` | verbatim reason list, remote path |
| `imported` (hand-off) | `Download complete — preparing to add to the library` | staged path |
| `fulfillment-rejected` | `Delivery rejected — {gloss(reasons)}. Searching for a replacement.` | verbatim reasons |
| `fulfilled` | *(curated out of the view — see note)* | — |
| `exhausted` (closing) | `Gave up — every source failed or came up empty. Request it again to search anew.` | — |
| `conflicted` (closing) | `Stopped — the destination already had files for this release. Nothing was overwritten.` | conflicting location |
| `metadata-failed` (closing) | `Couldn't identify this release. Check the artist and title, then request it again.` | — |
| `cancelled` (closing) | `Cancelled` | — |
| unknown kind (tolerant reader) | `Something happened that this page can't describe yet` | raw event kind |

Note: the downloader's `AcquisitionFulfilled` is co-emitted with the hand-off (`Imported`) in the
same decide batch — it marks the staging deposit, not the library import — so a rendered
`fulfilled` row would duplicate the hand-off's moment and falsely read as the story's ending
mid-timeline. The web view curates the `fulfilled` kind out (the facade still carries it); the
true happy ending is the import's `applied` row, and the whole-story duration gloss attaches to
the final rendered row once the story has settled (downloader terminal + import settled).

Note: `conflicted` copy is corrected against the domain (`library.ts` D13): a conflict means the
destination directory was already occupied and was left untouched — *not* a concurrent
acquisition.

**Importer-originated entries (no prefix):**

| Kind | Layer 1 | Layer 2 |
| --- | --- | --- |
| `requested` | `Import started` | — |
| `proposed` | `Compared against the library — {n} candidate match{es}` | — |
| `auto-apply-selected` | `Confident match — importing automatically ({pct}% match)` | raw distance |
| `review-required` | `Needs your review` + link to the review | review kind |
| `review-resolved` (glossed verbs) | `Review resolved — {gloss(resolution)}` (e.g. "you approved the match"; reject-unusable-delivery → "you rejected the files. A new download may be tried.") | — |
| `review-resolved` (unknown resolution) | `Review resolved` | resolution code |
| `applied` | `Added to the library` | library path |
| `remediation-required` | `Added to the library, but needs attention` | per-stage failure list |
| `rejected` | `Import rejected — {reason}. A new download may be tried.` | — |
| `release-verdict-recorded` | `Marked this delivery unusable — a new download may be tried` | verbatim reasons |
| unknown kind | `Something happened during import that this page can't describe yet` | raw event kind |

This also clears the recorded "retry-download verdict" label loose end.

**Reason gloss map** (`DownloadFailureReason` → English; unmapped values fall back to
`Download failed — trying the next source.` with the raw code in layer 2, keeping the tolerant
reader honest):

| Code | Gloss |
| --- | --- |
| `PeerUnavailable` | the source went offline |
| `Stalled` | the download stalled |
| `QueueTimeout` | it waited too long in the source's queue |
| `TransferError` | the transfer was cut off |
| `FileUnavailable` | the files were no longer available |
| `Cancelled` | the download was cancelled |

`fulfillment-rejected` / `rejected` / `release-verdict-recorded` reasons arrive as free strings
from validation; they render verbatim in the gloss slot (they are already sentences), with the
raw list in layer 2.

Cross-context reaction copy is hedged: an importer-originated row states the importer's fact and
says a new download **may** be tried — the revival is the downloader's policy, and the copy must
not promise the other context's behavior (review finding; the v3.11.0 verb rename made the same
decoupling in the contract).

All strings live in one web-layer copy module so review and future edits happen in one place.
Every closed union the module consumes is matched exhaustively (`satisfies`-checked gloss maps,
no bare `default` arms — the tolerant runtime fallback rides behind a `satisfies never` compile
check and always traces the raw value in the disclosure), so a new kind, code, or phase is a
build break demanding copy, mirroring the projection's own no-default regime.

### D5 — The synthesized pending row

While the acquisition is non-terminal, the web layer appends exactly one non-event row at the
tail (NN/g progress-indicator guidance: named-step determinate over spinner; Ant's loading node —
§4, §7.6), derived from the status DTO the page already loads:

| Status | Pending row |
| --- | --- |
| `Pending` | `Identifying the release…` |
| `AwaitingManualSelection` | `Waiting for you to choose an edition` (attention-styled, not spinner) |
| `Searching` / `Selecting` | `Searching for a download…` |
| `Downloading` | `Downloading from {username}…` + embedded progress (the existing ProgressBar moves into this row; `progressUnavailable` renders the row without the bar plus the existing momentarily-unavailable sentence) |
| `Validating` | `Checking audio quality…` |
| `Importing` (downloader) | `Adding to the library…` |
| import in flight (importer non-terminal after hand-off) | derived from the importer's status: matching → `Matching against the library…`; awaiting review → `Waiting for your review` (attention-styled, links to the review) |

Settledness gates the pending row and the liveness loop as one decided story-level fact
(`isStorySettled`): a failed downloader ending settles immediately; a delivery (`Fulfilled`)
settles only when its import reports its own decided `settled` flag (an additive importer facade
field — D12). The asynchronous hand-off window — downloader fulfilled, import not yet created (or
its read momentarily failed) — is UNsettled: the page keeps refreshing, the pending row says
"Adding to the library…", and the status line says "Delivered — confirming the import" (never "In
your library"). The pending row's downloader arm gates on decided terminality (`isTerminal`), not
the cancel affordance, so an older producer omitting `cancellable` still narrates; a
contradictory enum-vs-flag state claims nothing. Once settled ⇒ no pending row; the closing row
from D4 ends the story. With `requested` now a
real first entry, an empty timeline is unreachable for any real acquisition (Stripe's
creation-event-is-entry-#1 property). The defensive `no-history` fallback copy becomes
`No history recorded yet — this page updates as the acquisition progresses.` and the string
"Nothing has happened yet." is retired.

### D6 — Time rendering

- Flat chronological, oldest first (§2.2, §7.4); `mergeTimeline` ordering unchanged.
- Every row: `<time datetime="{iso}" title="{full absolute}">`; display relative under 24h
  ("now" < 60s, then minutes/hours), absolute date+time after (Cloudscape hybrid, §2.1). No
  live-ticking — the liveness refresh (D8) keeps relative values honest while it matters.
- Date divider rows when the calendar date changes.
- The closing row carries a duration gloss computed from first→last entry (`· 6 min from
  request`), rounded coarsely (seconds < 1 min, minutes < 1 h, else hours/days).
- Match percentage: `pct = round((1 − distance) × 100)` — extends the v3.8.0
  legible-match-review gloss precedent; raw float only in layer 2.

### D7 — Progressive disclosure via native `<details>`

Per-entry `<details>/<summary>` renders only when the entry has a layer-2 payload (D4 tables).
Native element: free `aria-expanded` semantics, no JS, styleable per skin — fits the semantic
skeleton (§2.4, SLDS/Sonarr precedent; NN/g: hide/minimize obscure codes, diagnostic-only). All
entries default closed, including failures: unlike GitHub's failed-step logs, our failure rows
already carry the glossed reason inline, so auto-expanding would only surface the raw code twice.
This supersedes the prior "no expandable failure-reason control" rule at the spec level: the
visible row keeps the human reason (so the reveal duplicates nothing); layer 2 holds only
diagnostics.

### D8 — Liveness behind a swappable freshness driver

While the acquisition is non-terminal, the detail page re-runs its own load on an interval
(~5s) via SvelteKit `invalidateAll()`; the driver stops on terminal status and on page teardown.
Architecture: the trigger lives behind one small seam (a freshness-driver module exposing
`start(onTick)/stop` semantics) owned by the page layer; timeline components stay pure consumers
of page data. A future SSE change replaces the driver implementation, not the views — this
forward-compatibility intent is explicit and owner-directed. No new wire endpoint is introduced
(the page-load path is reused); the layout's "freshness is page-navigation freshness" design
comment is amended to record the revision. A failed re-fetch is caught into a modeled
`refreshFailed` state rendered beside the timeline ("Couldn't refresh just now — retrying."),
never a silently stale page; a load that *throws* during a poll still falls to SvelteKit's error
boundary — accepted, since the in-process facade read has no transient network failure mode.

### D9 — The rest of the detail page (same register)

- **Status line:** raw enum + counters (`Done Fulfilled — 1 attempts, 0 candidates rejected`)
  becomes badge + human phrase + correctly-pluralized meta (`In your library · 3 attempts · 2
  sources rejected`; zero-count segments omitted). Status phrase map: `Pending` → Identifying the
  release, `AwaitingManualSelection` → Waiting for an edition choice, `Searching`/`Selecting` →
  Searching, `Downloading` → Downloading, `Validating` → Checking quality, `Importing` → Adding
  to the library, `Fulfilled` → In your library, `Exhausted` → No usable download found,
  `Cancelled` → Cancelled, `MetadataFailed` → Couldn't identify the release, `Conflicted` →
  Stopped: destination occupied.
- **The orphan paragraph** (bare staging path / repeated enum) is replaced by a labeled location
  line rendered only when `location` is present (`In library at {location}`); failure detail
  lives in the timeline's closing row, not repeated in the header.
- **"Not yet handed off to the importer"** dies with the unified voice; before hand-off the
  timeline simply has no import entries and the pending row says what is happening.
- **Queue sidebar:** `{n} attempt{s}` pluralized; the attempts line hidden at zero.

### D10 — Killing the "(resolving…)" forever-lie

The list and detail title fall back through: resolved target → the request descriptor carried on
the `requested` history entry / list read model (additively extended alongside D1) → for
mbid-only never-resolved requests, `Unknown release`. `(resolving…)` remains only while status is
actually `Pending`. The detail page of a `metadata-failed` acquisition is thus titled by what the
user asked for, with the closing row explaining the failure.

### D11 — Skin anatomy: structure once, themes three times

The semantic skeleton gains the timeline anatomy — a row grid of marker slot / content /
time, pending-row state, date dividers, `<details>` slot — with semantic marker tokens (routine,
pending-animated, attention, failure, success) defined at the token layer; color is never the
only signal (Carbon). Each skin themes the anatomy: forum (the daily driver — finishing-pass
priority) as a clean receipt-like list, glass with soft dot-and-connector treatment, terminal as
an intentional log aesthetic. Cost stays near 1.5× because structure is shared — the skin
system's designed use (v3.6.0).

### D12 — The importer publishes its settledness (review finding)

Which import phases are terminal is the importer's decided fact. The import status read model and
DTO additively expose `settled` (decided from the import domain's own `isTerminal`), and the web
layer paces the detail page's liveness off that flag — never off pattern-matching the phase enum
(the v3.12.0 decided-lifecycle-flags pattern). An absent flag (older producer) degrades
conservatively to unsettled. The import-phase *phrase* maps in the web layer remain presentation
and are exhaustively typed, so a new phase is a compile error, not a silent "Matching against the
library".

## Risks / Trade-offs

- [Interval refresh loads the full page data every ~5s while unsettled] → single-user scale;
  the driver rests once the story settles; interval chosen ≥ 5s; future SSE swap point designed
  in (D8).
- [A delivered acquisition whose import never materializes (a permanently skipped intake) polls
  while its page is open] → accepted: the intake catch-up subscription processes every delivery,
  so the state is pathological; the honest "confirming the import" presentation beats a false
  "in your library".
- [Curation judges some events unworthy — a user might want the full log someday] → the event
  store keeps everything; adding a kind later is additive by construction.
- [Copy glosses can drift from domain truth as reasons evolve] → glosses live in one module with
  explicit fallbacks for unmapped codes (raw code still reachable in layer 2); tolerant-reader
  arms remain for unknown kinds.
- [Relative timestamps go stale on terminal pages left open] → terminal pages stop refreshing,
  but their rows are > 24h absolute soon after; sub-24h staleness on a closed story is accepted.
- [Three-skin styling triples visual QA surface] → structural anatomy shared; per-skin work is
  theming only; forum gets the deliberate pass first.
- [`search-started` rows could repeat noisily on many-round acquisitions] → rounds > 1 use the
  compact "Searched again" copy; if real usage shows noise, collapsing consecutive rounds is a
  web-side change requiring no contract touch.

## Migration Plan

Additive facade changes only; history is folded at read time, so old acquisitions gain the new
rows with no migration or upcaster. Deploy is the standard release pipeline. Rollback is a
redeploy of the prior image (no schema/storage changes).

## Open Questions

None blocking. Deferred by intent: SSE push (successor change swaps the D8 driver), `/reviews`
surface register alignment, per-phase durations on intermediate rows (closing-row duration only
for now).
