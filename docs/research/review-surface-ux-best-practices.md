# Review / triage / resolution surface UX — research findings

> Research notes, 2026-08-02 (all URLs accessed that day). Scope: the `/reviews` surface in
> `packages/web` — a queue of imports awaiting human review, plus a detail page offering
> resolution actions (apply a candidate match, import as-is, supply a release ID, reject and
> delete files, manual tags, retry a failed enrichment step).
>
> This file extends [timeline-ux-best-practices.md](timeline-ux-best-practices.md), which
> established the narration register for the acquisition History panel. Where a point is already
> covered there it is cited as `timeline-ux-best-practices.md §n` rather than re-argued; this
> file adds what is specific to **imperative decision surfaces** — buttons, queues, confidence
> displays, and comparison views.
>
> Citation policy: every claim links the source that owns the guidance. Sources that could not
> be fetched first-hand are marked **[secondary]** with how they were verified; sources that were
> unreachable are said to be unreachable rather than paraphrased from memory. Nothing here is
> normative for the codebase until it lands in an OpenSpec change.

---

## §1 — Action-button microcopy

### 1.1 Specific verb over generic label — unanimous across every source

This is the single strongest convergence in the whole survey; five independent primary sources
state it directly:

- **NN/g**: "It's often better to name a button to explain what it does than to use a generic
  label (like 'OK'). An explicit label serves as just-in-time help, giving users more confidence
  in selecting the correct action"
  ([NN/g, OK–Cancel or Cancel–OK?](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)).
- **NN/g confirmation dialogs**: "Instead of Yes/No answers, provide response options that
  summarize what will happen for each possible response… in the case of file deletion, use
  buttons labeled *Delete file* and *Keep file*"
  ([NN/g, Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/)).
- **Apple HIG (Alerts)**: "Avoid using OK as the default button title unless the alert is purely
  informational. The meaning of 'OK' can be unclear… does 'OK' mean 'OK, I want to complete the
  action' or 'OK, I now understand the negative results my action would have caused'? A specific
  button title like 'Erase,' 'Convert,' 'Clear,' or 'Delete' helps people understand the action
  they're taking" ([Apple HIG, Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts),
  via Apple's docs JSON endpoint).
