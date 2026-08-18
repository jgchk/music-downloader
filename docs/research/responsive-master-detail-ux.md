# Responsive master-detail (list-detail) layouts on small screens — research findings

> Research notes, 2026-08-18 (all URLs accessed that day). Scope: the `/acquisitions` shell in
> `packages/web` — a queue list (master) beside a detail pane that renders either an acquisition's
> detail page (`/acquisitions/<id>`) or the request form (`/acquisitions/new`). The question under
> study: what should this layout do below the two-column breakpoint — today the panes stack
> vertically (queue on top, detail/form below), and the alternatives are a global DOM-order flip
> (detail first) or a single-pane route-based collapse.
>
> This file borders [timeline-ux-best-practices.md](timeline-ux-best-practices.md) (the History
> panel *inside* the detail pane) and
> [review-surface-ux-best-practices.md](review-surface-ux-best-practices.md) (the `/reviews`
> queue+detail surface, which shares this exact layout problem and should inherit whatever
> pattern is adopted here). Neither sibling covers the pane-collapse question; this file does not
> re-cover their territory (timeline register, action-button copy).
>
> Citation policy: every claim links the source that owns the guidance. Sources that could not be
> fetched first-hand are marked **[secondary]** with how they were verified; unreachable sources
> are named as unreachable rather than paraphrased from memory. Nothing here is normative for the
> codebase until it lands in an OpenSpec change.

---

## 1. The attested pattern: single-pane collapse, and what it's called

Every platform vendor that documents this layout documents the same small-screen behavior —
**one pane at a time, list first, drill down to detail, back returns to the list** — and none
documents any other small-screen behavior.

