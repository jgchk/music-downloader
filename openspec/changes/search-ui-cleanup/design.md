# Design — search-first request page cleanup pass

## Context

See `proposal.md` for the audit summary; the anatomy repairs and their evidence live in
`search-ui-anatomy-fix`, which merges first. Every decision below was settled in the 2026-08-19
grilling session, three of them against commissioned research (dialog modality per WAI-ARIA APG
and practitioner consensus; side-panel prior art across design systems; CSS chrome-inversion
prior art — the latter two land in the anatomy change). Terms minted during the session and
recorded in `packages/web/CONTEXT.md`: **detail view**, **artist discography view**,
**chosen edition**, **top results**. The audit facts that shape this change:

- The artist detail is a 286px panel of text rows with blind Request buttons; no artwork, no path
  from a discography entry to an album's editions.
- Requesting from a result redirects to `/acquisitions/<id>` (the enhanced form applies the
  action's redirect), abandoning the search.
- The search renders all 25 fetched results per kind; ranked positions past the head are
  token-coincidence noise, the wall buries the other kinds, and every rendered tile costs an
  artwork request (~75 per settled keystroke).
- The pipeline's default edition is tagged inside whichever group holds it, but groups sort by
  total edition count while the pick comes from official-editions-modal-count — the pick can sit
  in a collapsed group with nothing above the fold saying what the system would do.
- Escape closes the detail view only while focus sits inside it; clicking outside does nothing.
- `statusOf` maps every `InfraError` to 500, so the page cannot tell "catalog unreachable" (retry
  helps) from "catalog drifted" (retry is futile) on a total failure — a distinction the review
  cycles built for partial failure (`unavailable[].reason`) and that evaporates here.
- The cover-art cache is keyed per `(entity, mbid, size)` with in-flight sharing; unreachable is
  deliberately never cached, so during an archive outage every key independently eats the proxy's
  full 10s timeout, six at a time. `new CoverArtArchive()` hardcodes the base URL.

## Goals / Non-Goals

**Goals:**

- Restore the prototype's interaction parity where the audit showed regressions, with every
  presentation decision owned by the web context and every contract change additive.
- Keep the reached-vs-drifted distinction alive at every altitude it surfaces.
- Make an archive outage degrade in seconds, not minutes.

**Non-Goals:**

- Popularity-aware ranking, artist imagery, refine-search, rate ceilings, edition-selection
  policy changes (all previously recorded as out of scope and still out).
- A modal mobile bottom sheet — the recorded follow-up if the non-modal sheet proves confusing;
  the researched mechanism is native `dialog.showModal()` for the narrow presentation only,
  never a hand-rolled focus trap.

## Decisions

1. **Artist browse-in-place reuses the album grid, not a new surface.** Selecting an artist
   drives a page-level browse state: the results area renders the discography read through the
   same release-group grid presentation, headed "Albums by <name>", with a back crumb that
   re-renders the held results without a new search. Typing exits the browse (it is just a new
   search); activating a filter tab exits it and applies that filter to the held results — the
   tabs stay honest and nothing on screen is dead. The `artist` arm leaves `DetailState`; each
   discography entry opens the standard release-group detail view. *Alternative rejected:*
   enriching the artist panel — a side panel cannot hold a discography a person browses, and the
   prototype validated the in-place grid.
2. **Inline confirmation is a named action's answer, not a second command.** Result-borne request
   forms post to a named action (SvelteKit's `?/request`) that returns modeled success data
   (identifier + display title) instead of redirecting; the default action keeps the redirect for
   the no-JS fallback form. The confirmation renders at the form that submitted — five requests
   leave five local confirmations — in the status register, naming the download and linking its
   identifier. Busy state is per-form. *Alternatives rejected:* a hidden mode field on one action
   (a flag where the framework offers a name), intercepting the redirect client-side (the answer's
   meaning would live in the interceptor), and a toast layer (this app renders state, not
   ephemera).
3. **Top results are a client-side view decision; the read is untouched.** The catalog-search
   read keeps returning its full ranked lists (25 per kind — the fetch depth exists to give the
   ranking evidence). The mixed view presents each kind's top results (10 release groups / 6
   artists / 6 recordings, constants in `lib/search/view.ts` beside the ordering logic); a kind's
   filter tab presents everything. Section headings render the trim as a link-styled "10 of 25"
   whose activation applies that kind's filter — the same linkish idiom the zero-result
   cross-links already use. *Alternative rejected:* server-side caps — "how much a view shows" is
   a presentation number, and the downloader has no business holding one; capping the wire would
   also have made the filtered depth impossible without a second read.
4. **The best-match summary is always visible and is itself the "system chooses" control.** The
   detail view renders a pinned summary above the groups — the pick's title, disambiguation, and
   distinguishing details, or the existing selection-required sentence — selectable to clear any
   chosen edition, mirroring the prototype. The group containing the pick opens alongside the
   most-common group; the per-row "the system's default" tag stays as reinforcement. Format chips
   (All / CD / Vinyl / Digital / Other) filter *editions* and regroup what survives (prototype
   behavior — counts stay truthful); the summary row never filters away. *Alternative rejected:*
   forcing the pick's group to sort first — the grouping order is the catalog's canonical-
   tracklist story and should not reshuffle under a policy detail.
5. **Detail context rides the opening click, not new reads.** The result card already holds the
   artist credit, year, and type (and for recordings the release title and identifier);
   `DetailState` carries those display fields so the view renders its subtitle, identifier line,
   and track artwork with zero additional catalog reads. The identifier-lookup path carries the
   same fields.
6. **"Chosen edition" replaces "pinning" everywhere.** The settled term (recorded in the web
   glossary) renames the copy and the code (`EditionPin`/`onPin`/`pin` → the chosen-edition
   family). A rename tied to the change that redefines the control, so the old word does not
   survive in half the files.
7. **The detail view is honestly non-modal.** Per the modality research (WAI-ARIA APG + the
   master-detail genre: Linear's peek, Gmail's reading pane, GitHub's panels are all non-modal):
   keep `role="dialog"` with `aria-modal="false"`, add a page-level Escape that closes the open
   detail from anywhere, close on click outside the panel — with no scrim, which would visually
   promise a modality the semantics do not deliver — return focus to the originating result on
   close, and give the panel `overscroll-behavior: contain` instead of a body scroll lock. The
   two rejected shapes are the actively harmful middle states: `aria-modal="true"` without real
   inertness makes screen readers treat the still-interactive page as nonexistent, and a
   hand-rolled focus trap re-implements what the platform now does better.
8. **Transient and permanent infrastructure refusals part ways on the wire.** `statusOf` splits
   `InfraError` on its existing `permanent` flag: 502 for transient (unreachable, timeouts,
   upstream 5xx), 500 for permanent (drift). The page maps a 502 from a catalog read to the
   retry-guiding copy — naming the catalog, advising a pause or Enter-to-retry (the prototype's
   validated wording) — and a 500 to the existing that-is-a-bug register; 4xx modeled refusals
   keep the server's words. `messageOf` itself stays generic — it serves every facade consumer.
   *Alternative rejected:* rewording `messageOf` (one consumer's copy in every consumer's mouth)
   or parsing the refusal body for a reason field (a second channel for what a status already
   says).
9. **The unavailability memo is archive-wide, not per-key.** One "unreachable until T" mark that
   any lookup consults and any transport failure sets, TTL of order a minute, tunable through the
   cache's existing config (not the environment — no per-deployment reason to differ), proven by
   the injected clock. Within the interval the endpoint answers unavailable immediately; absence
   and art keep their existing lifetimes and are never conflated with it. The archive base URL
   does join the environment schema (`COVER_ART_BASE_URL`, defaulted) — that one is deployment
   reality: stubs, proxies, and constrained networks need it. *Alternative rejected:* per-key
   memos (25 first-time timeouts per page during an outage) and a concurrency cap (a second
   mechanism the memo obviates).
10. **The artist's type is an additive DTO field.** `type`, MusicBrainz's own word, read
    tolerantly from the artist search response beside `disambiguation`, proven present in a
    recorded contract fixture. The card's subline falls back disambiguation → type → "Artist".

## Risks / Trade-offs

- [Post-submit behavior and copy are scraped by out-of-diff tiers] → audit `test/e2e` and the
  parity specs before the merge checkpoint (the known blast-radius hazard; the e2e gate runs only
  on main); scraped phrases go through the centralized phrase maps.
- [Non-modal costs screen-reader users the "walls" of a contained dialog] → mitigated per the
  research: clear accessible name, logical DOM position after the results, focus return on close;
  the mobile-sheet modality question stays a recorded follow-up.
- [Trimmed top results could hide a wanted obscure match] → the "10 of 25" affordance and the
  kind tabs put the full pool one interaction away, the identifier escape hatch is unaffected,
  and the popularity follow-up remains the real fix for obscure-result ordering.
- [The 502 widening surprises a client that special-cased 500] → the page's own client treats
  any non-OK as a refusal already; contract tests pin the new mapping.

## Open Questions

None — settled in the 2026-08-19 grilling session (two research reports and four glossary terms
came out of it; the mobile-sheet modality follow-up is recorded under Non-Goals).