- **Material (M1 Dialogs)**: use "descriptive verbs, such as: save, send, share, update or
  create. Don't use vague actions for confirming action, such as: done, ok or close"; "The
  affirmative action text 'Discard' clearly indicates the outcome of the decision," whereas "No"
  fails because it "does not suggest what will happen afterwards"
  ([Material Design, Dialogs (M1 archive)](https://m1.material.io/components/dialogs.html) —
  the current M3 buttons/dialogs pages are JS-rendered and could not be fetched first-hand;
  search excerpts confirm M3 keeps sentence-case, concise, verb-led labels **[secondary]**).
- **Carbon (Modal)**: use "active words that describe the purpose of the modal, such as Add,
  Delete, and Save," and avoid "vague or passive words, such as Done or OK"
  ([Carbon, Modal usage](https://carbondesignsystem.com/components/modal/usage/), guidance text
  via the carbon-website repo).

### 1.2 Imperative verb-led structure, sentence case, verb + noun

- GOV.UK: "Write button text in sentence case, describing the action it performs" — examples are
  all verb-led imperatives ('Start now', 'Save and continue', 'Confirm and send'), and the
  guidance explicitly endorses widening the label for specificity: "You may need to include more
  or different words to better describe the action. For example, 'Add another address' and
  'Accept and claim a tax refund'"
  ([GOV.UK Design System, Button](https://design-system.service.gov.uk/components/button/)).
- Carbon gives the formula outright: "use the {verb} + {noun} content formula on buttons except
  in the case of common actions like 'Done', 'Close', 'Cancel', 'Add', or 'Delete'"; "By default
  Carbon uses sentence case for all button labels"; overflowing labels wrap rather than truncate
  ([Carbon, Button usage](https://carbondesignsystem.com/components/button/usage/)).
- Apple HIG (Buttons): "Consider starting the label with a verb to help convey the button's
  action — for example… 'Add to Cart'"; "write a few words that succinctly describe what the
  button does" ([Apple HIG, Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).
- Apple HIG (Alerts) on length: "Aim for a one- or two-word title that describes the result of
  selecting the button. Prefer verbs and verb phrases that relate directly to the alert text."
- Polaris: "Start sentences with verbs so they feel like actionable instructions", "Be direct
  ('add apps' not 'you can add apps')"
  ([Polaris, Voice and tone](https://polaris-react.shopify.com/content/voice-and-tone)).
- SLDS **[secondary — lightningdesignsystem.com is JS-rendered; verified via search excerpts]**:
  a button's accessible name should be "a clear call to action, for example, 'Edit record'"; the
  destructive (red) button variant exists to "warn users that its action has a negative effect,"
  and "if you use the destructive button… make sure that the text communicates the same message"
  ([SLDS 2, Button](https://www.lightningdesignsystem.com/2e1ef8501/p/7733f8-buttons);
  [Lightning component reference, Button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button.html)).

**Net rule**: labels are short imperative fragments, sentence case, verb-first; generic verbs
(Done/OK/Confirm/Yes) are reserved for the handful of conventional actions Carbon lists, and any
action with an object names the object ("Reject files", not "Reject", never "OK").

### 1.3 Communicating consequences — where the consequence text lives

No surveyed system puts consequences in a parenthetical inside the label. The pattern everywhere
is a two-part anatomy: **the label carries the verb + its object; the surrounding copy (dialog
title, supporting text, warning text) carries the consequence** — and the two must agree:

- Carbon: "Clearly describe the action being confirmed and explain any potential consequences
  that it may cause" (modal body), and "Both the title and the button should reflect the action
  that will occur" ([Carbon, Modal usage](https://carbondesignsystem.com/components/modal/usage/)).
- NN/g: "Be specific and inform users about the consequence of their action. Do not ask 'Are you
  sure you want to do this?'" ([NN/g, Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)).
- GOV.UK: "Do not only rely on the red colour of a warning button to communicate the serious
  nature of the action… Make sure the context and button text make clear what will happen"
  ([GOV.UK, Button](https://design-system.service.gov.uk/components/button/)).
- Apple HIG (Alerts): button titles must "relate directly to the alert text" — the consequence
  is stated in the alert message, the button restates only the outcome verb.
- Apple's ellipsis convention marks the *other* kind of consequence — needing further input:
  "Append a trailing ellipsis to the title when a push button opens another window, view, or
  app… an ellipsis in a control title signals that people can provide additional input"
  ([Apple HIG, Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).
  Relevant to actions like *supply a release ID* that open a form rather than commit immediately.

### 1.4 Destructive actions: emphasis, confirmation, undo

- **Emphasis**: "Don't assign the primary role to a button that performs a destructive action,
  even if that action is the most likely choice. Because of its visual prominence, people
  sometimes choose a primary button without reading it first"
  ([Apple HIG, Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)).
  Carbon grades danger emphasis by role: "Destructive actions that are a required or primary
  step in a workflow should use the primary danger button style," but "if a destructive action
  is just one of several actions a user could choose from, then a lower emphasis style like the
  tertiary danger button or the ghost danger button may be more appropriate"
  ([Carbon, Button usage](https://carbondesignsystem.com/components/button/usage/)) — the exact
  situation of "Reject and delete files" sitting among five other resolutions.
- **When to confirm**: "Use a confirmation dialog before committing to actions with serious
  consequences — such as destroying users' work… In particular, consider a confirmation dialog
  before actions that cannot be undone," and never for routine actions: "if you cry wolf too
  many times, people will stop paying attention"
  ([NN/g, Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)).
  GOV.UK reserves the warning treatment for "actions with serious destructive consequences that
  cannot be easily undone" and advises "an additional step which asks them to confirm it"
  ([GOV.UK, Button](https://design-system.service.gov.uk/components/button/)); a dedicated
  GOV.UK "Confirm an action" pattern is still an open backlog item ("Ask users to confirm that
  they want to perform a serious or irreversible action… Not yet available")
  ([govuk-design-system-backlog #9](https://github.com/alphagov/govuk-design-system-backlog/issues/9)).
  Carbon ships this as a component variant: "Danger modal is a specific kind of transactional
  modal used for destructive or irreversible actions… a confirmation for an action that would
  result in a significant data loss if done accidentally"
  ([Carbon, Modal usage](https://carbondesignsystem.com/components/modal/usage/)).
- **The confirm step's own buttons** repeat §1.1: outcome-summarizing options ("Delete file" /
  "Keep file" — NN/g), plus a safe exit: "If there's a destructive action, include a Cancel
  button to give people a clear, safe way to avoid the action. Always use the title 'Cancel'"
  ([Apple HIG, Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)).
  Note Apple's subtlety: the destructive *style* marks a destructive action "people didn't
  deliberately choose"; when the person deliberately chose it (Empty Trash), the confirming
  button keeps normal styling because it "performs the person's original intent."
- **Undo beats confirmation where feasible**: "Do go to great lengths to provide undo, because
  some user errors will remain despite even the best of confirmation dialogs"
  ([NN/g, Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/));
  "It's a good idea to give users a visible option to undo an action on the UI," and cancel/exit
  affordances must be "easy to find and quick to execute"
  ([NN/g, User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/)).
  For file deletion that is genuinely irreversible, undo is unavailable by definition — which is
  precisely NN/g's and GOV.UK's trigger condition for a real confirmation step.

---

## §2 — Titling and summarizing review/triage items

### 2.1 The general rule: a title is an ultrashort plain-language abstract

NN/g on microcontent (headlines, page titles, list rows): a title "should be an ultrashort
abstract of its associated content, written in plain language, with no puns"; "Move the keywords
to the front of the title… to support scanning"; and it must survive decontextualization —
"Headline text has to stand on its own and make sense when the rest of the content is not
available" ([NN/g, Microcontent: How to Write Headlines, Page Titles, and Subject Lines](https://www.nngroup.com/articles/microcontent-how-to-write-headlines-page-titles-and-subject-lines/)).
A file path or internal ID fails all three tests: it front-loads noise (`/downloads/staging/…`),
is not plain language, and describes storage, not content.

### 2.2 Triage-queue precedents: rows are titled by the human subject, identifiers demoted

- **Stripe's manual-review queue** (the closest "human resolves a flagged item" precedent): the
  list view leads with human decision facts — "the risk level Stripe assigns…, the customer
  name, payment method information, customer information, the amount, date, and time of the
  payment" ([Stripe Docs, Reviews](https://docs.stripe.com/radar/reviews)). The payment's opaque
  ID appears only once you "select the payment within the review queue to view its details page."
- **GitHub notifications inbox**: rows are the conversation (issue/PR title + repository), with
  the triage-relevant metadata as a label: "Your inbox shows the reason you're receiving a
  notification as a label, such as, mention, subscribed, or review requested"
  ([GitHub Docs, About notifications](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/about-notifications)).
- **Gmail** [product observation — anatomy confirmed only via help-center material]: the row is
  sender + subject + snippet; no message ID is ever shown
  ([Gmail Help, View & find email](https://support.google.com/mail/answer/9259955)).
- **Lidarr manual import** (the direct domain precedent — a music importer asking a human to
  match files to releases): the modal is titled by the *download*, not a path when a better name
  exists — the title template is `Manual Import - {title || folder}` — and each row carries the
  parsed musical identity right after the path: columns run
  `Path → Artist → Album → Tracks → Release Group → Quality → Size → Custom Formats → Indexer
  Flags → Rejections`
  ([Lidarr source, InteractiveImportModalContent.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/InteractiveImport/Interactive/InteractiveImportModalContent.js)).
  Its interactive-search rows are titled by the parsed release **Title** (columns:
  Source, Age, Title, Indexer, Size, Peers, Quality, …)
  ([Lidarr source, InteractiveSearch.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/InteractiveSearch/InteractiveSearch.js)).
  Note the nuance: the *arr path column leads inside the import table because there the path is
  the **evidence being matched**; the surface itself is named by the release. Sonarr's queue
  reaches manual import through a per-row action ("Manual Import Release")
  ([Servarr wiki, Sonarr Activity](https://wiki.servarr.com/sonarr/activity)).
- **Picard** titles its album pane entries by the release ([timeline-ux-best-practices.md §3.5
  for the broader *arr/Picard survey]); files appear under the tracks they are matched to.

**Net rule**: a review queue row and its detail page are titled by what the item *is* in the
user's world — artist — album (the musical intent) — front-loaded per NN/g; the staged path and
any internal review/acquisition IDs are supporting evidence (§4), never the title. This also
matches the repo's existing precedent: the acquisition detail page is already titled by the
release, and the timeline narrates in intent language (timeline-ux-best-practices.md §2.3, §7.2).

---

## §3 — Presenting match confidence to non-expert users

### 3.1 What the domain tools actually show

- **beets** (the engine behind this importer) computes *distance* internally but presents users
  a **similarity percentage, higher-is-better**, with an explicit gloss: "Similarity is a
  measure of how well-matched beets thinks a tagging option is. 100% similarity means a perfect
  match and 0% indicates a truly horrible match"
  ([beets docs, The tagger](https://beets.readthedocs.io/en/stable/guides/tagger.html)).
  The inversion (distance → similarity) happens at the presentation boundary — exactly the gloss
  this repo already adopted for auto-apply copy (timeline-ux-best-practices.md §7.2:
  `pct = round((1 − distance) × 100)`).
- **MusicBrainz Picard** shows **no number at all** for match quality — a four-step color scale:
  "The order is green > yellow > orange > red, where green is the best match," with the advice
  that lots of red/orange means Picard guessed wrong or had little metadata to work with; the
  user then verifies by comparing Original vs New values (§5)
  ([Picard docs, Matching Files to Tracks](https://picard-docs.musicbrainz.org/en/latest/usage/match.html)).
- **Sonarr/Lidarr/Radarr** show no match-confidence number either: candidate rows carry a
  *policy* score (custom-format score) plus **binary rejections with reasons** behind a danger
  icon ([Lidarr source, InteractiveSearch.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/InteractiveSearch/InteractiveSearch.js);
  timeline-ux-best-practices.md §3.5). Match/no-match is communicated as *reasons*, not degrees.

So among the three closest products, the presentation ladder is: reasons only (*arr) →
categorical color (Picard) → glossed higher-is-better percentage (beets). **No product surfaces
a raw distance, penalty float, or lower-is-better number to end users.**

### 3.2 What research says about confidence displays

No NN/g article specifically on displaying match/AI confidence was found (searched 2026-08-02;
saying so per method policy). Peer-reviewed HCI work fills the gap:

- Displaying a confidence score helps only when calibrated: "miscalibrated AI confidence impairs
  users' appropriate reliance" and "AI miscalibration is difficult for users to detect" — users
  largely cannot tell when a shown percentage is overconfident, and disclosing poor calibration
  produces under-reliance instead of better decisions
  ([Understanding the Effects of Miscalibrated AI Confidence…, arXiv:2402.07632](https://arxiv.org/abs/2402.07632)).
- A UMAP 2025 study found interfaces with confidence ratings improved users' task accuracy, but
  "the majority of participants deemed AI's confidence calibration appropriate even when the AI
  was overconfident or underconfident, suggesting overtrust"
  ([The Impact of Confidence Ratings on User Trust in LLMs, ACM UMAP Adjunct 2025](https://dl.acm.org/doi/10.1145/3708319.3734178)
  **[secondary — paywalled; findings via abstract/search excerpts]**).
- Van der Bles et al. on communicating uncertainty (Royal Society Open Science, rsos.181870) was
  **unreachable** (HTTP 403); it is not cited for any claim here.

**Implication**: a percentage invites more trust than the underlying model warrants; a
two-decimal or raw-float display implies precision beets itself does not claim. The safe shape,
supported by the product ladder in §3.1, is a **coarse, higher-is-better presentation** —
category word and/or rounded percent ("Strong match — 94%"), with the raw distance and per-field
penalty breakdown as layer-2 evidence (§4) — and per Carbon's status-indicator rule, any color
encoding must be paired with the text, never color alone (timeline-ux-best-practices.md §2.5).

---

## §4 — Progressive disclosure of diagnostics on decision surfaces

Baseline (already established, not repeated): hide codes/raw internals behind per-entry
disclosure, failure detail may default open, `<details>/<summary>` fits the semantic skeleton —
timeline-ux-best-practices.md §1.3, §2.4, §7.5. What is *added* here is the decision-surface
question: does hiding material behind disclosure harm the decision?

- NN/g's own split criterion answers it: "You have to disclose everything that users frequently
  need up front, so that they have to progress to the secondary display only on rare occasions,"
  and levels beyond two lose people: "Designs that go beyond 2 disclosure levels typically have
  low usability" ([NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).
  On a review page the thing "frequently needed" is the **decision evidence** — the proposed
  changes, the penalty gloss, the candidate list. Those are layer 1. What is *rarely* needed to
  decide — raw distance floats, MusicBrainz release IDs, staged paths, enum names — is layer 2.
- The disclosure affordance itself must predict its contents: "Users choose those with the
  highest information scent — which is a mix of cues that they get from the link label, the
  context in which the link is shown, and their prior experiences," and "if the link name is too
  obscure and vague, people might miss a good source of information"
  ([NN/g, Information Scent](https://www.nngroup.com/articles/information-scent/)). A summary
  reading "Details" is weak scent; "Matching details — raw score and penalties" is strong scent.
- **GitHub's files-changed collapse** shows disclosure driven by the *reviewer's own judgment*,
  not the system's: "After you finish reviewing a file, you can mark the file as viewed. The
  file will collapse," and — the decision-integrity safeguard — "If the file changes after you
  view the file, it will be unmarked as viewed"
  ([GitHub Docs, Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)).
  Evidence collapses only after it has been seen, and un-collapses when it goes stale.
- **Stripe** keeps decisive evidence inline on the review detail page ("The risk insights
  section… identifies some of the most relevant risk factors, along with some key data points
  that can help assess fraud") while secondary context (metadata, related payments) sits below
  as supporting sections a reviewer "might" consult
  ([Stripe Docs, Reviews](https://docs.stripe.com/radar/reviews)).

**Net rule for decision surfaces**: the frequency criterion becomes a *decision-relevance*
criterion — anything the resolution verbs operate on must be visible without interaction;
disclosure is for provenance and raw internals; one disclosure level; summaries carry scent.

---

## §5 — Comparison/diff UIs for metadata (current vs proposed tags)

- **NN/g comparison tables**: comparison supports "compensatory decision making, in which people
  engage only when they have relatively few alternatives to consider" — keep the compared set
  to ~5 or fewer (dynamic tables: 3–4); standard layout is options as columns, attributes as
  rows; keep cell text short; and let users isolate what differs — "Users could easily identify
  differences… by selecting the Highlight Differences switch," or hide rows where all offerings
  are identical ([NN/g, Comparison Tables](https://www.nngroup.com/articles/comparison-tables/)).
  Mapped to a match review: fields are the rows, "currently tagged" and "candidate" are the two
  columns, and unchanged fields are noise to suppress or de-emphasize.
- **Picard** is the direct precedent for the two-column form: "a three-column table of the tag
  metadata… The first column shows the tag name, the second shows the original value found in
  the file, and the third column shows the new value that will be written"
  ([Picard docs, Main Screen](https://picard-docs.musicbrainz.org/en/latest/getting_started/screen_main.html)).
  Its known weakness is instructive: users report that "small differences (such as typographic
  characters or missing characters) can be hard to detect" and ask for better in-field
  comparison ([MetaBrainz forum feature request](https://community.metabrainz.org/t/better-comparison-of-original-and-new-value-feature-request/494353))
  — i.e., a value-pair table without change *highlighting* under-serves near-identical strings,
  which are the common case in music metadata.
- **beets** solves that by showing **only the changed fields**, as aligned old → new pairs
  (`* Last One Standing -> The Last One Standing`), one line per difference
  ([beets docs, The tagger](https://beets.readthedocs.io/en/stable/guides/tagger.html)) — the
  CLI equivalent of NN/g's "hide identical rows."
- **GitHub diffs**: unified vs split is offered as a persistent *user preference*, not a house
  decision ("choose the unified or split view… The choice you make will apply when you view the
  diff for other pull requests"), and trivial differences can be suppressed ("You can also hide
  whitespace differences")
  ([GitHub Docs, Reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)).
  The whitespace toggle's lesson for tags: case-only or punctuation-only churn deserves either
  de-emphasis or explicit marking, not equal visual weight.
- Direction must be encoded redundantly: an arrow/label plus any color, never color alone —
  Carbon's status-indicator rule (timeline-ux-best-practices.md §2.5). The repo's v3.8.0
  legible match-review work (per-track diff, glossed penalties) is the in-house precedent this
  section extends, not replaces.

---

## §6 — Label ↔ log consistency (the button's verb returns in the narration)

- **Heuristic grounding**: "The system should speak the users' language, with words, phrases,
  and concepts familiar to the user, rather than system-oriented terms"
  ([NN/g, Match Between the System and the Real World](https://www.nngroup.com/articles/match-system-real-world/)) —
  and once a word is chosen it must stay chosen: internal consistency across a product is what
  builds user confidence and "mastery over the interface"
  ([NN/g, Consistency and Standards](https://www.nngroup.com/articles/consistency-and-standards/);
  note: that article grounds consistency mostly in visual/structural terms — the terminology
  application here is an inference from the heuristic, flagged honestly). GOV.UK's style guide
  mandates the same-words discipline for content generally (timeline-ux-best-practices.md §1.2).
- **Within one surface**: Carbon makes the echo a rule at modal scope — "Both the title and the
  button should reflect the action that will occur"
  ([Carbon, Modal usage](https://carbondesignsystem.com/components/modal/usage/)). SLDS likewise:
  destructive styling and "the text" must communicate "the same message" (§1.2 source).
- **Button → toast**: Polaris's toast guidance is the cleanest primary statement that the
  confirmation re-uses the action's own words, tense-shifted: toasts are "noun + verb" pairs of
  at most ~3 words that mirror the completed action — do: "Product updated", "Collection added";
  don't: "Your product has been successfully updated"
  ([Polaris, Toast component content guidelines](https://polaris-react.shopify.com/components/feedback-indicators/toast)).
  The verb the button promised ("Update product") is the verb the toast reports ("Product
  updated").
- **Button → audit log**: GitHub is the live end-to-end precedent. The review actions are named
  **Comment / Approve / Request changes** ("Request changes: Flags feedback that the author
  should address before merging"), and "review conversations appear in the pull request timeline"
  ([GitHub Docs, About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) —
  where the entry reads "*username* requested changes" [product observation of github.com,
  2026-08-02]: the imperative label ("Request changes") returns as the past-tense narration
  ("requested changes"), same verb, same object, only the tense moved.
- **In this repo** the receiving side of the echo already exists: the timeline narrates
  review resolutions in glossed past tense ("Review resolved — you rejected the files; a new
  download will be tried", timeline-ux-best-practices.md §7.2). The button that *causes* that
  entry must be built from the same verb ("Reject files"), or the two surfaces teach two
  vocabularies for one fact — precisely the inconsistency the heuristic and the GOV.UK
  same-words rule prohibit.

---

## §7 — Implications for the /reviews register (synthesis)

Everything below is **synthesis** — candidate rules derived from §1–§6, separated from the
evidence above. These extend, and never override, the narration register already established in
timeline-ux-best-practices.md §7.1.

1. **Imperative verb-led labels, sentence case.** Every resolution action is a short imperative
   fragment starting with a specific verb; verb + noun when the verb alone is ambiguous
   ("Apply this match", "Import as-is", "Reject files", "Retry lookup"). Never OK / Confirm /
   Yes / Done as a resolution label. (§1.1–§1.2)
2. **Destructive verbs name their object.** The label for the destructive resolution says what
   dies: "Reject and delete files" (or "Delete the files" on the confirm step) — never a bare
   "Reject" whose file-deletion side effect lives only in a tooltip. (§1.1, §1.3, §1.4)
3. **Consequence after an em-dash or in supporting text — never a parenthesized aside.** The
   label stays verb + object; the consequence sentence sits beside/beneath it in the register's
   existing em-dash compound form ("Reject and delete files — the download will be retried"), or
   in the confirm step's body text. Label and consequence text must agree. (§1.3)
4. **Confirm only the irreversible; make the confirm step earn its keep.** File deletion gets a
   two-step confirm (it cannot be undone); no other resolution does — habituation is real. The
   confirm step states the specific consequence and offers outcome-named choices
   ("Delete the files" / "Keep the files") plus nothing labeled "Are you sure?". Undo is
   preferred over confirmation wherever the action is actually reversible. (§1.4)
5. **Danger emphasis is graded.** The destructive resolution renders in the danger style but at
   low emphasis (it is one of several choices), and is never the visually primary action of the
   page. (§1.4)
6. **Actions that open a form take a trailing ellipsis.** "Supply a release ID…", "Edit tags
   manually…" — the ellipsis promises further input, not an immediate commit. (§1.3)
7. **Queue rows and detail pages are titled by the musical intent** — artist — album, keywords
   front-loaded, meaningful out of context. The staged path, review kind, and IDs are metadata
   and evidence, never the title. (§2)
8. **Confidence is coarse, glossed, higher-is-better.** Category word plus rounded percent at
   most ("Strong match — 94%"); never a raw distance, never a lower-is-better number, never
   float precision; raw distance and penalties live in layer-2 disclosure. Any confidence color
   is paired with text. (§3)
9. **Decision evidence is never behind disclosure.** Whatever the resolution verbs act on — the
   tag diff, the candidate list, the penalty gloss, the failure gloss — is visible without
   interaction. Disclosure (one level, strong-scent summaries) holds provenance and raw
   internals: distance floats, MBIDs, staged paths, enum names. (§4)
10. **The tag comparison is a field-rows × two-columns diff that shows differences.** Current vs
    proposed as columns, fields as rows, unchanged fields suppressed or de-emphasized, changed
    values marked with an explicit direction cue (arrow), near-identical strings highlighted at
    the character/word level. (§5)
11. **One verb per action across button → confirmation → toast/flash → timeline.** The imperative
    label's verb is the same verb, tense-shifted to the narration register's past-tense form, in
    every later retelling: "Reject and delete files" ⇒ "Files rejected and deleted — a new
    download will be tried". Choosing a button verb is choosing a timeline verb; the copy
    register maintains a single verb inventory for both. (§6)

---

## Sources

**Primary (fetched directly, 2026-08-02):**

- NN/g — [OK–Cancel or Cancel–OK?](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/) · [Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/) · [User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/) · [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Information Scent](https://www.nngroup.com/articles/information-scent/) · [Comparison Tables](https://www.nngroup.com/articles/comparison-tables/) · [Microcontent](https://www.nngroup.com/articles/microcontent-how-to-write-headlines-page-titles-and-subject-lines/) · [Match Between the System and the Real World](https://www.nngroup.com/articles/match-system-real-world/) · [Consistency and Standards](https://www.nngroup.com/articles/consistency-and-standards/)
- Apple HIG — [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) · [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) (both via Apple's docs JSON endpoint)
- [Material Design — Dialogs (M1 archive)](https://m1.material.io/components/dialogs.html)
- [GOV.UK Design System — Button](https://design-system.service.gov.uk/components/button/) · [govuk-design-system-backlog #9 "Confirm an action"](https://github.com/alphagov/govuk-design-system-backlog/issues/9) (via GitHub API)
- IBM Carbon — [Button usage](https://carbondesignsystem.com/components/button/usage/) · [Modal usage](https://carbondesignsystem.com/components/modal/usage/) (via the carbon-website repo)
- Shopify Polaris — [Voice and tone](https://polaris-react.shopify.com/content/voice-and-tone) · [Toast content guidelines](https://polaris-react.shopify.com/components/feedback-indicators/toast)
- [Stripe Docs — Reviews (Radar)](https://docs.stripe.com/radar/reviews)
- GitHub Docs — [About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews) · [Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) · [About notifications](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/about-notifications)
- beets — [The tagger guide](https://beets.readthedocs.io/en/stable/guides/tagger.html)
- MusicBrainz Picard docs — [Matching Files to Tracks](https://picard-docs.musicbrainz.org/en/latest/usage/match.html) · [Main Screen](https://picard-docs.musicbrainz.org/en/latest/getting_started/screen_main.html)
- Lidarr source — [InteractiveImportModalContent.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/InteractiveImport/Interactive/InteractiveImportModalContent.js) · [InteractiveSearch.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/InteractiveSearch/InteractiveSearch.js) (raw files)
- [Servarr wiki — Sonarr Activity](https://wiki.servarr.com/sonarr/activity) (via the Servarr/Wiki repo)
- [arXiv:2402.07632 — Understanding the Effects of Miscalibrated AI Confidence](https://arxiv.org/abs/2402.07632)
- [MetaBrainz forum — Better comparison of Original and New Value](https://community.metabrainz.org/t/better-comparison-of-original-and-new-value-feature-request/494353)

**Secondary (marked inline where used):**

- SLDS — [Button (SLDS 2)](https://www.lightningdesignsystem.com/2e1ef8501/p/7733f8-buttons) and [Lightning component reference, Button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button.html) (JS-rendered; verified via search excerpts)
- Material Design 3 — [Buttons guidelines](https://m3.material.io/components/buttons/guidelines) (JS-rendered; label rules verified via search excerpts; M1 dialogs used as the fetchable primary)
- [ACM UMAP Adjunct 2025 — The Impact of Confidence Ratings on User Trust in LLMs](https://dl.acm.org/doi/10.1145/3708319.3734178) (paywalled; abstract-level only)
- [Gmail Help — View & find email](https://support.google.com/mail/answer/9259955) (product observation support)

**Unreachable (not cited for claims):** Van der Bles et al., *Communicating uncertainty about
facts, numbers and science*, R. Soc. Open Sci. (royalsocietypublishing.org returned HTTP 403).
