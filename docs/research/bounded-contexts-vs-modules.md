# Bounded contexts vs. modules: is this repo's two-context split doctrinally sound?

**Research date:** 2026-08-18.

**Question.** This product is one modular monolith claiming two bounded contexts — **downloader**
(peer-network acquisition, its own SQLite event store) and **importer** (drives beets, the
library's system of record, its own event store) — integrated only through durable in-process
catch-up subscriptions with producer-owned schemas, tolerant readers, ACLs on _both_ consumer
sides, and a deliberate no-shared-kernel rule (shared types are duplicated). Team: one human plus
one AI assistant. The importer began life as a separate repo and was adopted in. A live
domain-modeling session found: (a) the user's natural speech treats the whole flow as **one saga**
("my download" ends with music in the library — the import stage is invisible in speech);
(b) several apparent false cognates (candidate, import, verdict, settled) were resolved by
**renaming**, not found irreconcilable; (c) genuine model divergences remain (match confidence
[0,1] higher-is-better vs. beets distance [0,1] lower-is-better; peer-copy vocabulary vs.
metadata-match vocabulary). Is this genuinely two bounded contexts, or one context masquerading
as two — and what does the canon actually say? The pre-existing leaning ("keep the split,
justified mainly by the beets-ACL argument") is treated here as a hypothesis to test, not to
confirm.

**Method.** Primary sources fetched 2026-08-18: Eric Evans, _Domain-Driven Design Reference:
Definitions and Pattern Summaries_ (2015, CC-BY 4.0 — Evans' own canonical pattern summaries),
fetched as the PDF from domainlanguage.com (the HTML reference page itself returned 403; the PDF
downloaded cleanly); Eric Evans, _Domain-Driven Design_ (2003) — quotes below are from the
**final-manuscript PDF (dated April 15, 2003)** hosted on a university course reading list, so
wording may differ slightly from the printed book; citations give chapter/section names, never
print page numbers. Martin Fowler's bliki (BoundedContext, MonolithFirst, ConwaysLaw), fetched in
full. Vaughn Vernon, _Implementing Domain-Driven Design_ (2013): the Pearson official sample-pages
PDF (front matter incl. "Guide to This Book", 109 pp.) was fetched and quoted directly; the bodies
of ch. 2 and ch. 9 are paywalled — those points are marked **[secondary]**. Vlad Khononov's own
blog post "Bounded Contexts are NOT Microservices" (vladikk.com, 2018), fetched in full; his
_Learning Domain-Driven Design_ (2021) was not directly reachable — its team-ownership rule is
quoted via reader notes and marked **[secondary]**. Lidarr (the directly comparable product:
music, download clients, import pipeline) was inspected in its actual source via the GitHub API.
Newman and Skelton/Pais (Team Topologies) reached only via search excerpts — **[secondary]**
corroboration only. **Unreachable-source honesty:** medium.com, oreilly.com library pages, and
informit.com article pages all returned 403; freedium did not resolve; nothing below is
paraphrased from memory of those pages.

House constraints weighed: `CLAUDE.md` non-negotiables (pure domain, dependency rule, additive-only
contracts, test-first), `docs/development/architecture.md`, `docs/development/domain-driven-design.md`,
and the live seam as documented in this workspace's `CONTEXT-MAP.md` and `packages/*/CONTEXT.md`.
Naming conventions that cross the seam (story/correlation identity) are already settled in
`docs/research/correlation-causation-conventions.md` and are cross-referenced, not re-argued.

---

## 1. The house shape being judged (facts from this repo)

- Two packages each with their own `src/{domain,application,adapters,interfaces,composition}`
  layers, own event store file, own contract-test tier (`CLAUDE.md`).
- `CONTEXT-MAP.md`: "One product, two bounded contexts, built as a modular monolith. Each context
  owns its event store and its language; they integrate only through durable in-process catch-up
  subscriptions over each other's published events (producer-owned schemas, tolerant readers
  behind an anti-corruption layer). There is deliberately no shared kernel: a type needed by both
  is duplicated in each."
- The seam: downloader publishes `acquisition.fulfilled` in its own language; the importer's
  intake ACL translates it to a native submission, keeping the download id and delivered copy as
  "opaque foreign provenance." The importer publishes `release.verdict`; the downloader's ACL
  translates it into an external validation failure feeding the retry ladder (the **revival
  loop**). Contract gate is additive-only; a breaking change is a new event type.
- A curated cross-context homonym table already exists (`CONTEXT-MAP.md`): eleven words with
  different per-context senses (import, download, candidate, verdict, settled, release, source…),
  each defined separately in each glossary.
- The web package is explicitly **not** a bounded context: presentation-only, composes reads
  across both, "never sequences a business workflow across both."
- The genuine divergences: downloader match **confidence** ([0,1], higher is better, a floor)
  vs. importer/beets **distance** ([0,1], lower is better, a threshold) — opposite polarity,
  documented in both CONTEXT.md files; peer-copy language (candidate, try, transfer) vs.
  metadata-match language (match, distance, verdict).

## 2. What the canon says

### 2.1 Definition: a bounded context is a model/language boundary, not a packaging construct

Evans' own definitional summary (DDD Reference, Definitions, p. vi):

> "**bounded context** — A description of a boundary (typically a subsystem, or the work of a
> particular team) within which a particular model is defined and applicable."

and the pattern itself (DDD Reference, Part I; the 2003 book's ch. 14 "Maintaining Model
Integrity" carries the same text):

> "Explicitly define the context within which a model applies. Explicitly set boundaries in terms
> of team organization, usage within specific parts of the application, and physical
> manifestations such as code bases and database schemas. Apply Continuous Integration to keep
> model concepts and terms strictly consistent within these bounds, but don't be distracted or
> confused by issues outside."

The 2003 book adds, in the BOUNDED CONTEXT section's sidebar (ch. 14), the exact
module-vs-context distinction this research question turns on:

> "This issue sometimes gets confused with the motivations for MODULES. True, when it is
> recognized that two sets of objects make up different models they are typically placed in
> separate MODULES … But this is just an implementation mechanism for code separation of
> different models. This issue is preceded by the fundamental problems, recognizing model
> differences and deciding what to do with them. Furthermore, MODULES are also used to organize
> the elements within one model, so they don't communicate an intention to separate models."

So the doctrinal test is **not** "do you have two packages?" but "do you have two models — two
languages you intend to keep separately unified?" Fowler (bliki: BoundedContext, 2014) states the
same test from the language side: "DDD divides up a large system into Bounded Contexts, each of
which can have a unified model," driven by **polysemes** — "these subtle polysemes could be
smoothed over in conversation but not in the precise world of computers" — and "the dominant
[boundary-drawing factor] is human culture, since models act as Ubiquitous Language, you need a
different model when the language changes."

### 2.2 Contexts ↔ modules ↔ subdomains ↔ deployment units

**Modules** (Evans, DDD Reference, Part II; book ch. 5, "MODULES (aka PACKAGES)"): "Choose modules
that tell the story of the system and contain a cohesive set of concepts. Give the modules names
that become part of the ubiquitous language." Modules organize concepts **within one model**; a
context bounds **which model applies**.

**Subdomains vs. contexts**: subdomains are problem-space (discovered), bounded contexts are
solution-space (designed). Khononov states it directly ("While subdomains are discovered, bounded
contexts are designed" — _Learning DDD_ **[secondary, via reader notes]**), and Vernon's ch. 2 is
built on the same distinction, with one-to-one alignment of context and subdomain presented as the
desirable ideal in his greenfield samples (IDDD ch. 2 — body **[secondary]**; the sample-pages PDF
confirms the chapter's framing). Evans, asked about the pair at DDD Europe 2019 (InfoQ report):
"In an ideal world they coincide, but in reality they are often misaligned."

**Deployment**: nothing in the canon ties a bounded context to a process or deployment unit.
Khononov (vladikk.com, "Bounded Contexts are NOT Microservices", 2018) is the sharpest primary
statement:

> "A Bounded Context defines the boundaries of the biggest services possible: services that won't
> have any conflicting models inside of them. … If you follow the Bounded Context strictly, you
> will get monoliths. Those will be 'good' monoliths, since there won't be any conflicting models
> in them … A Microservice is a Bounded Context, but not vice versa."

Fowler (bliki: MonolithFirst, 2015) endorses the same shape from the other end: "design a monolith
carefully, paying attention to modularity within the software, both at the API boundaries and how
the data is stored," and notes microservices "only work well if you come up with good, stable
boundaries between the services — which is essentially the task of drawing up the right set of
BoundedContexts." Newman treats bounded contexts as the seams a modular monolith should be split
along, and reports teams for whom "the modular monolith solved most of their problems"
**[secondary, via reading notes on _Monolith to Microservices_]**. Vernon's front matter confirms
hexagonal architecture "hosting a Bounded Context" as the reference shape (IDDD, "Guide to This
Book": "A powerful architectural style for hosting a Bounded Context is Hexagonal").

**Verdict on this sub-question:** multiple bounded contexts in one process is fully attested;
"bounded context" ≠ deployment boundary in any primary source consulted.

### 2.3 When the canon says "separate contexts" vs. "modules within one context"

Evans gives the diagnostic in ch. 14 ("Recognizing Splinters Within a BOUNDED CONTEXT"): combining
distinct models produces **duplicate concepts** ("two model elements … that actually represent the
same concept … the result is two versions of the same concept that follow different rules and even
have different data") and **false cognates** ("two people who are using the same term … think they
are talking about the same thing, but really are not"). And crucially, on detection the decision
is open in both directions:

> "You may want to pull the model back together and refine the processes to prevent
> fragmentation. Or, the fragmentation may be a result of groups who want to pull the model in
> different directions for good reasons, and you may decide to let them develop independently."

Ch. 14's "Transforming the Boundaries" then gives the explicit force list. Favoring **larger**
contexts: "Flow between user tasks is smoother when more is handled with a unified model"; "It is
easier to understand one coherent model than two distinct ones plus mappings"; "Translation
between two models can be difficult (sometimes impossible)"; "Shared language fosters clear team
communication." Favoring **smaller**: reduced communication overhead; easier continuous
integration; "Different models can cater to special needs or encompass the jargon of specialized
groups of users, along with specialized dialects of the UBIQUITOUS LANGUAGE." He also prices the
split (ch. 14, "Catering to Special Needs With Distinct Models"): "The loss of shared language
will reduce communication. There is extra overhead in integration. There will be some duplication
of effort … But perhaps the biggest risk is that it can become an argument against change and a
justification for any quirky parochial model."

Vernon's ch. 9 rule of thumb points the same way: prefer "the use of Modules rather than creating
new Bounded Contexts, unless the linguistics dictate the coarser-grained division" (IDDD ch. 9,
section "Module Before Bounded Context" — section title verified against the publisher TOC; quote
**[secondary, via search excerpt]**). The operative word is _linguistics_: modules until the
language forks; contexts once it has.

On the **unified user-facing narrative**: Evans lists smooth task flow as a force for a larger
context — it is a real cost of splitting, not noise. But a composed story over several contexts is
also the expected shape, not a contradiction: Vernon devotes an IDDD ch. 14 section to "Composing
Multiple Bounded Contexts" for exactly this (section existence verified in the sample-pages TOC;
body **[secondary]**), and Fowler's bliki notes contexts "share concepts (such as products and
customers)" with "mechanisms to map between these polysemic concepts for integration." A user
saying "my download" for the whole saga is a statement about the **web/composition layer's**
language — which this repo already models as its own non-context glossary — not proof that the two
back-end models are one.

### 2.4 Team topology: does a solo team argue for one context?

The canon's most direct statement is Evans, ch. 14, "The System Under Design":

> "It could be quite simple — a single BOUNDED CONTEXT for the entire system under design. For
> example, this would be the clear choice for a team of fewer than ten people working on a set of
> highly interrelated functionality."

and, a page later:

> "Generally speaking, there is a correspondence of one team per BOUNDED CONTEXT. One team can
> maintain multiple BOUNDED CONTEXTS, but it is hard (though not impossible) for multiple teams
> to work on one together."

So: a small team **defaults** to one context, and a single team owning two contexts is explicitly
**permitted** — the rule is one-directional (never many teams on one model), not "one context per
team." Khononov's _Learning DDD_ restates it: "a bounded context can only be worked on by a single
team … a team can own multiple bounded contexts" **[secondary, via reader notes]**. Note also
Evans' motivation for splitting is largely _coordination cost between people_ ("as few as three or
four people can encounter serious problems" keeping one model unified — ch. 14, CONTINUOUS
INTEGRATION), which a solo team does not pay; a solo team's reason to split must therefore come
from the **models**, not from team mechanics. Conway's Law corroborates from outside DDD: "if a
single team writes a compiler, it will be a one-pass compiler" (Fowler, bliki: ConwaysLaw, 2022,
quoting the folklore form) — and Fowler adds "Conway's Law doesn't impact our thinking for smaller
teams. It's when the humans need organizing that Conway's Law should affect decision making."
Team Topologies makes boundaries a function of **team cognitive load** ("limiting module size to
fit team cognitive load") **[secondary, via summaries of Skelton & Pais 2019]** — for a
one-human-plus-AI team this cuts both ways: no coordination overhead to amortize, but two
glossaries and a seam are themselves cognitive load the boundary must pay for.

### 2.5 Wrapping a foreign system (beets) behind an ACL

Evans' ACL pattern (DDD Reference, Part IV): "As a downstream client, create an isolating layer to
provide your system with functionality of the upstream system in terms of your own domain model."
The Context Map instruction explicitly includes foreign software in the map: "Identify each model
in play on the project and define its bounded context. **This includes the implicit models of
non-object-oriented subsystems.**" (DDD Reference, Context Map.) So beets' model (distance,
autotag candidates, its library DB) is a bounded context on the map in its own right — with a
caveat Evans spells out in ch. 14 ("Accepting That Which We Cannot Change: Delineating the
External Systems"):

> "It is convenient to think of each of these systems as constituting its own BOUNDED CONTEXT,
> but most external systems only weakly meet the definition. First, a BOUNDED CONTEXT is defined
> by an intention to unify the model within certain boundaries."

And on the relationship: "When the functionality of the system under design is going to be more
involved than an extension to an existing system, where your interface to other system is small,
or where the other system is very badly designed, you'll really want your own BOUNDED CONTEXT,
which means building a translation layer, or even an ANTICORRUPTION LAYER." (ch. 14.) Evans made
the same point about legacy integration at DDD Europe 2019 (InfoQ report): the ACL "keeps us from
corrupting the new [systems] built, but it also keeps us from having to change the legacy system."

**The doctrinally precise reading matters here:** the ACL argument establishes that _whoever talks
to beets_ must translate beets' model at an isolating layer. It does **not** by itself establish
that the beets-facing code must be a _separate context from the downloader_. A single unified
context could hold one beets ACL at an outbound port. What the ACL argument does legitimately buy
the split is **blast-radius containment**: beets' concepts (distance polarity, match semantics,
library paths) shape the importer's whole aggregate and vocabulary, and quarantining that
beets-gravity inside one context keeps the downloader's peer-network language free of it. That is
Evans' "special needs with distinct models" / "specialized dialects" force — a real one — but it
is a _model-divergence_ argument wearing an ACL hat, not an ACL mandate.

## 3. Prior art: how Lidarr structures the same seam

Lidarr (github.com/Lidarr/Lidarr, inspected 2026-08-18 via the GitHub API) — music, download
clients, import pipeline, one product — is a **single bounded context with modules**, in Evans'
terms:

- One core assembly, `src/NzbDrone.Core`, with ~50 namespaces: `Download`, `MediaFiles` (with
  `MediaFiles/TrackImport` for import decisions), `DecisionEngine`, `Indexers`, `ImportLists`,
  and one canonical shared domain model in `Music` (artists/albums/tracks) used by all of them.
- The seam is direct coupling, not translation:
  `src/NzbDrone.Core/Download/CompletedDownloadService.cs` imports
  `NzbDrone.Core.MediaFiles.TrackImport` and `NzbDrone.Core.Music`, and constructor-injects
  `IDownloadedTracksImportService` — the download side literally calls the import side, sharing
  `ImportResult`, `TrackedDownload`, and the `Music` entities. Integration events
  (`DownloadCompletedEvent`, `DownloadsProcessedEvent`, an `IEventAggregator`) exist but carry
  the shared model, not a published language.
- There is no ACL, no per-module store (one datastore), no vocabulary boundary: "candidate,"
  "quality," "release" mean the same thing product-wide.

Two honest readings: (a) the mature comparable proves one unified model is _sufficient_ for this
product shape — a data point for the "over-engineered" hypothesis; (b) Lidarr never had this
repo's forcing function — it owns its whole metadata/tagging pipeline in-process, with no foreign
system of record like beets whose model would otherwise leak product-wide, and its
download-reaches-into-import coupling is exactly what this repo's dependency rule and seam were
built to forbid. Lidarr is evidence the merge is _viable_, not that the split is _wrong_.

## 4. Which parts of the current design are attested where

| Design element                                                | Attestation                                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two BCs in one process (modular monolith)                      | Khononov 2018 ("If you follow the Bounded Context strictly, you will get monoliths"); Fowler MonolithFirst; Newman [secondary]. Fully attested.                  |
| Producer-owned event schemas as the integration contract       | Evans OPEN-HOST SERVICE + PUBLISHED LANGUAGE (DDD Reference, Part IV): "Use a well-documented shared language … translating as necessary into and out of it."   |
| Tolerant-reader ACL on the consumer side                       | Evans ANTICORRUPTION LAYER (Reference, Part IV). ACLs on **both** sides is stricter than canon requires (canon puts the ACL downstream); harmless, defensible.   |
| No shared kernel; duplicate the type in each context           | SHARED KERNEL is an option, never an obligation (Reference, Part IV: "Keep this kernel small" — or have none). Deliberate duplication is the priced cost of smaller contexts (Evans ch. 14 cost list). Attested as a conscious trade. |
| One team owning both contexts                                  | Evans ch. 14: "One team can maintain multiple BOUNDED CONTEXTS"; Khononov [secondary]. Attested.                                                                 |
| Web as composition, not a context                              | Vernon IDDD ch. 14 "Composing Multiple Bounded Contexts" [secondary]; consistent with Evans (a consumer of models is in-bounds of neither producer).             |
| "The split exists **because** beets needs an ACL"              | **Not attested as stated.** Evans: external systems "only weakly meet the definition" of a BC, and an ACL is owed to beets from _any_ context that calls it. The defensible form is the model-divergence argument (§2.5). |
| Splitting to keep two genuinely divergent languages pure       | Evans ch. 14 splinter analysis + "specialized dialects" force; Fowler polysemes; Vernon ch. 9 "unless the linguistics dictate" [secondary]. Attested **iff** the divergence is real (see Verdict). |

House-constitution weighting: the non-negotiables (pure domain, dependency rule, additive-only
contracts) are orthogonal to the one-vs-two question — both shapes can honor them. But two of them
bear on the _cost of changing the answer_: the additive-only contract gate and the two durable
per-context event stores mean a merge is not a rename, it is a store-migration and
contract-retirement project; and the lint-enforced dependency rule means the merge's main benefit
(free movement of types across the seam) is exactly the thing the constitution would then need new
rules to re-constrain (Lidarr's `Download` → `TrackImport` reach-through is the cautionary
exhibit).

## Verdict

**Keep the two contexts — but re-found the justification on model divergence, not on the beets
ACL; and adopt the checklist below, because the canon's default for this team size is one context
and the split must keep re-earning itself.**

Doctrinal reasoning:

1. **The canon's prior is against you; the evidence overcomes it.** Evans: a single context is
   "the clear choice for a team of fewer than ten people working on a set of highly interrelated
   functionality" — a solo team gets none of the coordination-cost benefits that motivate most
   splits. Therefore the split may only stand on the other leg Evans provides: models that
   genuinely "pull in different directions for good reasons." This repo has that leg: the
   polarity-inverted quality measures (confidence floor vs. distance threshold — a textbook false
   cognate _if unified_: same [0,1] shape, opposite meaning, the exact "conceptualized in slightly
   different ways" case Evans calls "insidiously harmful"), two distinct aggregates with distinct
   lifecycles and terminality, and a beets-shaped dialect on one side that would otherwise leak
   into peer-network language. By Khononov's criterion — a context is "the biggest [boundary]
   possible … that won't have any conflicting models inside" — unifying downloader and importer
   would create a boundary that _does_ contain conflicting models, which is precisely what a
   bounded context exists to prevent.
2. **The session's findings mostly do not argue for a merge.** That most homonyms were resolved by
   renaming is what a healthy context map looks like — Evans' homonym problem is _undetected_
   false cognates; a curated table of qualified senses is the cure working, not the disease. The
   one-saga user narrative is expected (Evans' "task flow" force is a cost you knowingly pay;
   composition of contexts into one user story is Vernon's documented pattern and is exactly what
   the web layer does). The finding that would have forced a merge — the two vocabularies turning
   out to be one language with cosmetic differences — did not occur: the residual divergences are
   semantic (polarity, aggregate identity), not lexical.
3. **Correct the stated justification.** "Two contexts because beets needs an ACL" is doctrinally
   backwards — beets needs an ACL from anyone who calls it, and beets itself is only "weakly" a
   context (Evans). The sound formulation for `CONTEXT-MAP.md`-level prose: _the importer exists
   as a separate context because its model is shaped by a foreign system of record (beets) whose
   dialect must not leak into the acquisition language; the ACL is the mechanism, the divergent
   model is the reason._
4. **The constitution raises the bar for merging, and prior art lowers the fear of keeping.** A
   merge means event-store migration and contract retirement for zero behavioral gain, and — per
   the Lidarr exhibit — would re-open the door to exactly the reach-through coupling
   (download-side code calling import services on the shared model) the dependency rule exists to
   prevent. Lidarr proves a unified model can ship this product; it does not exhibit the purity,
   testability, or replaceability properties this repo's constitution demands.

**Pitfall checklist** (the ways a kept split goes wrong, each tied to its source):

- **Renaming as a growth industry.** If the homonym table keeps acquiring entries that are
  reconcilable-by-rename rather than genuinely divergent, that is Evans' splinter signal pointing
  the _other_ way ("you may want to pull the model back together"). Track the table's growth rate;
  new entries should be rare and semantic.
- **Accidental shared kernel.** The no-shared-kernel rule is only honest if duplicated types are
  _allowed to diverge_. If every change to a duplicated type must be mirrored in the twin, you are
  running Evans' SHARED KERNEL without its discipline ("shouldn't be changed without consultation")
  while paying duplication cost. Either let them drift or admit the kernel.
- **Parochial-model entrenchment.** Evans' "biggest risk": the split "can become an argument
  against change and a justification for any quirky parochial model." The downloader's admitted
  misnomers (`LIBRARY_ROOT` that isn't the library, `Importing` phases that never import) must not
  hide behind "that's our context's language" — a context earns its dialect only where the dialect
  is _better_ for its specialists, not merely older.
- **ACL passthrough decay.** A tolerant reader that becomes a structural-identity passthrough is a
  CONFORMIST relationship wearing an ACL label (Evans, Reference Part IV) — the existing
  bounded-context-reviewer agent already hunts this; keep it in the pre-PR sweep for every seam
  change.
- **Seam-language contamination in the quality measures.** Never translate confidence↔distance
  numerically at the seam; the verdict crossing as verdict-plus-reasons (never a score) is the
  correct published language — preserve that property in every new event type.
- **Solo-operator context bleed.** With one person speaking both languages, Evans' per-context
  CONTINUOUS INTEGRATION degenerates to self-discipline. The mechanism this repo has (per-context
  CONTEXT.md glossaries, the homonym table, reviewer agents) is the substitute — keep glossary
  updates in the definition of done for any seam-adjacent change.
- **No third context by drift.** Evans expects the system under design to be "one or two BOUNDED
  CONTEXTS." Web is rightly not one; resist promoting it (or a future notifications/queue feature)
  into one without this same level of model-divergence evidence.

_Non-normative. This document records what the cited sources say as of the research date and
applies it to this repo's seam; it is input to a decision, not the decision itself._

## Sources

All URLs accessed 2026-08-18.

- Evans, _Domain-Driven Design Reference: Definitions and Pattern Summaries_ (2015, CC-BY 4.0) —
  definitions (p. vi), Bounded Context, Ubiquitous Language, Modules, Context Map, Shared Kernel,
  Anticorruption Layer, Open-host Service, Published Language, Separate Ways:
  <https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf>
  (the HTML index at domainlanguage.com/ddd/reference returned 403; the PDF fetched cleanly)
- Evans, _Domain-Driven Design_ (2003), ch. 14 "Maintaining Model Integrity" — BOUNDED CONTEXT
  sidebar on MODULES; "Recognizing Splinters" (duplicate concepts, false cognates); "Choosing Your
  Model Context Strategy" (favoring larger/smaller, external systems, one team per context,
  single-context default for small teams); ch. 5 MODULES. Quoted from the final-manuscript PDF
  (April 15, 2003) hosted on a university course reading list — wording may differ slightly from
  print: <https://fabiofumarola.github.io/nosql/readingMaterial/Evans03.pdf>
- Fowler, bliki: Bounded Context (2014): <https://martinfowler.com/bliki/BoundedContext.html>
- Fowler, bliki: Monolith First (2015): <https://martinfowler.com/bliki/MonolithFirst.html>
- Fowler, bliki: Conway's Law (2022): <https://martinfowler.com/bliki/ConwaysLaw.html>
- Vernon, _Implementing Domain-Driven Design_ (2013), official Pearson sample-pages PDF ("Guide to
  This Book": bounded context definition, hexagonal hosting; TOC confirming ch. 9 "Module Before
  Bounded Context" and ch. 14 "Composing Multiple Bounded Contexts"):
  <https://ptgmedia.pearsoncmg.com/images/9780321834577/samplepages/0321834577.pdf>; ch. 2/ch. 9
  body **[secondary — O'Reilly/InformIT pages 403]**, ch. 9 quote via search excerpt of
  <https://www.oreilly.com/library/view/implementing-domain-driven-design/9780133039900/ch09lev1sec3.html>
- Khononov, "Bounded Contexts are NOT Microservices" (2018):
  <https://vladikk.com/2018/01/21/bounded-contexts-vs-microservices/>
- Khononov, _Learning Domain-Driven Design_ (2021), team-ownership rule **[secondary — via reader
  notes]**: <https://tigerabrodi.blog/learning-domain-driven-design-ddd>
- InfoQ, "Bounded Contexts — Eric Evans at DDD Europe" (2019 keynote report):
  <https://www.infoq.com/news/2019/06/bounded-context-eric-evans>
- Lidarr source (inspected via GitHub API: `src/NzbDrone.Core` namespace listing;
  `Download/CompletedDownloadService.cs` imports and constructor):
  <https://github.com/Lidarr/Lidarr>
- Newman, _Monolith to Microservices_ — seams/bounded contexts, modular monolith sufficiency
  **[secondary — via reading notes]**:
  <https://eddmann.com/posts/notes-monolith-to-microservices-by-sam-newman/>
- Skelton & Pais, _Team Topologies_ (2019) — cognitive-load-sized boundaries **[secondary — via
  publisher excerpt/summaries]**: <https://itrevolution.com/wp-content/uploads/2022/06/TTOP_excerpt.pdf>
- House constraints: `CLAUDE.md`, `docs/development/architecture.md`,
  `docs/development/domain-driven-design.md`, workspace `CONTEXT-MAP.md`,
  `packages/downloader/CONTEXT.md`, `packages/importer/CONTEXT.md`; cross-ref
  `docs/research/correlation-causation-conventions.md` (seam identity conventions — not re-argued
  here)