- **Google / Material 3** names it the **"List-detail"** canonical layout: "List-detail is a UI
  pattern that consists of a dual-pane layout where one pane presents a list of items and another
  pane displays the details of items selected from the list." On window size: "In large windows,
  the list and detail panes appear side by side. In small windows, only one pane is visible at a
  time, switching as users navigate"
  ([Android developers, List-detail](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)).
  The canonical-layouts overview is explicit about the choreography: "Medium- and compact-width
  displays show either the list or the detail, depending on user interaction with the app. When
  just the list is visible, selection of a list item displays the detail in place of the list.
  When just the detail is visible, pressing the back button redisplays the list"
  ([Android developers, Canonical layouts](https://developer.android.com/guide/topics/large-screens/large-screen-canonical-layouts)).
  (The m3.material.io list-detail page itself returned 404 at access time; the Android developer
  pages are the same owner's current home for the guidance.)
- **Microsoft** names it **"List/details"** and gives the two responsive styles by name with a
  numeric breakpoint: "we recommend that you use either the stacked style or the side-by-side
  style, based on the amount of available screen space" — 320–640 epx → stacked, ≥641 epx →
  side-by-side. Crucially, Microsoft's "stacked" is *not* both-panes-on-one-page: "In the stacked
  style, **only one pane is visible at a time**: the list or the details. The user starts at the
  list pane and 'drills down' to the details pane by selecting an item in the list. To the user,
  it appears as though the list and details views exist on two separate pages," and the
  recommended implementation is literally "separate pages for the list pane and the details pane"
  ([Microsoft Learn, List/details](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details)).
- **Apple** covers it as the **split view**: "Typically, you use a split view to show multiple
  levels of your app's hierarchy at once and support navigation between them," and "Prefer using
  a split view in a regular — not a compact — environment," because compact widths make it
  "difficult to display multiple panes without wrapping or truncating the content" — i.e. on
  iPhone-class widths the same hierarchy is presented as a navigation stack, not adjacent panes
  **[secondary — Apple's HIG site is JS-rendered and its JSON endpoint 404'd; quotes taken from a
  verbatim mirror of the HIG "Split views" page](https://raw.githubusercontent.com/tmaasen/apple-dev-mcp/b82f0efe2115dc4539c83a2374a714a84aeb350a/content/universal/split-views.md)**.
  Apple also adds the desktop-side obligation the collapse pattern pairs with: "persistently
  highlight the current selection in each pane that leads to the detail view" (same source).
- **SAP Fiori**'s **flexible column layout** (the enterprise master-detail floorplan) "behaves
  responsively … depending on the available screen width, an optimized layout is loaded," with
  phone-width presentations showing a single column at a time and full-screen pages carrying a
  back icon that walks back up the column stack **[secondary — experience.sap.com and
  sap.com/design-system returned 403; behavior verified via search excerpts of the design-system
  pages and the SAP-docs/sapui5 repo](https://www.sap.com/design-system/fiori-design-web/page-types/page-layouts/flexible-column-layout/)**.
- **Microsoft's dual-screen list-detail guidance** (archived but explicit) shows the same reflex
  even when *two physical screens* merge into one wide view: when the device rotates so only one
  screen-width remains per view, the "Do" is "Display details … (with a back button to return to
  the list)" and the "Don't" is keeping both panes
  ([Microsoft Learn, List detail dual-screen](https://learn.microsoft.com/en-us/dual-screen/design/list-detail)).

**Answer to sub-question 1**: yes — single-pane collapse with back navigation is the attested
standard, unanimously, across four independent platform owners. The names to use: **list-detail**
(Google/Material), **list/details — stacked style** (Microsoft), **split view that collapses to a
navigation stack** (Apple), **flexible column layout** (SAP). The native mobile navigation stack
(iOS `UISplitViewController` collapse, Android `NavigableListDetailPaneScaffold` back handling)
is the same problem shape solved the same way — the Android doc's back-behavior options
(`PopUntilScaffoldValueChange` etc.) exist precisely because "detail replaces list, back restores
list" is the expected contract
([Android developers, List-detail](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)).

## 2. Stacking both panes vertically: what the record shows

No surveyed source recommends rendering the full list *and* the full detail on one small-screen
page. The claim sometimes heard that "stacking is the standard responsive move" comes from
conflating two different things:

- **Content-column stacking** (Luke Wroblewski's "Mostly Fluid" / "Column Drop" multi-device
  patterns, where a marketing page's columns stack "vertically in its narrowest incarnations")
  applies to *equivalent content columns*, not to a navigational master pane and its dependent
  detail pane; his survey "does not discuss two-pane list/detail interfaces" at all, and he
  singles out the Off Canvas pattern approvingly precisely because "it doesn't force people to
  scroll long pages of content and navigation on small screens"
  ([LukeW, Multi-Device Layout Patterns](https://www.lukew.com/ff/entry.asp?1514)).
- **Microsoft's "stacked style"** is, per §1, one-pane-at-a-time on separate pages — the opposite
  of both-panes-stacked
  ([Microsoft Learn, List/details](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details)).

No source documents both-panes-stacked as a named anti-pattern either — it is simply absent from
the pattern literature. The nearest indictments are indirect but pointed: a navigation pane above
the content forces the scroll-past cost LukeW calls out (above); "Mobile devices require software
development teams to focus on only the most important data and actions … There simply isn't room
in a 320 by 480 pixel screen for extraneous, unnecessary elements"
([LukeW, Mobile First](https://www.lukew.com/ff/entry.asp?933)); and NN/g finds long single pages
on mobile "problematic" — "limited screen size … can lead to long pages demanding excessive
scrolling"
([NN/g, In-Page Links for Content Navigation](https://www.nngroup.com/articles/in-page-links-content-navigation/)).

**Answer to sub-question 2**: stacking both panes has no attestation as a master-detail
adaptation; the field's answer to "the panes don't fit" is pane selection, not pane stacking.

## 3. Back affordance on the web

- Browser back is a hard contract: "Whenever users click a link to open a new page, screen or
  view, they should always be able to go back to where they came from"; users default to the
  browser's Back button over site-provided navigation
  ([NN/g, User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/)).
  Baymard's testing sharpens it: "users expect the browser 'Back' button to bring them back to
  what they *perceived* to be their previous page," and mobile users lean on it hardest; sites
  whose view changes aren't history entries should "use `history.pushState()` to create a new
  entry … for any view that the user will perceive as a new page"
  ([Baymard, Back Button Expectations](https://baymard.com/blog/back-button-expectations)).
  A route-based collapse (each pane a real URL) satisfies this natively with zero JS — the views
  *are* pages.
- Browser back alone is not enough: GOV.UK ships an explicit in-page back link on every question
  page because "Although browsers have a back button, some sites break when you use it - so many
  users avoid it … Also, not all users are aware of the back button." Placement: "Always place
  back links at the top of a page, before the `<main>` element"; wording: default "Back", or
  "Go back to [page]" for complex journeys
  ([GOV.UK Design System, Back link](https://design-system.service.gov.uk/components/back-link/)).
- The platform docs assume a visible/system back affordance as part of the pattern itself:
  "pressing the back button redisplays the list"
  ([Android developers, Canonical layouts](https://developer.android.com/guide/topics/large-screens/large-screen-canonical-layouts));
  SAP's full-screen column carries a back icon that returns to the multi-column view
  **[secondary — see §1 SAP entry]**.

**Answer to sub-question 3**: for the web, both — real URLs so browser back works by perception,
*plus* an explicit back-to-list link at the top of the detail/form page (GOV.UK placement: before
`<main>`… in this repo's shell, first thing inside the page content is the practical equivalent,
since the app shell owns the pre-`main` region).

## 4. Where "create new" lives on mobile

- The one-pane-per-screen logic extends to forms: GOV.UK's form-structure guidance is "start by
  splitting the form across multiple pages with each page containing just one thing," and one of
  the six stated benefits is helping users "use the service on a mobile device"
  ([GOV.UK Service Manual, Structuring forms](https://www.gov.uk/service-manual/design/form-structure)).
  A request form as its own routed page (`/acquisitions/new`) is this guidance applied.
- The native-app affordance for "create" from a list is the FAB: "A Floating Action Button (FAB)
  is a high-emphasis button that lets the user perform a primary action in an application … a
  single, focused action that is the most common pathway," with "in a note-taking app, a FAB
  might be used to quickly create a new note" as the canonical example
  ([Android developers, Floating action button](https://developer.android.com/develop/ui/compose/components/fab)).
  The web translation is simply a prominent "Request a download" link/button on the list screen
  that navigates to the form's own page — the FAB is an *entry point to a separate screen*, not a
  justification for embedding the form beside the list.
- **Form-above-list vs list-above-form on a shared page**: no surveyed source addresses this
  ordering directly — the literature's answer is to not share the page on small screens at all
  (§1, §2, GOV.UK above). The closest principled guidance is prioritization: the screen should
  lead with "the most important data and actions"
  ([LukeW, Mobile First](https://www.lukew.com/ff/entry.asp?933)) — which is an argument that if
  panes ever *must* share a small screen, the user's current task (the form or detail they
  navigated to), not the queue, comes first. But that is inference, not attestation; treat it as
  such.

**Answer to sub-question 4**: separate screen, reached from a prominent create affordance on the
list — attested by GOV.UK (web forms) and the FAB pattern (native lists). No source attests
either ordering of a shared form+list page.

## 5. DOM order vs visual order (the Option A question)

- WCAG SC 1.3.2 Meaningful Sequence (Level A) requires that "when the sequence in which content
  is presented affects its meaning, a correct reading sequence can be programmatically
  determined"; its documented failure **F1** is "Changing the meaning of content by positioning
  information with CSS"
  ([WCAG 2.2 Understanding 1.3.2](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html)).
- Sufficient technique **C27** is "to ensure that the order of content in the source code is the
  same as the visual presentation of the content": otherwise "a keyboard user may have trouble
  predicting where focus will go next when the source order does not match the visual order,"
  and a screen-reader user working beside a sighted user encounters "information in different
  orders" ([WCAG technique C27](https://www.w3.org/WAI/WCAG22/Techniques/css/C27)).
- SC 2.4.3 Focus Order is the softer of the two: "Focus order does not necessarily need to follow
  the visual layout of the web page, as long as the order in which elements receive focus is
  logical," and for independent columns "it is not a failure if elements in the right-hand column
  receive focus first" — but the stated best practice is to "make sure the focus order reinforces
  the reading order implied by the visual layout"
  ([WCAG 2.2 Understanding 2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)).
- The CSS Grid specification is *normative* about the mechanism Option A would use: "Authors
  **must** use order and the grid-placement properties only for visual, not logical, reordering
  of content. Style sheets that use these features to perform logical reordering are
  non-conforming" — because placement "does not affect ordering in non-visual media" or
  "sequential navigation modes (such as … tabbing)"
  ([CSS Grid Layout Module Level 1, §Reordering and Accessibility](https://www.w3.org/TR/css-grid-1/#order-accessibility)).
  The Flexbox spec carries the same warning for `order` (section 5.4, "Reordering and
  Accessibility"; the section was present in the TOC but the body was truncated in the fetch —
  the Grid quote above is the fetched normative text).

Applied to Option A (detail-first DOM, list placed visually left on desktop via grid placement):
the desktop tab order would run detail → list while the visual layout reads list → detail. On the
generous 2.4.3 reading the panes are arguably "independent columns," but on this surface the
sequence *is* meaningful — the list is the navigation that produces the detail — so it sits in
C27/F1 territory, and the grid-placement move is exactly what the Grid spec calls logical
reordering. It also directly violates the house rule: "DOM source order SHALL match the
meaningful reading and keyboard-focus order (WCAG 1.3.2 Meaningful Sequence); no skin SHALL use
CSS to reorder content whose sequence is meaningful"
(`openspec/specs/web-ui-presentation/spec.md`, requirement at line 86).

**Answer to sub-question 5**: Option A is the one option with attested guidance *against* it —
normative spec text plus the repo's own constitution. Note the symmetric trap for a naive
Option B: hiding the list on child routes must be `display: none` (removed from the
accessibility tree and tab order), not visual hiding, or small-screen keyboard users tab through
an invisible queue.

## 6. Comparable products (observational, secondary)

- **[secondary]** Gmail's web default is list-only; opening a conversation replaces the list
  (full-screen conversation with a back arrow), and the side-by-side "reading pane" is an opt-in
  ("Enable reading pane") aimed at wide screens — i.e. the flagship web mail client defaults to
  the drill-down model even on desktop (verified via multiple third-party walkthroughs of the
  setting, e.g. [University of Michigan ITS](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/ArticleDet?ID=3538);
  the support.google.com page returned 404 at access time).
- **[secondary — observable URL structure]** GitHub issues: the list (`/issues`) and the detail
  (`/issues/<n>`) are separate documents at every viewport width; GitHub never renders queue and
  issue on one page. Master-detail-as-routes is the mainstream web-app shape for exactly this
  list→detail relationship.
- The Servarr wiki does not document Sonarr/Radarr's narrow-width layout behavior; no claim is
  made about them here.

## 7. Where sources disagree, and the calls for this app

1. **Which pane on a bare small-screen entry?** Android says list first, detail on selection
   (§1). Microsoft's dual-screen note warns against an *empty* detail pane when two panes are
   shown ("the detail view screen can feel broken … requiring action to fill it")
   ([Microsoft Learn, dual-screen](https://learn.microsoft.com/en-us/dual-screen/design/list-detail)).
   *Call*: no conflict in practice — small screens: `/acquisitions` shows the list alone; desktop
   two-pane keeps the current behavior of filling the pane with the request form (never empty).
2. **Explicit back link vs trusting browser back.** NN/g/Baymard establish browser back as the
   floor (§3); GOV.UK adds the explicit link because users distrust browser back mid-task.
   *Call*: both — routes give browser back for free; add a "Back to queue" link at the top of
   detail/form content at small widths (harmless at desktop widths where the list stays visible).
3. **2.4.3's tolerance vs C27's strictness** (§5). *Call*: moot here — the house spec already
   adopts the strict reading, and this surface's sequence is meaningful.

## 8. Recommendations for the `/acquisitions` shell

1. Adopt the **list-detail single-pane collapse** (Option B): below the breakpoint,
   `/acquisitions` renders the queue alone; `/acquisitions/<id>` and `/acquisitions/new` render
   the detail/form alone; desktop keeps both panes (§1 — all four platform owners). The existing
   route separation means this is pure presentation; no JS is required, honoring the
   progressive-enhancement constraint.
2. DOM order stays list-then-detail everywhere; the collapse hides the inactive pane with
   `display: none` at small widths — never reorder, never visually-hide-but-keep-focusable
   (§5; `openspec/specs/web-ui-presentation/spec.md` line 86). CSS-off yields the same sensible
   list-then-detail document. Skins restyle only.
3. **Back affordance**: a "Back to queue" link at the top of the small-screen detail/form pane
   content (GOV.UK wording/placement, §3), alongside natural browser back.
4. **Create affordance**: keep "Request a download" as a prominent link on the queue screen — the
   FAB-equivalent entry point (§4); the form remains its own routed page.
5. **Selection state**: on desktop, persistently highlight the open acquisition in the queue
   (Apple, §1) — the collapse pattern's two-pane half depends on it.
6. Pitfall checklist for the collapse (assembled from §1/§3/§5 sources):
   - back returns to the *list*, preserving scroll position where feasible (Baymard's
     product-list finding, §3);
   - every pane state is a real URL — deep links to `/acquisitions/<id>` land on the detail with
     the back-to-list link present (Baymard perceived-page rule, §3);
   - the hidden pane is out of the accessibility tree and tab order at small widths (§5);
   - no empty detail pane at desktop widths (§7.1);
   - breakpoint chosen by content, not device: Microsoft's attested stacked/side-by-side boundary
     is ~640 epx (§1) — the current 960px boundary is defensible given the 22rem list column, but
     the number is a content decision, not part of the pattern.
7. Apply the same pattern to `/reviews` when it grows the same shell (see
   [review-surface-ux-best-practices.md](review-surface-ux-best-practices.md)).

---

## Sources

**Primary (fetched directly):**

- [Android developers — List-detail (Compose adaptive layouts)](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)
- [Android developers — Large screen canonical layouts](https://developer.android.com/guide/topics/large-screens/large-screen-canonical-layouts)
- [Android developers — Floating action button](https://developer.android.com/develop/ui/compose/components/fab)
- [Microsoft Learn — List/details pattern (Windows apps)](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/list-details)
- [Microsoft Learn — List detail dual-screen UX (archived)](https://learn.microsoft.com/en-us/dual-screen/design/list-detail)
- [WCAG 2.2 Understanding — SC 1.3.2 Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html) · [SC 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) · [Technique C27](https://www.w3.org/WAI/WCAG22/Techniques/css/C27)
- [CSS Grid Layout Module Level 1 — Reordering and Accessibility](https://www.w3.org/TR/css-grid-1/#order-accessibility)
- [NN/g — User Control and Freedom (Usability Heuristic #3)](https://www.nngroup.com/articles/user-control-and-freedom/) · [In-Page Links for Content Navigation](https://www.nngroup.com/articles/in-page-links-content-navigation/) · [Mobile Navigation Patterns](https://www.nngroup.com/articles/mobile-navigation-patterns/)
- [Baymard — 4 Design Patterns That Violate "Back" Button UX Expectations](https://baymard.com/blog/back-button-expectations)
- [GOV.UK Design System — Back link](https://design-system.service.gov.uk/components/back-link/) · [GOV.UK Service Manual — Structuring forms](https://www.gov.uk/service-manual/design/form-structure)
- [LukeW — Multi-Device Layout Patterns](https://www.lukew.com/ff/entry.asp?1514) · [Mobile First](https://www.lukew.com/ff/entry.asp?933)

**Secondary (marked inline where used):**

- [Apple HIG — Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) (site JS-rendered and JSON endpoint 404; quotes via a [verbatim mirror](https://raw.githubusercontent.com/tmaasen/apple-dev-mcp/b82f0efe2115dc4539c83a2374a714a84aeb350a/content/universal/split-views.md))
- [SAP Fiori — Flexible column layout](https://www.sap.com/design-system/fiori-design-web/page-types/page-layouts/flexible-column-layout/) (403 at access time; behavior via search excerpts + [SAP-docs/sapui5 repo](https://github.com/SAP-docs/sapui5/blob/main/docs/06_SAP_Fiori_Elements/enabling-the-flexible-column-layout-75631b7.md))
- Gmail reading-pane default (support.google.com page 404; via [UMich ITS walkthrough](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/ArticleDet?ID=3538) and similar)
- GitHub issues list/detail as separate routes (observable URL structure, not vendor-documented)

**Unreachable (not paraphrased):** m3.material.io canonical-layouts pages (404); the CSS Flexbox
spec's §5.4 body text (page truncated in fetch — the equivalent normative text is cited from the
Grid spec).

> These findings are input to a layout decision for the `/acquisitions` shell, not normative
> guidance; they become binding only via an OpenSpec change.
