# How do event-sourced systems mint and carry correlation/causation identity?

**Research date:** 2026-08-05.

**Question.** `docs/development/logging.md` requires that "you should be able to follow a single
operation through the whole system by its correlation id" — but `EventMetadata.correlationId`
(optional, both contexts) is populated nowhere, no child-logger binding exists, and adapter log
lines omit even the stream id they hold in scope. We are designing the correlation
implementation for a two-bounded-context event-sourced modular monolith (single Node process,
SQLite event stores, pino, a SvelteKit BFF, reactors dispatching effects, cross-context
integration via durable in-process catch-up subscriptions behind ACLs). Six open forks:
(1) single `correlationId` vs the correlation+causation pair; (2) where the id is minted and how
it flows request → command → event → reactor follow-ups → published integration events;
(3) whether the consuming context adopts the producer's correlation id or mints its own and
records the foreign one as provenance; (4) whether OpenTelemetry / W3C Trace Context is attested
practice or overkill for a single-process homelab monolith; (5) pino child-logger binding
conventions per unit of work; (6) what the field warns about retrofitting correlation onto
existing stores under an additive-only contract policy.

**Method.** Primary sources fetched 2026-08-05: the Kurrent (EventStoreDB) discussion forum
(Greg Young answering in person) and the Kurrent blog on the Visualize tab / `$by_correlation_id`
projection; Particular Software's NServiceBus header and message-correlation docs; Axon
Framework 4.12 reference (message correlation / `MessageOriginProvider`); the message-db GitHub
README (schema and `write_message` signature); Rails Event Store's correlation-causation doc and
the Arkency post that popularized the rules; Marten's event-metadata doc; the W3C Trace Context
recommendation; the OpenTelemetry logs spec; pino's `child-loggers.md` and `api.md` on GitHub;
Maxim Orlov's pino + AsyncLocalStorage write-up; Last9's correlation-id-vs-trace-id practitioner
guide; Hohpe & Woolf's enterpriseintegrationpatterns.com. House constraints from
`docs/development/logging.md`, `event-sourcing.md`, and `api-compatibility.md`, plus the actual
ports and facades in this repo. **Unreachable-source honesty:** `getpino.io` did not resolve
(DNS timeout) — the same pages were fetched from the pino GitHub repo instead;
`docs.eventide-project.org` is served over plain HTTP and returns 404 over HTTPS, which the
fetch tool forces, so Eventide's metadata definitions below come from search-result excerpts of
those pages and are marked **[secondary]**; one context-switching strategy note cites a Q&A
aggregator and is marked **[secondary]**.

---

## 1. The house shape being decided (facts from this repo)

- `EventMetadata` is `{ acquisitionId | importId, occurredAt, correlationId? }` — one metadata
  value per **append batch**, not per event
  (`packages/downloader/src/application/ports/event-store-port.ts:11-15,36-41`;
  `packages/importer/src/application/ports/event-store-port.ts:11-15`). `correlationId` is
  declared and never set (no writer anywhere in `src/`).
- The logger is a bare pino root with env-configured level and central redaction; no `child()`
  call exists in production code
  (`packages/downloader/src/application/logging/logger.ts`, importer twin).
- The BFF's only generated id today is the `handleError` fault id: "no record on the pino root,
  no error id, no correlation" without it
  (`packages/web/src/hooks.server.ts:78-96`).
- Reactor doc-comments already promise stream-scoped correlation that the log lines don't
  deliver: "Operational logs are correlated by `acquisitionId`"
  (`packages/downloader/src/application/acquisition/reactor.ts:36`), "Operational logs are
  correlated by `importId`" (`packages/importer/src/application/import/reactor.ts:64`).
- A **business** correlation key already crosses the seam and is deliberately additive: the
  importer read model carries "the originating acquisition, when this import arrived from one —
  the web-side correlation key"
  (`packages/importer/src/application/projections/read-models.ts:57`,
  `packages/importer/src/facade/schemas.ts:276`). This is domain provenance, not the
  operational id this research is about — the distinction matters in §3.3.
