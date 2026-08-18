# Ubiquitous-language drift vs. stored and published event names: what does the canon prescribe?

**Research date:** 2026-08-18.

**Question.** A domain-modeling session renamed this repo's ubiquitous language: the aggregate
"Acquisition" is now a **download**, an "attempt" is a **try**, the importer's "ProposedCandidate"
is a **metadata match**, "DeliveredCandidate" a **delivered copy**. But every durable artifact
still speaks the old language: stored event types (`AcquisitionRequested`, `CandidatesProposed`,
…) and their payload fields, the published integration events (`acquisition.fulfilled`,
`release.verdict`, fields `acquisitionId`, `candidate`), wire DTOs, and REST routes
(`/api/v1/acquisitions`, `packages/web/src/routes/acquisitions/…`). The repo has an additive-only
contract gate on published events (a breaking payload change must be a new event type), frozen
fixtures kept permanently (`packages/*/contracts/events/history/`), and a read-side upcaster
precedent (`packages/importer/src/adapters/sqlite/upcaster.ts` lifts the stored verb token
`reject-and-retry-download` to `reject-unusable-delivery` on replay). Glossaries (`CONTEXT-MAP.md`,
`packages/*/CONTEXT.md`) handle drift with "code/wire legacy name" Avoid-list entries. Options
weighed, with no prior leaning:

- **A.** Legacy names live in storage and on the wire forever; rename only the in-memory model and
  translate at (de)serialization; the glossary documents the mapping.
- **B.** New event types with new names + upcasters folding old ones on read; old types stop being
  written.
- **C.** Copy-transform store migration — rewrite history with the new names.
- **D.** Do nothing anywhere; event names are a permanent historical record and the glossary alone
  carries the mapping.

And: does the answer differ for (i) private events inside one context's store, (ii) published
integration events other contexts consume, (iii) wire DTOs and REST/MCP routes?

**Method.** Primary sources fetched 2026-08-18. Greg Young, _Versioning in an Event Sourced
System_ (Leanpub, free-to-read edition): the `/read` index is a JS shell, but the per-chapter
pages (`leanpub.com/read/esversioning/leanpub-auto-<chapter>`) served full text — the chapters
"Why can't I update an event?", "Basic Type Based Versioning", "Weak Schema", "General Versioning
Concerns", "Copy and Replace", "Cheating", and "Internal vs External Models" were downloaded and
read in full; quotes below are verbatim from that edition. Greg Young, _CQRS Documents_ (2010)
fetched as PDF (`cqrs.wordpress.com`; WebFetch 403'd, curl succeeded) and text-extracted. Oskar
Dudycz (event-driven.io): "Simple patterns for events schema versioning", "How to (not) do the
events versioning?", "Internal and external events…" — all fetched. Mathias Verraes, "Explicit
Public Events" (verraes.net) fetched. Axon Framework reference, "Event Versioning / Upcasting"
(docs.axoniq.io 4.11) fetched. Kurrent (EventStoreDB): "Event immutability and dealing with
change" (Savvas Kleanthous) fetched; a dedicated Kurrent "versioning strategies" article was not
found (the blog index carried no such piece) — nothing is attributed to one. Overeem, Spoor &
Jansen, "The Dark Side of Event Sourcing: Managing Data Conversion" (SANER 2017) fetched as PDF
from movereem.nl and text-extracted — the paper Young himself cites for Copy-Transform. Adjacent
domains: Apache Avro specification (aliases), Protocol Buffers proto3 guide (updating message
types) — both official docs, fetched. **Unreachable-source honesty:** Vaughn Vernon's IDDD body
chapters remain paywalled (as in `bounded-contexts-vs-modules.md`) and IDDD says little on event
versioning that is verifiable first-hand — Vernon is **not cited** here rather than paraphrased
from memory. Young's often-mentioned "warehouse" talk metaphor could not be verified first-hand
and is omitted. Where the published-language doctrine overlaps the two-context question, this doc
cross-references `docs/research/bounded-contexts-vs-modules.md` rather than re-arguing it.

---

## 1. The house shape being judged (facts from this repo)

- Two event-sourced contexts, each with its own SQLite store; integration only via durable
  in-process catch-up subscriptions. The outbound spec makes **global position and event id part
  of the delivery contract**: "each delivered event SHALL carry a stable identity (its global
  position and event id) so redeliveries are detectable" (`openspec/specs/outbound-events/spec.md`).
  Consumer checkpoints are positions into the producer's store.
