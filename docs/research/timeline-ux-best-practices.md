# Timeline / event-history UX for long-running jobs — research findings

> Research notes, 2026-08-02. Scope: the acquisition detail "History" panel in `packages/web`
> (`src/lib/components/AcquisitionDetail.svelte`, `src/lib/timeline.ts`) — a merged
> downloader+importer event timeline for a long-running download→import pipeline.
> This repo had no research-notes convention (`docs/` contained only `development/`), so this
> file establishes `docs/research/` as the location for research notes.
>
> Citation policy: every claim links the source that owns the guidance. Sources that could not
> be fetched first-hand (JS-rendered sites) are marked **[secondary]** with how they were
> verified. Nothing here is normative for the codebase until it lands in an OpenSpec change.

---

## 1. Microcopy register for system-status and event-log wording

### 1.1 Keep the user informed — the heuristic itself

Nielsen's first usability heuristic: "systems should always keep users informed about what is
going on, through appropriate feedback within reasonable time," and "progress indicators
reassure the user that a longer wait is normal, and that the system is still working"
([NN/g, Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/)).
The article's framing — "Don't blindfold your users" — is the direct indictment of a FAILED job
whose history reads "Nothing has happened yet."

### 1.2 Wording rules that recur across every style guide

The style guides converge on a consistent register:

| Rule | Sources |
| --- | --- |
| **Sentence case** for all UI text, including headings and labels | [GOV.UK style guide](https://www.gov.uk/guidance/style-guide/a-to-z): "Always use sentence case, even in page titles and service names"; [Material Design writing](https://m1.material.io/style/writing.html): "Titles, headings, labels, and menu items should use sentence-style capitalization" |
| **Present tense for behavior, active voice** | [Material](https://m1.material.io/style/writing.html): "Use the present tense to describe product behavior"; GOV.UK: active voice for "concise, clear content"; [Mailchimp](https://styleguide.mailchimp.com/voice-and-tone/): active voice, plain English |
| **Short verb-led fragments, objective first** | Material: "Keep your sentences and phrases short, with as few concepts as possible"; example register "Message sent" (not "Message has been sent"); [Polaris](https://polaris-react.shopify.com/content/voice-and-tone): "Start sentences with verbs so they feel like actionable instructions", "Be direct ('add apps' not 'you can add apps')" |
| **No "we"; system speaks plainly about itself** | [Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing): "Avoid using we altogether… 'We're having trouble loading this content' … Something like 'Unable to load content' is much clearer"; Material: "Avoid the pronoun 'we'" |
| **Second person for the user's actions** | GOV.UK: "Address the user as 'you' where possible"; Material: second person "as though the app is speaking directly to the user" — don't mix first and second person |
| **Plain language; jargon only when it's the user's own jargon** | GOV.UK: "Plain English is mandatory"; technical terms allowed but "explain what they mean the first time you use them"; Polaris: "Some jargon is okay, as long as it's what actual merchants say"; Apple HIG: "avoiding jargon"; Material: "Pick common words" |
| **Consistent language patterns across a multi-step flow** | Apple HIG: "Give clear guidance and use consistent language throughout processes with multiple steps… Make it clear when a flow is complete" |
| **Tone adapts to the reader's stress level** | Mailchimp: "When you're writing, consider the reader's state of mind"; Apple HIG: "Match your tone to the context" — serious situations get straightforward, direct tone; no "oops!" interjections ("typically unnecessary and can sound insincere") |

Register implication for a history feed specifically: a timeline entry is a **record of a completed
fact**, so the entry line itself is past-tense/participial ("Download failed", "Added to the
library" — the "Message sent" register), while the *current* in-progress row is present-progressive
("Searching sources…"). Material's present-tense rule governs descriptions of behavior, not records
of events; its own canonical example "Message sent" is the event-record form.

### 1.3 Error wording and error codes

- NN/g error-message guidelines: "Avoid technical jargon and use language familiar to your users
  instead"; "Hide or minimize the use of obscure error codes or abbreviations; show them for
  technical diagnostic purposes only"; "Concisely and precisely describe the issue"; "Offer
  constructive advice" — a remedy, not just a problem statement; no blame, avoid "invalid"/"illegal"
  ([NN/g, Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)).
- Apple HIG: "display it as close to the problem as possible, avoid blame, and be clear about what
  someone can do to fix it… Avoid robotic error messages with no helpful information, like
  'Invalid name'" ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- Atlassian **[secondary — atlassian.design is JS-rendered; verified via search excerpts]**: keep
  error messages to 1–2 sentences; first sentence = most likely cause or simplest solution, second
  sentence = backup solution; "be open and clear about what people are experiencing"
  ([Atlassian, Writing error messages](https://atlassian.design/content/writing-guidelines/writing-error-messages/)).
- Kinneret Yifrah, *Microcopy: The Complete Guide* **[secondary — book; chapter contents verified
  only via publisher/bookseller descriptions, not page-level excerpts]**: the book's error-message
  chapter teaches designing a deliberate voice-and-tone before writing any string, and treats error
  messages and empty states as first-class microcopy surfaces
  ([book listing](https://www.amazon.com/Microcopy-Complete-Guide-Kinneret-Yifrah/dp/B07N1RD7W6)).
  Cited here only for the *method* (voice-and-tone design up front, per-surface copy inventories),
  not for specific rules.

**Verdict for `Download failed (TransferError)`**: every source above says the same thing — the
human line carries the meaning ("the peer cut the transfer off"), the enum (`TransferError`)
survives only inside a progressive-disclosure detail view "for technical diagnostic purposes only"
(NN/g). Same for `distance 0.1363750628456511`: raw model internals are exactly the "obscure
codes" class; the repo already established the gloss precedent in the legible match-review work
(v3.8.0), which should extend to the timeline.

---

## 2. Timeline component design patterns

### 2.1 Timestamps: relative vs absolute, and the hybrid

- **Cloudscape (AWS)** is the most explicit primary source: relative timestamps ("3 minutes ago")
  when "users need to quickly see how long ago an event occurred"; absolute when "users need a
  specific date and time." Relative granularity ladder: "Now" under 60 s → minutes → hours → days →
  weeks → months → years. Crucially it mandates the **hybrid pattern**: wrap a relative timestamp
  in `<time datetime="…">` with the `title` attribute set to the absolute human-readable form so
  hover (and assistive tech) always has the precise time
  ([Cloudscape, Timestamps](https://cloudscape.design/patterns/general/timestamps/)).
- **UX Movement [secondary]** supplies the disagreement: relative timestamps suit high-activity
  feeds where "immediacy" matters; "Use absolute timestamps when users can go back and make use of
  past content", and switch relative→absolute once content ages (their example: after 4 weeks),
  because identical relative labels ("2 days ago" × 3) can't be told apart as reference points
  ([UX Movement](https://uxmovement.com/content/absolute-vs-relative-timestamps-when-to-use-which/)).
- **Baymard** (order tracking, §3.4) found users praised precise absolute wording — "Delivered
  July 22 at 1:35 PM" beats vague language
  ([Baymard](https://baymard.com/blog/integrate-tracking-info)).
- GOV.UK gives the concrete absolute formats: "5:30pm" (not 17:30), "4 June 2017", "midnight" not
  "12am" ([GOV.UK style guide](https://www.gov.uk/guidance/style-guide/a-to-z)).

**Resolution for this app** (§7.3): an acquisition history is *both* a live feed (while running)
and a record (afterwards) — so use the hybrid: relative while recent, absolute once old, full
absolute always available via `<time title>`. Rendering **no timestamp at all** — the current
state — is supported by no source; every timeline/feed component surveyed (Ant, SLDS, Stripe,
Sonarr, GitHub) carries per-entry time.

### 2.2 Grouping: flat chronological vs phase groups

- Ant Design's Timeline is for "a series of information [that] needs to be ordered by time
  (ascending or descending)" — a flat, time-ordered list is the component's essence
  ([Ant Design, Timeline](https://ant.design/components/timeline)).
- Primer's Timeline "displays items on a connected vertical timeline. It's primarily used to
  document the history and activity of a given pull request or issue" — GitHub's own PR timeline
  is flat-chronological with visual **breaks**; note the accessibility rule that a `Timeline.Break`
  is decorative only: "The content within `Timeline.Item` should clearly communicate the status and
  state of that item" — meaning each entry must be self-sufficient, never dependent on a group
  header for meaning ([Primer, Timeline](https://primer.style/components/timeline); guidance text
  from the [primer/design repo](https://github.com/primer/design/blob/main/content/components/timeline.mdx)).
- GitHub Actions groups by **job → step** (a phase hierarchy) but that is for logs at large volume;
  the run *summary* is a short flat checklist (§3.1).
- Sonarr/Radarr History is a flat table, one row per event, with an icon for the action kind
  ([Servarr wiki, Activity](https://wiki.servarr.com/sonarr/activity)).

**Takeaway**: at this app's volume (typically 3–15 entries per acquisition), a flat chronological
list is the standard pattern; phase grouping is a volume-management tool the volume doesn't
justify. The downloader→importer hand-off can read as a normal entry ("Files staged for import"),
not a structural divider — and if a visual divider is ever added, Primer says it must stay
decorative.

### 2.3 Source/module attribution: badges vs a unified narrator

- SLDS's Activity Timeline attributes entries with a **per-activity-type icon** (email, call,
  task…), not a text prefix; each item can carry an expandable detail section
  ([SLDS, Activity Timeline](https://design-system-site-summer-21.herokuapp.com/components/activity-timeline/)
  **[secondary — current SLDS site is JS-rendered; anatomy verified via archived mirror + search excerpts]**).
- Sonarr uses a leading icon per event kind ("The left icon is the action that was taken")
  ([Servarr wiki](https://wiki.servarr.com/sonarr/activity)).
- Stripe's dashboard event feed and GitHub's PR timeline both speak in **one narrator voice**
  ("Payment succeeded", "jgchk merged commit…") — the producing subsystem is never surfaced as a
  text prefix; internal architecture is not the user's mental model.
- Material/Apple both warn against mixing perspectives and inconsistent patterns (§1.2), which is
  what a sometimes-present `Import` prefix is: "Import Import requested" is a perspective collision.

**Takeaway**: drop the textual module prefix entirely; write every entry in one narrator voice,
keep `data-module` for skin-level styling (marker color/icon), which is exactly the icon-not-prefix
pattern SLDS and Sonarr use. Users think in pipeline phases ("matching", "importing"), not bounded
contexts.

### 2.4 Progressive disclosure of technical detail

- NN/g: hide codes; "show them for technical diagnostic purposes only"
  ([Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)).
- Sonarr: "On `Grabbed` statuses, you can click on the `i` icon on the right to see more details
  about the download (what indexer it came from, the URL of the grab, the age of the upload, etc.)"
  ([Servarr wiki](https://wiki.servarr.com/sonarr/activity)) — the domain-neighbor precedent for
  peer paths/indexer detail living behind an affordance.
- GitHub Actions: the summary shows step names + status + duration; raw logs are one click deeper,
  and "any failed steps are automatically expanded to display the results"
  ([GitHub Docs, Using workflow run logs](https://docs.github.com/actions/managing-workflow-runs/using-workflow-run-logs))
  — i.e., disclosure defaults *open* exactly where the failure is.
- Stripe: the events feed shows a human-readable description per event; the raw JSON payload is a
  developer-view drill-down ([Stripe Docs, Events](https://docs.stripe.com/development/dashboard/events)).
- SLDS: expandable detail sections per timeline item, with full `aria-expanded`/`aria-controls`
  wiring (see §2.3 source).

**Takeaway**: two layers. Layer 1 (always visible): human sentence, timestamp. Layer 2 (per-entry
`<details>` or equivalent): peer username + full remote path, error enum, distance/penalties,
staged location. Failure entries may auto-expand (GitHub's pattern).

### 2.5 Visual anatomy and status colors

- Ant Design: colored dots carry status semantics — green (success), red (error), blue (in
  progress), gray (pending/disabled); an in-progress last node renders as a loading item
  ([Ant Design, Timeline](https://ant.design/components/timeline)).
- Carbon's status-indicator pattern: icon indicators need "an icon, a shape, a meaningful color,
  and a descriptive inline label" — color alone is never the message; and "avoid using status
  indicators when no user action is required… use plain text to prevent overloading the interface"
  ([Carbon, Status indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)).
  That argues for restraint: only terminal/failure/attention entries get a colored marker; routine
  progress stays neutral.

---

## 3. How best-in-class products present long-running job history

### 3.1 GitHub Actions

Run page = flat list of jobs, each job = flat checklist of **named steps** with ✓/✗/spinner, per-step
duration, currently-running step shown live with a spinner; failed steps auto-expand their logs;
line-linkable ([GitHub Docs](https://docs.github.com/actions/managing-workflow-runs/using-workflow-run-logs)).
Show-vs-hide: step *names* always; step *output* only on expand. Failure labeling: the failed step
is marked at the step level, and the run gets a single terminal verdict.

### 3.2 Vercel

Deployment detail shows build status, "build time, detected framework, and any relevant logs or
errors"; the deployment moves through Queued → Building → Ready/Error states surfaced as a status
chip plus duration, with logs as the drill-down
([Vercel Docs, Deployments](https://vercel.com/docs/deployments)). Same two-layer shape: status +
duration up front, logs behind.

### 3.3 Stripe

Object detail pages carry an events/timeline section — "a record of state changes" read top-down —
one human sentence per event with a timestamp; API-level payloads live in the developer events view
([Stripe Docs, Events](https://docs.stripe.com/development/dashboard/events);
[Stripe Docs, payout Timeline](https://docs.stripe.com/global-payouts/manage-payouts)). Stripe never
shows an empty timeline for an existing object: creation itself is the first event — directly
relevant to the dead-air problem (the `requested` fact should be entry #1, always).

### 3.4 Order tracking (Amazon / Baymard) and Domino's

Baymard's order-tracking research: users want (1) expected delivery date, (2) an order-status
**progress bar of stages**, (3) carrier, (4) linked tracking number, (5) **detailed shipping
history** (the full subevent log), (6) contents summary — i.e. the canonical structure is
**stepper-of-phases on top + detailed event log underneath**; Amazon narrowing the estimate as
status advances was singled out as excellent
([Baymard, Order Tracking UX](https://baymard.com/blog/integrate-tracking-info)).
Domino's Tracker is the canonical staged-progress example — a fixed, always-visible stage bar the
order fills in (originally Order Placed/Prep/Bake/Quality Check/Out for Delivery; simplified in the
2026 refresh to Placed/Make/Deliver/"Mmm!", with a more precise ready-time estimate)
([Domino's press release](https://ir.dominos.com/news-releases/news-release-details/dominosr-updates-its-iconic-industry-first-tracker-even-better)).
The lesson: **the full set of expected stages is visible from second zero** — an empty feed is
impossible by construction because the pending stages *are* the UI.

### 3.5 Sonarr / Radarr / Lidarr (domain neighbors)

Queue (in-flight) and History (settled) are separate views. Queue rows carry live status icons with
tooltip explanations ("yellow — Warning Unable to Import — Review the tool tip for more details");
History rows are icon + event kind (grabbed, imported, failed, deleted, upgraded, renamed) with an
`i` drill-down for technical detail, plus operator verbs on entries ("mark as failed" → blocklist +
re-search) ([Servarr wiki, Activity](https://wiki.servarr.com/sonarr/activity)).
Notable: *arr failure labels are terse and jargon-adjacent — serviceable for operators, but this is
the "mushy machine text" ceiling the app should beat, not the target.

---

## 4. The dead-air problem

- Nielsen's response-time limits: 0.1 s = instantaneous; 1 s = flow intact; "10 seconds is about
  the limit for keeping the user's attention focused on the dialogue", beyond which "percent-done
  progress indicators should be used"
  ([NN/g, Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/)).
  A pipeline that runs minutes-to-hours is far past every threshold: feedback is mandatory from
  the first render.
- Determinate vs indeterminate: looped/indeterminate animation only for 2–10 s waits; for 10 s+
  show determinate progress, and when percent is unknowable, **show steps**: "Instead of showing a
  percentage number, consider showing the number of steps… 'Updating address 3 of 50.'"
  ([NN/g, Progress Indicators](https://www.nngroup.com/articles/progress-indicators/)).
  The pipeline's phases are exactly such steps: a step-based determinate indicator ("stage 2 of 5")
  is right; a bare spinner is wrong.
- Luke Wroblewski: "progress indicators by definition call attention to the fact that someone
  needs to wait"; the fix is to put "the focus … on content being loaded not the fact that its
  loading and that's real progress"
  ([LukeW, Avoid the Spinner](https://www.lukew.com/ff/entry.asp?1797)). Applied here: render the
  timeline skeleton with real facts (the request, the current phase) rather than a spinner or an
  empty message.
- NN/g on skeletons: under 1 s show nothing; spinners for single modules 2–10 s; "progress bars
  are strongly recommended for any page that takes longer that 10 seconds"
  ([NN/g, Skeleton Screens](https://www.nngroup.com/articles/skeleton-screens/)).
- Component support: Ant Design's timeline has first-class support for an **in-progress last node**
  (loading dot) ([Ant Design](https://ant.design/components/timeline)); GitHub Actions shows the
  running step with a spinner inside an otherwise-determinate checklist (§3.1); Domino's shows all
  future stages as pending (§3.4).

**Pattern**: the moment a job exists, its timeline shows (a) the `requested` fact as a completed
entry — it already happened — and (b) the current phase as a pending/in-progress row with a
present-progressive label. "Dead air" is a modeling bug: the downloader's history simply starts
too late (first recorded kind is `selected`), so the view must synthesize the early rows from the
acquisition's status/phase fields it already receives.

---

## 5. Empty and terminal states

- NN/g's three empty-state guidelines: (1) **communicate system status** — say *why* it's empty
  ("There are no records to display for the selected date range"), never leave users wondering "if
  the system is still loading, if an error occurred"; (2) provide learning cues; (3) provide direct
  pathways to action
  ([NN/g, Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/)).
  "Nothing has happened yet." on a FAILED job violates guideline 1 outright: something emphatically
  *has* happened.
- Carbon distinguishes empty-state **types** — first-use/no-data vs user-action feedback vs
  **"error management empty states"** (permissions/system issues), where "a higher level of detail
  and specificity will better support the user"; title copy should be positive-forward ("Start by
  adding data assets" over "You don't have any data assets"), body explains the next action
  ([Carbon, Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/)).
- Primer Blankslate: primary text "should sound welcoming, human, and convey the intention of the
  feature"; secondary text brief; one primary action encouraged
  ([Primer, Blankslate](https://primer.style/components/blankslate)).
- Apple HIG: "An empty screen can be daunting if it isn't obvious what to do next, so guide people
  on actions they can take, and give them a button or link to do so if possible"
  ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- Terminal failures in the feed itself: NN/g error guidelines require the *reason* and
  *constructive advice* (§1.3); GitHub auto-expands the failing step (§2.4); Sonarr's failure rows
  carry the remediation verb (blocklist/re-search) right on the entry (§3.5). A failed job's
  history should therefore **end with an explicit terminal entry** — reason glossed, remediation
  offered — never trail off after the last non-terminal event.

---

## 6. Where sources disagree, and the calls for this app

1. **Relative vs absolute timestamps.** Cloudscape offers both with no auto-switch; UX Movement
   says switch by age; Baymard's shoppers loved precise absolutes. *Call*: hybrid — relative under
   24 h (this is a live feed while running), absolute (`14:32 · 23 Jul 2026`-style, or GOV.UK
   "2:41pm, 23 July" if preferring friendly format) beyond 24 h, and **always** the full absolute in
   `<time datetime title>` (Cloudscape's accessibility pattern). Rationale: while a job runs the
   question is "how long has this been stuck?" (relative wins); a settled acquisition is a record
   consulted later (absolute wins).
2. **Stepper vs feed.** Baymard/Domino's argue for a stage bar; Stripe/Primer argue for a feed.
   *Call*: the feed is the primary component (histories here are branchy — retries, reviews — and
   a fixed stepper lies when a pipeline loops); borrow the stepper's one killer property instead:
   the current phase is always visible as the pending last row. A five-stage summary chip row is a
   possible later enhancement, not the core fix.
3. **Register: playful vs neutral.** Mailchimp/Primer allow warmth; GOV.UK/Apple push austerity,
   and Mailchimp itself says tone follows the reader's stress. *Call*: neutral-warm; zero
   interjections ("oops") per Apple; personality lives in the skins, not the strings.

---

## 7. Recommendations for the acquisition History panel

Each recommendation cites the source(s) it traces to. Entry kinds refer to
`AcquisitionDetail.svelte` / `timeline.ts` as of v3.13.0.

### 7.1 Register rules (the "house style" for timeline strings)

1. Completed entries: past-tense, verb-led sentence fragments, sentence case, no trailing period —
   the "Message sent" register ([Material](https://m1.material.io/style/writing.html); GOV.UK
   sentence case).
2. The in-progress row: present progressive + ellipsis ("Searching sources…") — present tense for
   current behavior ([Material](https://m1.material.io/style/writing.html)).
3. One narrator, no "we", no module prefixes; "you/your" only for user-initiated facts
   ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/writing);
   [GOV.UK](https://www.gov.uk/guidance/style-guide/a-to-z); §2.3).
4. No enum names, no raw floats, no full peer paths in layer-1 text
   ([NN/g error guidelines](https://www.nngroup.com/articles/error-message-guidelines/)); domain
   words the user owns (FLAC, MusicBrainz, beets) are fine
   ([Polaris](https://polaris-react.shopify.com/content/voice-and-tone)).
5. Every failure line = what happened + what happens/can happen next, ≤2 sentences
   ([NN/g](https://www.nngroup.com/articles/error-message-guidelines/); Atlassian §1.3).
6. Consistent verbs across the flow; unambiguous completion language
   ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/writing)).

### 7.2 Proposed entry copy for the full lifecycle

Layer 1 (always visible) below; layer 2 = per-entry disclosure (§7.5). `{…}` are computed glosses.

**Downloader-originated:**

| Kind | Proposed layer-1 copy |
| --- | --- |
| requested *(synthesized first entry)* | `Requested` (the release title is already the page header; "Requested by you" only if multi-user attribution ever matters) |
| metadata resolving *(pending row)* | `Identifying the release…` |
| metadata resolved *(synthesized)* | `Matched to MusicBrainz — {artist}, {album} ({year})` |
| metadata-failed *(terminal)* | `Couldn't identify this release. Nothing was downloaded — check the artist and title, then try again.` |
| searching *(pending row)* | `Searching sources…` |
| `selected` | `Chose a download from {username} — {n} files, {format}` (path → layer 2) |
| downloading *(pending row)* | `Downloading from {username}…` |
| `download-failed` | `Download failed — {gloss(reason)}. Trying the next candidate.` (e.g. `TransferError` → "the transfer was cut off") |
| validating *(pending row)* | `Checking audio quality…` |
| `validation-failed` | `Files failed quality checks — {gloss(reasons)}. Trying the next candidate.` |
| `imported` (hand-off) | `Files staged for import` (staged path → layer 2) |
| `fulfillment-rejected` | `Delivery rejected — {gloss(reasons)}` |
| exhausted *(terminal)* | `No usable download found — every candidate was tried. Try again later, or loosen the quality policy.` |
| conflicted *(terminal)* | `Stopped — this release conflicts with one already in progress.` |
| cancelled *(terminal)* | `Cancelled by you` |
| unknown kind (tolerant reader) | `Something else happened (a newer event this page can't describe yet)` |

**Importer-originated (no `Import` prefix — §2.3):**

| Kind | Proposed layer-1 copy |
| --- | --- |
| `requested` | `Import started` (fixes "Import Import requested") |
| `proposed` | `Compared against the library — {n} candidate match{es}` |
| `auto-apply-selected` | `Confident match — importing automatically ({pct}% match)` where `pct = round((1 − distance) × 100)`; raw distance → layer 2 (extends the v3.8.0 legible-match-review gloss; [NN/g](https://www.nngroup.com/articles/error-message-guidelines/)) |
| `review-required` | `Needs your review — {gloss(reviewKind)}` + link to the review (empty-state guideline 3: direct pathway — [NN/g](https://www.nngroup.com/articles/empty-state-interface-design/)) |
| `review-resolved` | `Review resolved — {gloss(resolution)}` (`reject-unusable-delivery` → "you rejected the files; a new download will be tried") |
| `applied` | `Added to the library` (library path → layer 2) |
| `remediation-required` | `Added to the library, but needs attention` |
| `rejected` | `Import rejected — {gloss(reason)}` |
| `release-verdict-recorded` | `Marked this delivery unusable — retrying the download` |
| unknown kind | `Something else happened during import` |

### 7.3 Timestamps

Every entry gets one. `<time datetime="{iso}" title="{full absolute}">` (Cloudscape pattern);
display relative under 24 h with Cloudscape's granularity ladder ("Now" < 60 s), absolute after;
GOV.UK-style human formats if going friendly ("2:41pm, 23 July 2026"). Add per-phase duration on
terminal/summary rows later if wanted (GitHub shows per-step durations, §3.1).

### 7.4 Grouping

Stay flat-chronological (Ant/Primer/Stripe/Sonarr, §2.2). Keep `mergeTimeline`'s interleaving —
it's already the right model. Phase membership is conveyed by wording and marker styling, not
group headers; entries must stay self-sufficient (Primer accessibility note, §2.2). Marker color
semantics per Ant/Carbon: neutral for routine progress, blue/animated for the pending row, amber
for needs-review, red for failures/terminals, green only for `applied` — and always paired with the
text, never color alone (Carbon, §2.5).

### 7.5 Technical-detail disclosure

Per-entry expandable detail (SLDS/Sonarr `i` pattern, §2.4) holding: peer username + full remote
path, error enum name, validation reason list verbatim, raw distance + penalty breakdown, staged
and library paths, candidate metadata. Failure entries may default open (GitHub, §2.4). Wire with
`aria-expanded`/`aria-controls` (SLDS, §2.3) — `<details>/<summary>` gets this free and fits the
no-JS semantic skeleton.

### 7.6 In-progress affordance

While the acquisition is non-terminal, append exactly one pending row for the current phase
(present-progressive copy from §7.2, animated/blue marker — Ant's loading node, §2.5/§4). This is
the step-based determinate indicator NN/g prescribes for >10 s operations ("step 3 of 5"-class
information) rather than a spinner ([NN/g Progress Indicators](https://www.nngroup.com/articles/progress-indicators/);
[LukeW](https://www.lukew.com/ff/entry.asp?1797)). Since the wire history starts at `selected`,
synthesize the `requested` entry and the current-phase pending row from the status DTO the page
already has.

### 7.7 Empty/failed-state copy

With §7.6, a truly empty timeline becomes unreachable for any existing acquisition (Stripe: the
creation event is entry #1, §3.3). The remaining cases:

- Running, nothing beyond the request yet: `Requested` entry + pending row — never the shrug.
- Failed: history **ends with the terminal entry** from §7.2 (reason + remediation) and the page
  status echoes it; error-management empty states deserve "a higher level of detail and
  specificity" ([Carbon](https://carbondesignsystem.com/patterns/empty-states-pattern/);
  [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/)).
- Importer side unavailable: keep the explicit status line ("The import side of this acquisition
  is currently unavailable.") — that already follows NN/g guideline 1; consider adding when it was
  last reachable.
- Retire the string "Nothing has happened yet." entirely. If a no-entries render path must exist
  defensively, say why + what's next: `No history recorded yet — this page updates as the
  acquisition progresses.`

---

## Sources

**Primary (fetched directly):**

- NN/g — [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) · [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/) · [Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/) · [Progress Indicators](https://www.nngroup.com/articles/progress-indicators/) · [Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/) · [Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Apple Human Interface Guidelines — Writing](https://developer.apple.com/design/human-interface-guidelines/writing) (via Apple's docs JSON endpoint)
- [Material Design — Writing](https://m1.material.io/style/writing.html) (M1 archive; current home: [M3 content design](https://m3.material.io/foundations/content-design/overview))
- [GOV.UK style guide A–Z](https://www.gov.uk/guidance/style-guide/a-to-z)
- [Mailchimp content style guide — Voice and tone](https://styleguide.mailchimp.com/voice-and-tone/)
- [Shopify Polaris — Voice and tone](https://polaris-react.shopify.com/content/voice-and-tone)
- [Cloudscape Design System — Timestamps](https://cloudscape.design/patterns/general/timestamps/)
- [Ant Design — Timeline](https://ant.design/components/timeline)
- GitHub Primer — [Timeline](https://primer.style/components/timeline) and [Blankslate](https://primer.style/components/blankslate) (guidance text via the [primer/design repo](https://github.com/primer/design))
- IBM Carbon — [Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/) and [Status indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/) (via the carbon-website repo)
- [GitHub Docs — Using workflow run logs](https://docs.github.com/actions/managing-workflow-runs/using-workflow-run-logs)
- [Vercel Docs — Deployments](https://vercel.com/docs/deployments)
- [Stripe Docs — Events in the Dashboard](https://docs.stripe.com/development/dashboard/events) · [payout Timeline](https://docs.stripe.com/global-payouts/manage-payouts)
- [Servarr wiki — Sonarr Activity](https://wiki.servarr.com/sonarr/activity) (via the Servarr/Wiki repo)
- [Baymard — Order Tracking UX: 6 Key Details](https://baymard.com/blog/integrate-tracking-info)
- [LukeW — Mobile Design Details: Avoid The Spinner](https://www.lukew.com/ff/entry.asp?1797)
- [Domino's IR — Tracker update press release](https://ir.dominos.com/news-releases/news-release-details/dominosr-updates-its-iconic-industry-first-tracker-even-better)

**Secondary (marked inline where used):**

- [Atlassian Design System — Writing error messages](https://atlassian.design/content/writing-guidelines/writing-error-messages/) (site JS-rendered; verified via search excerpts)
- [Salesforce Lightning Design System — Activity Timeline](https://design-system-site-summer-21.herokuapp.com/components/activity-timeline/) (archived mirror; anatomy via excerpts)
- [UX Movement — Absolute vs. Relative Timestamps](https://uxmovement.com/content/absolute-vs-relative-timestamps-when-to-use-which/)
- Kinneret Yifrah, *Microcopy: The Complete Guide*, 2nd ed. ([listing](https://www.amazon.com/Microcopy-Complete-Guide-Kinneret-Yifrah/dp/B07N1RD7W6)) — method-level attribution only; no page-level excerpt was verifiable
