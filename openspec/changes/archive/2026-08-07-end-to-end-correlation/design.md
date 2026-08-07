# Design — end-to-end-correlation

## Context

See proposal.md — Why. Current state: `EventMetadata` (both contexts) has `acquisitionId`/
`importId`, `occurredAt`, and a dormant optional `correlationId`; appends are performed by
application services and reactors; the BFF has a single `handle` hook and a server logger;
adapters already receive injected pino loggers; published events are rendered through
producer-owned zod schemas with additivity gates. Evidence base:
`docs/research/correlation-causation-conventions.md` (adopted wholesale, grill 2026-08-05);
its 11-item pitfall checklist is tracked below.

## Goals / Non-Goals

**Goals:** the pair end to end (request → command → events → reactor follow-ups → published
events → consuming context), logs joined to stories, zero domain impact, additive-only.

**Non-Goals:** OTel SDK/backends; inbound `traceparent` adoption; UI surfacing; backfill;
correlation-keyed read models (a rebuildable projection may come later if ever needed).

## Decisions

**D1 — Names and shapes.** `correlationId`: 32-hex-char W3C-trace-id-compatible string, minted
via `crypto.randomBytes(16)`. `causation`: a discriminated reference — `{kind: 'event',
streamId, version}` for stored-event parents, `{kind: 'command', commandId}` for
request-minted commands (commandId a fresh UUID minted with the context). Store coordinates
over per-event UUIDs (Eventide precedent) — no new identity columns, replay-stable. Terms fixed
correlation/causation; the research's Axon-inversion hazard is documented at the type.

**D2 — CommandContext at the application seam.** A `CommandContext {correlationId, causation}`
travels as an explicit argument alongside commands into the application services (never inside
the command object the domain sees). Append attaches it to `EventMetadata` (additive optional
fields: `causation` joins the existing dormant `correlationId`). Alternative — ALS ambient
context: rejected per research (explicit passing is the attested default; ALS only where
passing is impossible, which is nowhere in this codebase).

**D3 — Minting points enumerated (pitfall: async-hop break points).**
- BFF `handle` hook: mint per request, stash on `locals` with a request-scoped child logger;
  facade command calls thread the context.
- Reactor dispatch: copy the story from the triggering `StoredEvent`'s metadata (fresh mint if
  absent — pre-change events), causation = that event's coordinates; per-dispatch child logger
  binds `{correlationId, streamId, globalSeq}`.