- Published contracts are producer-owned, additive-only, gate-enforced: "a breaking payload change
  SHALL be expressed as a new event type"; frozen fixtures are "kept permanently so compatibility
  is verifiable against every historical version" (same spec; mirrored in
  `importer-outbound-events/spec.md`).
- The importer spec already contains this research question's answer in miniature, decided for the
  verb case: "The published payload SHALL NOT carry the importer's internal resolution verb;
  **renaming that verb SHALL NOT change the payload or its schema**, so no consumer is affected"
  — with a scenario titled "Renaming the internal verb leaves the published contract unchanged"
  (`openspec/specs/importer-outbound-events/spec.md`).
- The upcaster seam exists and is doctrinally annotated: "persisted events are immutable facts
  that live forever … read-side upcasters transform an old shape forward (`v1 → v2 → …`) before
  `evolve` ever sees it … exactly the ES form of the no-breaking-change policy"
  (`packages/importer/src/adapters/sqlite/upcaster.ts`). Its first real use is precisely a
  language-drift repair: the stored token `reject-and-retry-download` (the downloader's language)
  is rewritten on read to `reject-unusable-delivery` (the importer's own language), and the
  contract tier replays frozen legacy fixtures through the production registry.
- Glossaries already run the Option-A bookkeeping: "_Avoid_: acquisition (the code's legacy name
  for exactly this — classes, ids, and wire contracts still carry it)"
  (`packages/downloader/CONTEXT.md`); "_Avoid_: reject-and-retry-download (the legacy stored
  token, upcast on replay — never use in prose)" (`packages/importer/CONTEXT.md`).

## 2. What the authorities prescribe

### 2.1 The tension is real: event names ARE ubiquitous language, yet the log is immutable

Both horns come from Greg Young himself. On naming (CQRS Documents, "What is a Domain Event?"):

> "It is absolutely imperative that events always be verbs in the past tense **as they are part
> of the Ubiquitous Language**."

On immutability (_Versioning…_, "Why can't I update an event?"):

> "Immutability is immutable. The moment you allow a single edit, everything becomes suspect."

and the whole chapter's argument structure: editing stored events breaks caching ("your data is
now definitely maybe immutable. Also known as mutable"), breaks consumers ("If you edit an event,
how will the consumers of that event be notified that the event has changed?"), and breaks audit
("If you can edit your audit trail, is it actually an audit trail?"). So the canon does **not**
resolve language drift by making the log follow the language. It resolves it with a seam.

### 2.2 Greg Young on renames specifically: a rename is a version, not a new event — and the seam is the reader

The book's load-bearing rule (_Versioning…_, "Basic Type Based Versioning" → "Define a Version of
an Event"):

> "**A new version of an event must be convertible from the old version of the event. If not, it
> is not a new version of the event but rather a new event.**"

A pure rename is trivially convertible, so renaming is squarely a _versioning_ concern, never a
new-fact concern. His worked example is literally a field rename: `InventoryItemDeactivated`'s
`Id` becomes `ItemId` in v2, and he calls this out as legitimate **because the old event is never
touched**: "both destructive changes, such as the renaming of a property, as well as additive
changes can be made when adding a new version of an event, since the addition of that new event
still represents a change that is additive overall." The stored v1 is then **upcast on read**:
"Provided we can always convert the old version of the event to the new version, we could upcast
the version of the event as we read it from the Event Store … the code will no longer see an
InventoryItemDeactivated_v1 event."