- The seam is producer-owned: the outbound feed renders published events through a
  producer-owned mapping; "the producer does not know its consumers"
  (`packages/importer/src/application/events/outbound-feed.ts`).
- Constitution constraints: correlation on every log line (`logging.md` §Correlation); events
  are business facts, "not incidental telemetry" (`event-sourcing.md` §Events are facts); the
  domain is pure — no logging, no metadata plumbing (`logging.md` §Keep logging out of the
  domain); event schemas are public contracts, additive-only, upcast on read
  (`api-compatibility.md`, `event-sourcing.md` §Schema evolution).

---

## 2. Prior art, system by system

### 2.1 Greg Young / EventStoreDB — the canonical three-id rule

Greg Young, answering "causation or correlation id?" on the official forum, states the rule the
rest of the field quotes: every message carries three ids — its own id, a correlation id, and a
causation id — and "if you are responding to a message, you copy its correlation id as your
correlation id, its message id is your causation id. This allows you to see an entire
conversation (correlation id) or to see what causes what (causation id)"
([Kurrent forum, Greg Young](https://discuss.kurrent.io/t/causation-or-correlation-id/828/4)).

EventStoreDB reifies this as reserved metadata keys `$correlationId` and `$causationId`. The
built-in `$by_correlation_id` projection groups "every event which has a correlation id … set in
its metadata" into `$bc-<correlationId>` streams, and the Visualize tab draws the causation
graph from them; in the worked order/payment example "the `$correlationId` stays the same …
the `$causationId` is set to the event ID of the previous OrderPlaced event"
([Kurrent blog](https://www.kurrent.io/blog/eventstoredb-visualise-tab/)). Two operational
capabilities fall out, each bought by a different id: *conversation replay* (fetch everything
with one correlation id) and *causal debugging* (walk parents). A single id buys only the first.

### 2.2 NServiceBus — three headers, and the conversation id is immutable

NServiceBus splits the concern across headers
([headers doc](https://docs.particular.net/nservicebus/messaging/headers),
[message-correlation doc](https://docs.particular.net/nservicebus/messaging/message-correlation)):

- **`ConversationId`** — "the identifier of the conversation that this message is part of. It
  enables the tracking of message flows that span more than one message exchange." The first
  message in a new flow receives a unique conversation id **that propagates to all subsequent
  messages**, across endpoint (service) boundaries; it is "always copied from the incoming
  message being handled," and "attempting to override an existing Conversation ID is not
  supported" — it errors. This is Greg Young's correlation id under another name, with
  immutability enforced.
- **`RelatedTo`** — "the `MessageId` that caused the current message to be sent": the causation
  id.
- **`CorrelationId`** — *narrower* than the name suggests: the Hohpe/Woolf request-reply
  correlation for callbacks and `ReplyToOriginator` ("the `Correlation Id` of the response
  message is the `Correlation Id` of its corresponding request message").

The lesson for naming: the industry's "correlation id" is overloaded. NServiceBus's
conversation/related-to pair maps exactly onto Young's correlation/causation pair; its
"CorrelationId" is a third, older thing.

### 2.3 Axon Framework — the same pair, with the names swapped

Axon's default `MessageOriginProvider` "is responsible for two values to be passed around from
one Message to another": "the `correlationId` of a message always references the identifier of
the message it originates from (that is, the parent message)," while "the `traceId` … references
the message identifier which started the chain of messages (that is, the root message)" —
`traceId` constant, `correlationId` per-parent
([Axon 4.12 reference](https://docs.axoniq.io/axon-framework-reference/4.12/messaging-concepts/message-correlation/)).
So Axon's `correlationId` is Young's *causation* id and its `traceId` is Young's *correlation*
id. Mechanically, a `CorrelationDataProvider` transports selected metadata from the handled
message to every message created in the same unit of work, and it lands persisted in event
metadata. Two takeaways: (a) even a major framework inverts the vocabulary — a design doc must
define its terms, not assume them; (b) propagation is an *infrastructure* concern (unit of
work), never handler code — the Axon analogue of keeping it out of deciders.

### 2.4 Eventide / Message DB — coordinate-based causation, stream-based correlation

Eventide's message metadata **[secondary — docs site unreachable over HTTPS; quotes from
search excerpts of docs.eventide-project.org]** records causation as *store coordinates*, not a
uuid: `causation_message_stream_name`, `causation_message_position`, and
`causation_message_global_position` "denote which stream caused the message to be written."
Correlation is likewise a stream name: "the `correlation_stream_name` attribute allows a
component to tag an outbound message with its origin. Before the source component sends the
message to the receiving component, the source component assigns its own stream name to the
message metadata's `correlation_stream_name` attribute. That attribute is carried from message
to message through messaging workflows" — explicitly a **cross-component pub/sub** mechanism:
the originating component later subscribes to a category filtered by its own stream name
(Message DB's `get_category_messages` takes a `correlation` filter on exactly this attribute —
[message-db README](https://github.com/message-db/message-db)). The `follow()` message
constructor copies correlation/reply attributes from the preceding message and points the
causation attributes at it; the `follows?` predicate checks the whole set.

Two things are notable for this codebase: causation needs no new uuid when every stored event
already has a stable address (here: `streamId` + `version`, or `globalSeq`); and correlation
crossing a component boundary *by design* is fifteen-year-old precedent, not an ACL violation.

### 2.5 Rails Event Store / Arkency — the same rules, plus retrofit-relevant defaults

RES stores `correlation_id` / `causation_id` in event metadata, cites Young's rule verbatim, and
ships `correlate_with(previous_event)` plus `LinkByCorrelationId` / `LinkByCausationId`
subscribers that build queryable `correlation-{id}` / `causation-{id}` streams — "what happened
because of event X?" as a projection, not a source of truth
([RES doc](https://railseventstore.org/docs/core-concepts/correlation-causation),
[Arkency post](https://blog.arkency.com/correlation-id-and-causation-id-in-evented-systems/)).
The Arkency post states the minting rule for the start of a story: "when initiating a message,
both `correlation_id` and `causation_id` are newly generated" (in practice: a first message is
its own story; some shops set the first message's causation to null instead — both are
attested). One operational trap they document: synchronous handlers get correlation for free,
but **async handlers need explicit opt-in** (`RailsEventStore::CorrelatedHandler`) — i.e., every
async hop is a place the chain silently breaks unless the infrastructure carries it.

### 2.6 Marten — metadata is opt-in, and correlation converges with OTel

Marten is the strongest precedent for the retrofit story: "By default, Marten runs 'lean' by
omitting the extra metadata storage on events" — `CorrelationIdEnabled`, `CausationIdEnabled`,
and headers are individually enabled flags, values are set **session-scoped** ("values will flow
through to new events captured by a session when `SaveChangesAsync()` is called"), and — key —
"the `CorrelationId` and `CausationId` is taken automatically from any active OpenTelemetry
span, so these values should just flow from ASP.NET Core requests"
([Marten metadata doc](https://martendb.io/events/metadata.html)). So in Marten's model the
correlation id *is* the trace id when tracing exists, and a plain string when it doesn't — the
two schemes are the same slot.

### 2.7 Hohpe & Woolf — what "Correlation Identifier" originally meant

The EIP pattern is narrow: "a unique identifier that indicates which request message this reply
is for" — request/reply matching, nothing about conversations
([enterpriseintegrationpatterns.com](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)).
The modern "follow one operation everywhere" id is a *generalization* the ES community built on
top (Young's rule, NServiceBus's ConversationId). Citing EIP for the end-to-end id is a common
mis-citation; the doc a proposal cites should be Young/NServiceBus, not EIP.

### 2.8 W3C Trace Context / OpenTelemetry — the format, and when the machinery pays

The `traceparent` header is `version-traceid-parentid-flags`: trace-id is "16-byte … lowercase
hexadecimal" (32 chars), "the ID of the whole trace forest," constant across the transaction;
parent-id is 8 bytes, "the ID of this request as known by the caller," changing at each hop
([W3C Trace Context](https://www.w3.org/TR/trace-context/)). Note the structural identity with
Young's pair: trace-id ≙ correlation id, parent-id ≙ causation id — the field converged on the
same two-level shape twice, independently. The OTel logs spec's whole correlation story is
"including TraceId and SpanId in the LogRecords" so logs join traces by execution context
([OTel logs spec](https://opentelemetry.io/docs/specs/otel/logs/)).

On monoliths, practitioner guidance is consistent: correlation ids suit "smaller applications
where full distributed tracing might be overkill" and "a basic correlation ID system can be
implemented in just hours"; trace trees pay off "when dealing with dozens or hundreds of
interconnected services"; and the recommended convergence path is "the trace ID functions as
your correlation ID for log correlation"
([Last9, Correlation ID vs Trace ID](https://last9.io/blog/correlation-id-vs-trace-id/)).
Marten (§2.6) is a shipping example of exactly that convergence. The attested middle path is
therefore: no SDK, no spans, no backend — but an id that is *format-compatible* (32 lowercase
hex chars, or simply a uuid you're willing to rename later), so a future OTel adoption changes
the minting line, not the plumbing.

### 2.9 pino — children are the mechanism; ALS is the escape hatch

- **Child loggers** pin bindings — "key-value pairs … pinned to a logger causing them to be
  output on every log line" — inherit the parent's stream and level, and are cheap enough to
  create per unit of work: creating 10k children benchmarks at the same order as using the root,
  and "logging via the child logger of a child logger also has negligible overhead"
  ([pino child-loggers.md](https://github.com/pinojs/pino/blob/main/docs/child-loggers.md),
  [api.md](https://github.com/pinojs/pino/blob/main/docs/api.md)). Bindings should sit under
  application-controlled keys (never raw user data as keys).
- **`mixin`** is the per-line dynamic hook: "called each time one of the active logging methods
  is called … the properties of the returned object will be added to the logged JSON" — the
  documented seam for pulling ambient context (e.g., AsyncLocalStorage) into every line without
  holding a child ([api.md](https://github.com/pinojs/pino/blob/main/docs/api.md)).
- **Request scoping**: pino-http mints `req.id` via `genReqId` (honoring an inbound header or
  generating a uuid — the default sequential integer is documented as unsuitable for
  production) and hangs a bound child on `req.log`
  ([pino-http README](https://github.com/pinojs/pino-http)). Where parameter-passing is
  impractical, the attested pattern stores the request-bound child in AsyncLocalStorage —
  middleware does `logger.child({ requestId: uuid.v4() })`, `context.run(store, next)`, and a
  proxy resolves `context.getStore()?.get('logger') || target`
  ([Maxim Orlov](https://maximorlov.com/logging-with-pino-and-asynclocalstorage-in-nodejs/)).
  This codebase already injects `Logger` through constructors and use-case dependency bags, so
  child-passing needs no ALS magic on the write path; ALS remains the fallback for surfaces that
  can't thread a parameter (e.g., SvelteKit `load` internals).

### 2.10 Crossing bounded contexts

No surveyed messaging system re-mints the story id at an internal boundary: NServiceBus's
ConversationId crosses endpoints unchanged and *refuses* override (§2.2); Eventide's
`correlation_stream_name` exists precisely so a *different component's* streams can carry the
originator's identity (§2.4); W3C trace context crosses every service by construction (§2.8).
The ids these systems protect per-context are **business** identifiers: the DDD-flavored
guidance is to keep the operational correlation constant across hops while each context appends
its own domain keys — "OrderPlaced carries orderId … PaymentAuthorized introduces paymentId
while preserving orderId," and where an entity genuinely changes story, append the new id while
retaining the original as provenance **[secondary — Q&A aggregator]**
([Codemia](https://codemia.io/knowledge-hub/path/handling_correlation_id_changes_in_event_sourcing_when_an_entity_switches_context)).
The ACL literature (Context Mapper, Evans) concerns *model* translation — vocabulary, structure,
invariants — not observability envelopes; none of the surveyed ACL sources treats an opaque
correlation id as model leakage. This codebase already embodies the split: `acquisitionId` on an
import is the translated *business* provenance key (§1), which is a different thing from the
operational id `logging.md` demands.

---

## 3. Where the field converges, where it splits

**Converged (unanimous among surveyed systems):**

- Correlation/causation live in the **metadata envelope**, never the event payload (ESDB
  `$correlationId`, RES `metadata`, Eventide `metadata`, Marten metadata columns, Axon
  `MetaData`, NServiceBus headers). The domain object never sees them.
- Propagation is done by **infrastructure at the unit-of-work seam** (Axon's
  `CorrelationDataProvider`, Marten's session, Eventide's `follow()`, NServiceBus's pipeline,
  RES's `CorrelatedHandler`), not by handler/decider code.
- The story id is **minted at the first message of the flow** and copied verbatim forever after,
  across async hops and component boundaries.
- Two levels of identity, not one: a constant story id plus a per-message parent pointer
  (Young, ESDB, NServiceBus, Axon, Eventide, RES, W3C — seven independent designs, same shape).
- Correlation-keyed lookups (`$bc-` streams, `LinkByCorrelationId`) are **projections** —
  disposable, rebuildable, never truth.

**Split (design freedom):**

- *Naming*: correlation/causation (ESDB, RES, Marten) vs conversation/related-to (NServiceBus)
  vs trace/correlation (Axon, inverted) vs trace-id/parent-id (W3C).
- *Causation reference form*: parent message uuid (ESDB, RES, NServiceBus, Axon) vs store
  coordinates — stream name + position (Eventide).
- *First message's causation*: self-caused/fresh (Arkency) vs absent (common elsewhere); both
  attested.
- *Ambient vs explicit carriage in-process*: ALS/session ambience (Marten, pino-ALS) vs
  explicit `follow()`/parameter passing (Eventide). A codebase that already injects
  dependencies explicitly loses nothing by staying explicit.

---

## Verdict

**Fork 1 — pair, not single id.** Adopt both: `correlationId` = the story, constant from first
trigger to last published event; `causationId` = the immediate parent. Every surveyed system
that started from event sourcing carries both, and each id buys a distinct operator capability —
"see an entire conversation" vs "see what causes what" (§2.1). For causation, this store
doesn't need a new per-event uuid: Eventide's coordinate form (§2.4) legitimizes
`streamId@version` / `globalSeq` as the causation reference, and commands get an id minted at
issuance (or the causation of a decision's events is simply the triggering event's coordinates —
the reactor case — or the BFF request id — the command case). One `EventMetadata` per append
batch is fine: all events of one decision share one parent, which is semantically correct.
Define the terms in the OpenSpec doc explicitly — Axon proves even frameworks invert them
(§2.3).

**Fork 2 — minted at the outermost trigger; carried by the shell.** Field-unanimous: the id is
born where the story starts, which here is (a) the BFF request handler in `hooks.server.ts`
(generate per request, pino-http-style; honoring an inbound header is optional and low-value
behind the Plex gate), and (b) non-HTTP entry points — startup redrive, intake scanner, pollers
— each minting a fresh id per unit of work. Flow: request id → facade command (additive optional
field on the command DTO or an application-level context argument — *not* a domain command
field) → `EventStorePort.append` metadata → reactor copies `correlationId` from the triggering
`StoredEvent` into follow-up commands and their appends → outbound feed renders it onto
published events. The async effect gap (the v3.16 supervisor) must carry it through the
callback, or the chain breaks exactly where RES warns async handlers break (§2.5). Deciders
never see any of it — propagation is the shell's job, matching every surveyed system and the
purity rule.

**Fork 3 — one operational id end to end; business provenance stays translated.** The consumer
context adopts the producer's `correlationId` verbatim into its own event metadata; it does not
mint a replacement. This is what NServiceBus's ConversationId (override "not supported"),
Eventide's `correlation_stream_name`, and trace context all do (§2.10), and it is what the
constitution's own sentence requires — "follow a single operation through the whole system by
its correlation id" (`logging.md`) is unsatisfiable if each context re-mints. ACL purity is not
violated: the ACL translates the *model*; an opaque operational id in the metadata envelope is
not producer vocabulary. Keep the existing business-provenance pattern (`acquisitionId` on
imports) exactly as is — that one *is* domain language and *is* translated. Optionally record
the consumed feed position as the cross-context causation reference (Eventide-style provenance
coordinates). Report-as-designed: the published integration event schema gains an additive
optional metadata block carrying `correlationId` (and causation coordinates if desired).

**Fork 4 — no OTel SDK now; keep the exit open.** For one process, one operator, no tracing
backend, practitioner guidance is consistent that correlation ids suffice and full tracing "might
be overkill" (§2.8); the OTel machinery's payoff (span trees, timing, backend UIs) has no
consumer here. The attested middle path costs one decision: mint ids in a format that can later
*become* a trace id (32 lowercase hex, or a uuid you rename), because the convergence direction
is "trace id functions as your correlation id" (Last9) and "CorrelationId is taken automatically
from any active OpenTelemetry span" (Marten). Do not import `traceparent` parsing, spans, or
context propagation APIs for this.

**Fork 5 — request-scoped and dispatch-scoped pino children, passed explicitly.** Pattern:
(a) BFF — mint the id in the `handle` hook, create `logger.child({ correlationId })`, hang it on
`event.locals`, and let `handleError` include it alongside `errorId`; (b) reactors — per
delivered event, `logger.child({ correlationId, streamId, globalSeq })` and use that child for
the whole dispatch, passing it to effects; (c) adapters — keep receiving `Logger` via
constructor/argument, so they inherit whatever bindings the caller bound (this fixes "adapter
log lines omit the stream id" without adapters knowing about correlation at all). Children are
benchmark-cheap per unit of work (§2.9). ALS + `mixin` is the attested alternative and is worth
it only where explicit passing is impossible; this codebase's explicit-DI style makes children
the lower-magic fit. Bindings under app-controlled keys; existing central redaction untouched.

**Fork 6 — additive metadata is the industry retrofit path; never backfill.** Message DB's
`metadata` column is nullable jsonb with `write_message` defaulting it to NULL (§2.4); Marten
ships metadata off-by-default and lets you turn it on for events-from-now-on (§2.6). Old events
without correlation are normal and permanent: readers, projections, and the BFF must treat
`correlationId` as absent-able **forever** — no upcaster may invent one (an upcaster can reshape
facts, not fabricate provenance that never existed), and events are never edited. The published
zod schemas gain an optional metadata field — additive, contract-tested. Correlation indexes or
`$bc`-style lookups, if ever wanted, are rebuildable projections.

**Conflicts with the constitution:** none found. The design the field converges on is the one
the constitution already implies: metadata-envelope carriage preserves "events are facts, not
incidental telemetry" and domain purity; adopting one id end to end is the only reading under
which `logging.md`'s "through the whole system" sentence is achievable; additive optional fields
satisfy `api-compatibility.md`. The only *tension* worth minuting: a strict
"mint-per-context, translate at the ACL" position — defensible in pure context-mapping terms —
would conflict with `logging.md` and with all surveyed messaging practice; this research
recommends against it.

**Pitfall checklist for the OpenSpec proposal:**

- [ ] Define the vocabulary in the design doc (`correlationId` = story, `causationId` =
      immediate parent) — Axon-style inversion is a real hazard (§2.3).
- [ ] `correlationId` stays optional in every reader forever; pre-change events never get one;
      no upcaster fabricates ids.
- [ ] Metadata envelope only — no correlation field in any domain event payload, command type,
      or decider signature.
- [ ] Published integration schemas: additive optional metadata block; contract tests updated;
      tolerant readers on the consuming side.
- [ ] Every async hop is a break point: reactor dispatch, the download supervisor's
      settle-callback, catch-up subscription delivery, startup redrive. Each must copy the id
      from the triggering `StoredEvent` (or mint fresh where no trigger exists, e.g. redrive).
- [ ] Batch-append granularity: one `EventMetadata` per decision means one causation per batch —
      document that this is intended (the trigger is the parent of all its events).
- [ ] Reactor follow-up commands and effect-outcome commands carry the id explicitly; don't rely
      on ambient state across `await` gaps.
- [ ] Logger bindings under application-controlled keys; confirm no new binding collides with
      redaction paths or pino internals.
- [ ] If the id ever surfaces in the UI (e.g., quoting it in error messages next to `errorId`),
      audit `test/e2e` and Playwright parity first — scraped-surface blast radius.
- [ ] Choose the id format once (uuid vs 32-hex trace-id-compatible) and record why; either is
      fine, changing later is churn.
- [ ] Correlation-keyed queries, if wanted, are projections — rebuildable, never a second source
      of truth.

---

*Non-normative. This document records prior art and its convergences as of the research date; it
decides nothing. The OpenSpec change owns the actual design.*

## Sources

- Greg Young, "causation or correlation id?" — Kurrent forum:
  <https://discuss.kurrent.io/t/causation-or-correlation-id/828/4>
- Kurrent blog, "Did you know that EventStoreDB has a Visualize tab?" (`$correlationId`,
  `$causationId`, `$by_correlation_id`, `$bc-` streams):
  <https://www.kurrent.io/blog/eventstoredb-visualise-tab/>
- NServiceBus message headers (ConversationId, RelatedTo, CorrelationId, MessageId):
  <https://docs.particular.net/nservicebus/messaging/headers>
- NServiceBus message correlation:
  <https://docs.particular.net/nservicebus/messaging/message-correlation>
- Axon Framework 4.12, Message Correlation (`MessageOriginProvider`, correlation data
  providers):
  <https://docs.axoniq.io/axon-framework-reference/4.12/messaging-concepts/message-correlation/>
- Eventide metadata & messages docs **[secondary — site HTTP-only, quotes via search excerpts]**:
  <http://docs.eventide-project.org/user-guide/messages-and-message-data/metadata.html>,
  <http://docs.eventide-project.org/user-guide/messages-and-message-data/messages.html>
- Message DB (schema, nullable `metadata` jsonb, `write_message`, `correlation` filter):
  <https://github.com/message-db/message-db>
- Rails Event Store, Correlation and Causation:
  <https://railseventstore.org/docs/core-concepts/correlation-causation>
- Arkency, "Correlation id and causation id in evented systems":
  <https://blog.arkency.com/correlation-id-and-causation-id-in-evented-systems/>
- Marten, Event Metadata (opt-in flags, session scoping, OTel span sourcing):
  <https://martendb.io/events/metadata.html>
- W3C Trace Context (traceparent format):
  <https://www.w3.org/TR/trace-context/>
- OpenTelemetry logs spec (TraceId/SpanId in LogRecords):
  <https://opentelemetry.io/docs/specs/otel/logs/>
- pino child loggers and API (`child`, `mixin`, bindings) — GitHub (getpino.io unreachable):
  <https://github.com/pinojs/pino/blob/main/docs/child-loggers.md>,
  <https://github.com/pinojs/pino/blob/main/docs/api.md>
- pino-http (`genReqId`, `req.log`):
  <https://github.com/pinojs/pino-http>
- Maxim Orlov, "Logging with Pino and AsyncLocalStorage in Node.js":
  <https://maximorlov.com/logging-with-pino-and-asynclocalstorage-in-nodejs/>
- Last9, "Correlation ID vs Trace ID":
  <https://last9.io/blog/correlation-id-vs-trace-id/>
- Hohpe & Woolf, Correlation Identifier:
  <https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html>
- Commanded issue #70 (framework adoption of Young's rule) **[secondary]**:
  <https://github.com/commanded/commanded/issues/70>
- Codemia, correlation id changes across contexts **[secondary]**:
  <https://codemia.io/knowledge-hub/path/handling_correlation_id_changes_in_event_sourcing_when_an_entity_switches_context>