- Supervisor: the watch pins the originating dispatch's context at creation; all async
  callbacks, teardown, and outcome delivery log and deliver under it (the v3.16 callback is the
  research's named break point).
- Poll ticks, intake scanner, boot re-emit, redrive verb (drafted in stalled-work-recovery):
  each mints fresh at its trigger. The redrive draft needs no artifact change — its verb is an
  outermost trigger by this design's definition.
- Batch appends (pitfall: causation granularity): every event of one decision shares the one
  causation reference — the deciding command — not chained event-to-event within the batch.

**D4 — Seam carriage.** Producer renders the optional metadata block; the consumer's tolerant
intake reader parses it (absent ⇒ mint fresh, per spec) and the intake's command context
adopts the story id with causation = consumed event coordinates (namespaced by the producer
context, e.g. `downloader:streamId@version`, so coordinates stay unambiguous across stores).

**D5 — Logger topology.** One binding rule: whoever starts a unit of work creates the child;
everyone else logs through the logger they're handed. Web: `locals.logger`. Reactors/
supervisor: dispatch-scoped child passed into interpreters/effect handlers, which already
receive loggers — adapters change zero lines beyond what S1's structured-field cleanups
already touch. `DEFAULT_REDACT_PATHS` unaffected (ids are not secrets).

**D6 — Contract growth.** Both published schemas gain the optional block; additivity gates and
frozen fixtures prove compatibility (spec'd). The stored-event side needs no upcaster — optional
fields on metadata, absent forever on old rows (pitfall: never fabricated).

**D7 — Testing shape (pitfall: e2e blast radius).** Ids never render in UI copy, so the e2e
scrape surface is untouched; e2e gains only a log-side assertion (one submission's story id
appears in both modules' log lines — cheap grep against captured container logs, no new phase).
Unit tiers pin: mint-once-copy-verbatim, causation rewrite per hop, seam adoption, absence
degradation, and the domain-blindness boundary (a grep-backed test that no domain signature
names the pair, same style as the boundaries tier).

## Risks / Trade-offs

- **[Context threading touches every command call site]** → Mechanical, compiler-driven (new
  required parameter on application services; facades construct it from `locals` or trigger
  mints); domain untouched keeps the diff shallow per site.
- **[A missed hop silently breaks the chain]** → The e2e log-join assertion catches the
  golden path; unit pins cover each enumerated hop from D3; the pitfall checklist's hop
  inventory is the review checklist for the implementing PR.
- **[Two stores' coordinates could collide in causation references]** → D4's context
  namespacing makes references unambiguous by construction.
- **[Future OTel adoption]** → Format-compatible ids mean adoption is additive (span context
  wraps the same id); no rework debt minted.

## Migration Plan

Additive deploy; no data migration; old events trace-degrade by design. Rollback is the
previous image — new metadata is ignored by old readers (optional fields under tolerant
schemas).

## Decisions settled at implementation

**D8 — Fresh-mint-on-absent logs at DEBUG** (the open question, closed). A pre-correlation row
can never gain a story, so the line says nothing an operator can act on; and the boot drain over
historical streams would emit it once per stream. It is a trace-quality note for whoever is
already reading debug output, not an operational event.

**D9 — Two compiler gates instead of call-site discipline.** The Risks section called context
threading "mechanical, compiler-driven"; concretely that is: (a) `applyCommand` takes a required
`CommandContext`, and (b) `EventStorePort.append` takes an `AppendMetadata` whose pair is
NON-optional while the read-side `EventMetadata` keeps both optional forever. The asymmetry is the
point — tolerance belongs to the reader. `applyCommand` is the only production append path in
either module, so between the two gates there is no way to write an uncorrelated event from today
on, and no way to read historical rows incorrectly.

**D10 — `OperationScope` on every effect port.** Effects receive `{context, logger}` — the identity
to carry plus a logger already bound to it — as the LAST parameter of every outbound port method,
without exception, so there is no per-port rule to remember and the compiler catches a missed site.
Adapters consequently no longer own a constructor logger: they log through what each operation
hands them, which is what makes D5's "adapters change zero lines of correlation awareness" true in
substance (they never name the pair) even though their signatures did change. `TaggerPort.validate`
is the one exemption: it is a startup gate, not an operation.

**D11 — The published block carries the story plus the event's OWN coordinates.** Not the
producer's internal causation chain: that is provenance the consumer has no use for, and shipping
it would leak the producer's stream graph across the seam. The consumer turns the published
coordinates into its causation reference. The block sits beside `data`, never inside it, because it
is an observability identity rather than either context's vocabulary.

**D12 — The verdict publishes its CYCLE's story, not the resolving request's.** A human resolving
a review is its own outermost trigger with its own story, so `ReleaseVerdictRecorded` carries that
one in its metadata — which would break the round trip `importer-outbound-events` requires. The
renderer therefore folds the prefix back to the most recent `ImportRequested` and publishes under
that cycle's story. Walking to the CYCLE start rather than the stream start is what keeps the
revival loop honest: a replacement delivery opens a new cycle under its own adopted story.
Alternative considered and deferred: making every command against an existing stream continue that
stream's story. That is a broader semantic change (it would supersede the request's own mint for
cancel/select/resolve) and was out of scope here.

**D13 — The pair is duplicated per context, not shared.** Each module owns its own
`CommandContext`/`CausationReference`/`CorrelationSource`, exactly as each already owns a
byte-identical `EventStorePort` and `EventMetadata`. A shared correlation module would be a shared
kernel coupling the two languages; the envelope crosses the seam as DATA, never as a common type.
The web layer mints its own story too, because a story belongs to neither module — one request
drives both, and each adopts what it is handed. The facades therefore take a plain `StoryId`
string, not either module's branded `CorrelationId`.

**D14 — The e2e proves the join over the STORES, not captured logs.** D7 proposed a grep against
container logs. The stored metadata carries the same id by construction (the reactor binds its
child logger from the very context it appends with), and the store is deterministic where captured
stdout is not — so `full-loop` asserts the BFF-minted story appears, verbatim and alone, in both
modules' event stores. Log binding itself is pinned by unit tests at the BFF and both reactors.

**D15 — There is no intake scanner.** D3 enumerated one; the codebase has none — intake is purely
event-driven, and the seam subscription's poll is its trigger. Likewise, the reactor's non-HTTP
triggers (fallback poll, boot re-drive, parked retry) do not mint: they DELIVER a stored event,
which already has a story, so they continue it. Fresh minting outside the BFF happens only where
there is genuinely no parent — a pre-correlation row, or a seam delivery with no envelope.

## Decisions taken during review (cycle 1)

**D16 — `absent` and `malformed` are different facts and are reported differently.** D8's
debug-level ruling reasons entirely from pre-capability rows: permanent, expected, and something no
operator can act on. A story that is PRESENT but unusable is the opposite — every append since this
capability shipped passes a compiler-checked write gate, so a malformed stored id means a writer is
emitting bad ids right now. `continueFrom` and `adoptOrMint` therefore return a `StoryOrigin`
instead of leaving each caller to re-derive the condition (which is how a log line and the
behaviour it describes drift apart), reactors warn on malformed and debug on absent, and the seam —
where malformed means a live producer's envelope has diverged and every cross-context trace is
broken until it is fixed — announces it through an injected channel.

**D17 — The correlation envelope is attached AFTER outbound validation.** Rendering it inside the
validated payload made a defect in a purely diagnostic field a `RenderError`, which is permanent by
contract: the feed surfaces it, the consumer's checkpoint holds, and it recurs identically on every
retry. A broken trace could have head-of-line-blocked the whole seam indefinitely. Telemetry may
degrade the trace; it may never stop the work.

**D18 — The persisted causation union is parsed, not cast.** Event payloads go through the upcaster
registry; metadata goes through neither an upcaster nor a schema, and it now carries a discriminated
union. `parseCausation` re-establishes the tag at the read edge and drops anything unrecognised, so
the first reader to narrow on `kind` cannot read a field off a shape nothing verified.

**D19 — The format invariant is enforced by the mint, not by documentation.** `CorrelationSource`
mints the BRANDED id, so the composition root is the single place the 32-hex format is established
and every downstream lift follows from a constructor. The write-side metadata's story is branded
too, which closes the "fabricate provenance by spreading a read-side metadata" hole.

**D20 — What opens an import cycle is the aggregate's fact.** The verdict renderer originally
string-matched `ImportRequested` itself; a second cycle-opening event would have left it compiling,
validating, and silently publishing the previous cycle's story. `isCycleStart` is an exhaustive
switch in the importer's domain, so that change becomes a compile error at the one place that must
decide.

**D21 — The seam is pinned by producer-rendered fixtures, not by two authors' intentions.** The
producer's published schema and the consumer's tolerant reader are independently hand-authored and
no type connects them, while `contextForDelivery` swallows an unreadable envelope into a fresh
story by design — so a drift between them would have left every suite green and silently detached
every cross-context trace, caught only by the main-gated e2e. Both directions now carry a v2 fixture
rendered by the producer's own mapping and replayed through the consumer's reader in the contract
tier, which runs on every PR.

**D22 — Deliberate duplication is pinned.** A boundaries test asserts the two contexts' correlation
modules are identical modulo the context name, so D13's shared-kernel avoidance cannot decay into
accidental divergence.

**Recorded, not fixed** (raised in review, deliberately deferred):
- The slskd supervisor's long-lived collaborators (`TransferLedger`, `TransferTeardown`,
  `StagedFileResolver`) are constructed once and outlive any operation, so their lines carry
  `acquisitionId` but no story. Documented at the constructor.
- The facade's malformed-story degradation is silent: the facade owns no logger, and its only
  production caller mints the id itself, so the branch is unreachable today. The day a second
  interface (MCP, HTTP) exists it should report — `adoptOrMint` already returns the origin for it.
- `OperationScope` is wider than most ports need (only `DownloadPort` reads its context). The
  uniform rule is kept deliberately: the alternative is a per-port distinction that gets forgotten
  at a new call site, and the compiler-catches-a-miss property is worth more than the narrowing.