Two qualifications matter for the options table:

- **Weak schema forbids in-place renames.** Under mapping/weak-schema (which is what this repo's
  zod-parsed JSON events are), "you are no longer allowed to rename something. If the change were
  from Id to ItemId, it would not work, as the first version would no longer receive Id. You can
  get around this by supporting both Id and ItemId, but this can quickly become annoying,
  especially with an Event Sourced system, where you cannot just deprecate it but must carry it
  forward into the future" (_Versioning…_, "Weak Schema"). I.e., on a weak-schema wire the field
  name is the identity; a rename is a breaking change, exactly what the repo's additive-only gate
  would reject.
- **A rename is not a semantic change — and only semantic changes are catastrophic.** "One
  important aspect of versioning is that semantic meaning cannot change between versions of
  software. There is no good way for a downstream consumer to understand a semantic meaning
  change" (his Celsius/Fahrenheit thermostat, "General Versioning Concerns"). Language drift that
  keeps meaning (acquisition→download) is the benign case; a rename that smuggles a meaning shift
  is the malignant one and "a more extreme measure will need to be taken such as the Copy-Replace
  pattern."

### 2.3 Greg Young on rewriting history (Option C): sanctioned, but as the nuclear option or a whole-system migration

"Copy and Replace" is emphatic: "**Copy-Replace is the nuclear-option of versioning.**" He blames
himself for its popularity, walks through why live-system Copy-Replace corrupts consumers
("projections / read models are receiving these events as if they are new events"), read-model
history ("R1 and R2 have seen different versions of history"), and idempotency ("Can it really be
considered idempotency when two completely different events have the same identifier but
potentially drastically different information in them?"). His transformation-risk ranking:
"Some transformations are reasonably safe (Upgrade Version of Event, Add New Event), some are
slightly dangerous (Split Event, Merge Events) … and some are very dangerous (Delete Event,
Update event)."

The "Cheating" chapter then rehabilitates a different form — **Copy-Transform**, a
whole-new-system migration with a Big Flip: "Want to rename an event? Split one event into two?
Join streams? The world is your oyster as you are writing a migration … Another way of thinking
about Copy-Transform is Copy-Replace but on the entire Event Store not just on a stream," with
"all of the issues dealing with projections from Copy-Replace go away. Every projection is
rebuilt from scratch as part of the migration." So Young's honest position on C is: acceptable
**when run as a full migration to a new store with every projection rebuilt and consumers cut
over atomically** — not as an in-place edit — and priced accordingly (double hardware, whole-store
copy, "We released this morning it should be ready in a week or two" at 10 TB). The academic
treatment Young cites agrees: Overeem et al. classify "Rename event — An event type is renamed"
as a supported upgrade operation, but their ISO-25010 comparison "shows a preference for
upcasting on the four quality characteristics," with copy-and-transform scoring "the worst
performance efficiency."

Note what Copy-Transform would break **in this repo specifically**: the outbound spec's stable
`(global position, event id)` delivery identity, every consumer checkpoint, and the permanent
frozen-fixture record — a rewrite is a breaking change to three shipped contracts at once, for
zero semantic gain.

### 2.4 Greg Young on internal vs. external models: the wire answers differ by surface

"Internal vs External Models" is the chapter that splits this question's three surfaces:

> "External models tend to be much more conservative in how they approach change compared to
> internal models. A common pattern is to introduce an external model to allow the internal model
> to be more agile in regards to change."

and, on renames of published things, the most on-point sentence in the whole literature:

> "Breaking changes to external models rarely if ever happen. **I have seen numerous projects
> utilizing an external model that had embarrassing spelling mistakes in them that the team will
> keep forever because they loath the idea of introducing a possibly breaking change into their
> model. The costs of a breaking change far outweigh the benefits of removing the embarrassing
> spelling mistakes.**"

External models are weak-schema, coarse-grained, and exist precisely so "the internal system is
free to change it's service boundaries or how it handles it's internal eventing without affecting
the external consumers."

### 2.5 Oskar Dudycz: the default is to not need versioning; renames map at the serialization boundary

Dudycz's summary positions ("How to (not) do the events versioning?" / "Simple patterns for
events schema versioning"): "everyday I'm more convinced that the best option for versioning the
event schema is to prevent conditions in which versioning is needed"; on history, "you should not
change the past. Having precise information, even including bugs, is a valid scenario." His
concrete recipe for a **renamed property** is Option A verbatim: "keep the same name in the JSON
but map it during (de)serialisation" — the new name lives in code, the old name lives on disk,
and a thin mapping owns the difference. For structural change he plugs "a middleware between the
deserialisation and application logic" (upcasting). His "Internal and external events" post
supplies the surface split: exposing internal events means "we must communicate and consult each
change we make with other teams" (the distributed-monolith trap); external events should be
separate, enriched **summary events**, so internal language and structure can evolve freely.

### 2.6 Verraes, Axon, Kurrent: corroboration from pattern, framework, and vendor

- **Verraes, "Explicit Public Events":** keep events "private by default," publish only explicitly
  chosen public events; and — the stability claim that bears on how often this problem should
  recur — well-chosen domain events "tend to become stable very quickly during development, and
  rarely need to be altered." (Cross-reference: the published-language / ACL doctrine for this
  repo's seam is already argued in `docs/research/bounded-contexts-vs-modules.md` §2 and its
  verdict; not re-argued here.)
