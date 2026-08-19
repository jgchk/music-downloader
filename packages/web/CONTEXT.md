# Web (Presentation) Context

Not a bounded context: the SvelteKit BFF and browser UI. It reads and commands both modules through their in-process facades, composes web-owned views across them, and owns two real vocabularies of its own — the presentation language users see, and the access-control model. It never sequences a business workflow across the two modules.

## Language

### The register

**Register**:
The single voice all visible text follows: plain-language narration with no internal vocabulary — no enum identifiers, no architecture nouns ("module", "importer", "seam", "staged"), no internal tool names. Real-world names the user owns (source network, MusicBrainz, formats, album titles, peer usernames) are permitted. Scope: timeline entries and queue rows — the chrome (footer, nav) may name the product's halves.
_Avoid_: tone, style guide

**Gloss**:
The plain-language rendering of an internal identifier (a failure reason, a beets penalty key, a plugin stage), maintained in a gloss map so the enum never leaks into visible text.

**Telling**:
One of the three fixed renderings of a review resolution verb — its label, its consequence, and its timeline echo — kept in a single source so a verb cannot diverge its tellings.

### Composed views

**Timeline**:
The web-owned merge of a download's and its import's history entries into one narrated arc. A join over the two facades' read models — it introduces no contract between the contexts.
_Avoid_: event log, history (as a domain claim; "History" is only the heading)

**Entry state**:
A timeline entry's visual weight: routine, attention, failure, or success.

**Attention queue**:
The unified "needs attention" list folding the importer's open reviews and the downloader's awaiting-selection downloads into one queue. Web-owned; neither module knows it exists.
_Avoid_: review queue (the importer-only slice), inbox

**The ask**:
An attention item's one-line statement of what the user is being asked to do ("Choose a match", "Choose an edition") — an ask, not a domain kind name.

**Story (narrative)**:
The user-visible arc of one download and its import side, from request to library. Distinct from the correlation story (one traced operation): a download's narrative spans many correlation stories — never conflate them.

**Story settledness**:
Whether the composed both-halves narrative is finished. The import's own settled flag cannot express it — a rejected import may revive the download moments later (Fulfilled is stable-but-defeasible) — so settling the story is the BFF's judgement.
_Avoid_: settled unqualified (three senses exist across the packages)

**Match quality**:
The presentation inversion of the importer's distance: a higher-is-better percentage banded into Strong, Good, and Weak match. Never show a raw distance or any lower-is-better figure in visible text.

**Section view**:
A guarded facade read's result for one half of a page: the data, or an unavailable variant carrying its apology — so one module being down degrades a section, never the page.

**Freshness**:
The web-owned refresh seam deciding when a rendered view is re-read from the facades.

### The request page

**Detail view**:
The overlay a selected catalog result opens — a side panel at wide viewports, a bottom sheet at narrow ones — where an album's editions or a track's request live. Say _catalog_ detail view wherever the acquisitions master-detail pane is also in view; the CSS carries `catalog-detail` for that same reason.
_Avoid_: drawer, detail surface, modal (as a name; modality is a property, not the thing)

**Artist discography view**:
The results area taken over by one artist's releases, presented the way album results are, with a one-step way back to the held search results.
_Avoid_: artist drawer, discography takeover

**Chosen edition**:
The edition the user chose by hand in an album's detail view, making the request target that exact pressing. Clearing the choice is letting the system choose — the pipeline's own pick applies.
_Avoid_: pin, pinned edition, pinning, selected edition (collides with the downloader's manual-selection pause)

**Top results**:
The leading slice of one kind's search results the mixed view presents — the ones ranking judged likeliest to be what the query meant. Each kind's filter tab presents all of that kind's results.
_Avoid_: ranked head, top matches ("match" is claimed by the importer's match review and the edition best match)

### Access control

**Session**:
The server-held sign-in state, established via Plex and carried by cookie. Verification happens server-side; the browser holds no claims.

**Role**:
`owner` or `guest`, derived from Plex server membership. Ownership currently trusts a self-asserted flag — gating any real action on `owner` requires the account-identity pin to land first.

**Privileged action**:
An operation gated on a role decision point (e.g. system redrive). Decisions fail closed: no verifiable membership, no action.

**Share-is-approval**:
The access rule: being shared the Plex server _is_ the approval to sign in; there is no separate invite list.

**Readiness**:
The health verdict of the composed runtime: ok or degraded, with per-module up/down detail.