- **Axon Framework** (the mature framework treatment): upcasters exist for "non-destructive
  refactoring. In other words, the complete event history remains intact," and Axon ships an
  `EventTypeUpcaster` whose stated purpose is renames: it lets you "change an event from one event
  type to another. This can be used to for example change the class or package name of an event
  with ease." Framework precedent, then, is squarely Option B mechanics: rename in code, upcast
  the stored type token on read, never touch the store.
- **Kurrent (Kleanthous, "Event immutability and dealing with change"):** immutability is the
  point (context, debugging, corrections, audit); structural change is handled by "upcasting or
  parsing when projecting old versions of the event"; copy-replace is reserved for semantic
  splits/merges; warnings against deleting events and against stream reshaping.

### 2.7 Convergence check from adjacent domains: renames are safe exactly where a level of indirection separates name from identity

- **Avro** solves renames with **reader-side aliases**: "Named types and fields may have aliases.
  An implementation may optionally use aliases to map a writer's schema to the reader's …
  if data was written as a record with a field named 'x' and is read as a record with a field
  named 'y' with alias 'x', then the implementation would act as though 'x' were named 'y' when
  reading" (Avro spec, Aliases). Old data keeps old names; the reader's schema carries the
  mapping. That is Option A/B's read-side translation, standardized.
- **Protobuf** makes renames free on the binary wire because the **field number, not the name, is
  the identity** ("Changing field numbers for any existing field is not safe" — numbers are
  reserved, names are not), but renames **break protobuf-JSON and TextFormat**, where the name is
  serialized — the guide even tells you to reserve old _names_ so JSON parsing survives deletion.
- **Schema-on-read** generally: the reader applies today's schema to yesterday's bytes.

The cross-domain lesson is crisp: a rename costs nothing where an indirection layer (alias table,
field number, upcaster, serialization map) decouples the human name from the stored identity, and
is a breaking change wherever the name **is** the identity — which is precisely the situation of
this repo's JSON event-type strings, JSON payload field names, DTO keys, and URL paths.

## 3. The options, steelmanned and judged

**A — legacy names on disk/wire forever; rename in memory; translate at (de)serialization.**
Steelman: this is Dudycz's literal recipe for renamed properties, Young's weak-schema conclusion
(you _can't_ rename on a weak-schema wire, so don't), and the Avro-alias shape. It needs no new
event versions, no upcaster growth, no fixture churn; the stored token is demoted to an opaque
serialization identifier (like a protobuf field number) and the glossary documents the mapping.
Weakness: the mapping table is permanent and grows with every future drift; the store's language
and the code's language diverge forever, and every new event type must decide which language its
_tag_ is in — perpetual bilingualism at the adapter.

**B — new event types/versions with new names; upcasters fold old ones on read.**
Steelman: this is exactly Young's worked rename example (v1 `Id` → v2 `ItemId`, upcast on read),
Axon's `EventTypeUpcaster` ("change the class or package name of an event with ease"), Overeem's
preferred technique ("a preference for upcasting"), and this repo's own shipped precedent
(`reviewResolvedV1ToV2`). History is untouched; code sees only the new language; from the cutover
on, even the raw store speaks the new language. Weakness: per rename it costs an upcaster + tests
+ permanent legacy fixtures + contract-replay coverage (real cost under a 100%-coverage gate);
the current `UpcasterRegistry` maps payloads _within_ a type and would need a type-mapping
extension for event-type renames (touching the deferred upcaster-registry follow-up); and done
wholesale for a dozen types it is a large mechanical PR whose entire payoff is vocabulary.

**C — copy-transform the store.**
Steelman: Young sanctions Copy-Transform as a routine migration discipline ("Want to rename an
event? … The world is your oyster"), all projection problems vanish because everything is
rebuilt, and a solo-operator SQLite system could even run it offline, which Young concedes is the
easy case. Judgment: still wrong here, because this repo's cross-context delivery contract makes
store coordinates (`global position`, `event id`) and permanent fixtures part of the _published_
surface — a rewrite is a triple contract break; Copy-Replace is "the nuclear-option of
versioning" and both Young and Kleanthous reserve it for semantic damage (wrong stream
boundaries, meaning changes), not vocabulary. Nothing about a rename meets that bar.

**D — change nothing anywhere; glossary carries everything.**
Steelman: "events are facts written in the language of their time" is genuinely canon —
"you should not change the past" (Dudycz), and the glossary Avoid-lists already work. Judgment:
D is the right answer for the _stored bytes_ and the _published contract_, but wrong for the
in-memory model: Young's CQRS Documents makes event names "part of the Ubiquitous Language," and
a domain layer that keeps speaking a rejected language rots the glossary from inside — every new
line of domain code would deepen the drift the modeling session just paid to resolve. The repo's
own importer already refused D for the verb token (it renamed the domain and upcast the store).

## 4. Verdict

**Hybrid, by surface: A now with B as the escalation valve for internal stored events; D (with
the existing A-style glossary bookkeeping) for published integration events, where new language
enters only aboard genuinely new event types; A/D for DTOs and routes, with additive aliasing or
a major version as the only sanctioned rename vehicles. C is rejected on all three surfaces.**

**(i) Internal stored events (each context's private store).**
Rename the in-memory domain model fully — state types, event constructors, matchers, prose — the
canon is unanimous that this is where the ubiquitous language must live (CQRS Documents; Evans
per `bounded-contexts-vs-modules.md`). For the stored artifacts, adopt **A as the standing rule**:
the stored `type` strings (`AcquisitionRequested`, …) and payload field names are demoted to
stable serialization tokens — protobuf field numbers with letters in them — mapped to
new-language domain names at the SQLite adapter's (de)serialization seam, exhaustively and
bidirectionally, with the glossary's "code/wire legacy name" entries as the human-readable side
of the same table. Escalate to **B per event type, opportunistically**: whenever an event's
payload changes for real reasons (new field, semantic repair) and an upcaster step is being
written anyway, that is the moment a type may also shed its legacy name (Young: renames ride new
versions; Axon: `EventTypeUpcaster`), following the shipped `reviewResolvedV1ToV2` pattern —
upcaster + frozen legacy fixture + contract-tier replay. Do not do a big-bang B sweep for
vocabulary alone, and never C: history is fact, and this store's coordinates are another
context's checkpoint.

**(ii) Published integration events (`acquisition.fulfilled`, `release.verdict`, `acquisitionId`,
`candidate`).**
**D — freeze them.** The published language is a contract, not prose; Young's teams "keep forever"
even spelling mistakes because "the costs of a breaking change far outweigh the benefits," and the
additive-only gate already encodes that arithmetic. The repo's importer spec has the exact
doctrine for verbs — "renaming that verb SHALL NOT change the payload or its schema" — and this
verdict extends it to nouns: `acquisition.fulfilled` and `acquisitionId` are wire tokens in
nobody's domain language; both ACLs already translate them at the seam, which is where published
language is _supposed_ to be translated (see `bounded-contexts-vs-modules.md` on published
language / ACL — not re-argued). New-language names enter the published surface only when the
gate forces a genuinely new event type for a breaking payload change — name that new type in the
new language and let the old type live out its archival life. One cheap additive move is
sanctioned if drift pressure grows: an optional metadata/alias field or a documented
name-mapping table in the contract artifacts — additive, gate-clean, and consumer-optional.

**(iii) Wire DTOs and REST/MCP API routes (`/api/v1/acquisitions`).**
**A/D under the api-compatibility non-negotiable.** JSON keys and URL paths have no
alias-indirection (the protobuf-JSON lesson: where the name is serialized, the name is the
contract), so in-place renames are breaking changes and are out. Web BFF view models and UI copy
are internal presentation — rename freely (mind the E2E tiers that scrape UI copy). If the old
route names become an active liability, the sanctioned vehicles are additive: a `/downloads`
route alias added beside `/acquisitions` (with one canonical and one documented as alias — never
silent dual maintenance), or a clean rename in the next major API version. MCP tool
names/schemas follow the same rule as DTOs (flattened, additive-only).

### Pitfall checklist

- **A rename must be meaning-preserving, verified, or it isn't a rename.** Young's convertibility
  rule is the test: if old `attempt` and new `try` don't convert 1:1 (scope, cardinality,
  lifecycle), it's a **new event**, and treating it as a rename is the Celsius/Fahrenheit trap.
  Make the modeling session's equivalence claim explicit in the upcaster/mapping test.
- **No double-writing during any B migration.** Old and new type names for the same fact-kind must
  never both be live writers; Young's Double Write critique shows replays can't tell pairs from
  singletons. Cut over the writer atomically; the upcaster owns the past.
- **The mapping table must be total and tested from frozen fixtures.** A half-mapped adapter is a
  silent-corruption machine. Keep the existing discipline: every legacy shape has a permanent
  fixture replayed through the production registry/mapping in the contract tier (the
  upcaster-registry's own comment records why: an unwritten step is indistinguishable from
  no-change-by-declaration).
- **Type renames need registry support first.** The current `UpcasterRegistry` is keyed by the
  stored `type` string and returns the same type; folding `AcquisitionRequested` into a
  new-language type token needs a type-mapping capability (and interacts with the deferred
  upcaster-registry-default follow-up). Build that seam before the first B-escalation, not during.
- **Never let a store rewrite look cheap because SQLite is small.** The blocked path isn't disk
  cost — it's that `(global position, event id)` are a published delivery contract and consumer
  checkpoints point into the store. Any "quick offline copy-transform" breaks the other context's
  checkpoint and the permanent fixture record.
- **Glossary entries are load-bearing, not apologies.** On a solo team the Avoid-list _is_ the
  continuous-integration substitute (per `bounded-contexts-vs-modules.md` pitfalls): every
  surviving legacy token must carry its "code/wire legacy name" entry, and every new event
  type/field minted from today onward must be named in the new language — drift is only frozen,
  never extended.
- **Watch the rename blast radius outside the diff.** Route and copy changes hit UI-scraping E2E
  and parity tiers that run only on main; audit `test/e2e` before merging any route-alias or
  UI-vocabulary change.
- **Budget the 100%-coverage cost into each B escalation.** Every upcaster and mapping branch is
  production code demanding tests-first; that is the honest price that keeps "A now, B when
  touched" the default over a wholesale sweep.

_Non-normative. This document records what the cited sources say as of the research date and
applies it to this repo's constraints; it is input to a decision, not the decision itself._

## Sources

All URLs accessed 2026-08-18.

- Greg Young, _Versioning in an Event Sourced System_ (Leanpub, free-to-read edition), chapters
  fetched individually and quoted verbatim: "Why can't I update an event?" (immutability,
  consumers, audit, WORM), "Basic Type Based Versioning" (the convertibility rule; the Id→ItemId
  rename-as-new-version example; Double Write critique), "Weak Schema" ("no longer allowed to
  rename something"), "General Versioning Concerns" (semantic meaning cannot change; avoid 'And'),
  "Copy and Replace" ("the nuclear-option of versioning"; transformation risk ranking),
  "Cheating" (Copy-Transform / Big Flip / Versioning Bankruptcy), "Internal vs External Models"
  (granularity, glacial external change, spelling-mistakes-kept-forever):
  <https://leanpub.com/esversioning/read> (chapter pages at
  `https://leanpub.com/read/esversioning/leanpub-auto-<chapter>`)
- Greg Young, _CQRS Documents_ (2010), "What is a Domain Event?" — events as past-tense verbs,
  "part of the Ubiquitous Language"; fetched as PDF and text-extracted:
  <https://cqrs.wordpress.com/wp-content/uploads/2010/11/cqrs_documents.pdf>
- Oskar Dudycz, "Simple patterns for events schema versioning" — renamed property mapped "during
  (de)serialisation"; upcasting middleware; "you should not change the past":
  <https://event-driven.io/en/simple_events_versioning_patterns/>
- Oskar Dudycz, "How to (not) do the events versioning?" — "the best option … is to prevent
  conditions in which versioning is needed"; stream transformation; short-lived streams:
  <https://event-driven.io/en/how_to_do_event_versioning/>
- Oskar Dudycz, "Internal and external events, or how to design event-driven API" — private
  internal events vs enriched external summary events; distributed-monolith warning:
  <https://event-driven.io/en/internal_external_events/>
- Mathias Verraes, "Explicit Public Events" (Patterns for Decoupling in Distributed Systems) —
  private-by-default events; UL-named events "tend to become stable very quickly":
  <https://verraes.net/2019/05/patterns-for-decoupling-distsys-explicit-public-events/>
- Axon Framework Reference 4.11, "Event Versioning" — upcasters as "non-destructive refactoring";
  `EventTypeUpcaster` for renaming event types:
  <https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/>
- Savvas Kleanthous, "Event immutability and dealing with change" (Kurrent/EventStoreDB blog) —
  immutability benefits; upcasting for structure, copy-replace only for semantic splits/merges:
  <https://www.kurrent.io/blog/event-immutability-and-dealing-with-change/>
- Overeem, Spoor & Jansen, "The Dark Side of Event Sourcing: Managing Data Conversion" (SANER
  2017) — upgrade-operation taxonomy including "Rename event"; ISO-25010 comparison preferring
  upcasting; copy-and-transform costs: <https://www.movereem.nl/files/2017SANER-eventsourcing.pdf>
- Apache Avro Specification, "Aliases" — reader-schema aliases as the standardized rename
  mechanism: <https://avro.apache.org/docs/1.11.1/specification/#aliases>
- Protocol Buffers, proto3 language guide, "Updating A Message Type" — field numbers as identity;
  names load-bearing for JSON/TextFormat: <https://protobuf.dev/programming-guides/proto3/#updating>
- House artifacts: `openspec/specs/outbound-events/spec.md`,
  `openspec/specs/importer-outbound-events/spec.md`,
  `packages/importer/src/adapters/sqlite/upcaster.ts`,
  `packages/*/contracts/events/history/`, `CONTEXT-MAP.md`, `packages/*/CONTEXT.md`; cross-ref
  `docs/research/bounded-contexts-vs-modules.md` (published language & ACL doctrine — not
  re-argued here)
