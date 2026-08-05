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

## Open Questions

- Whether the reactor's fresh-mint-on-absent path should log at info or debug when it
  synthesizes a story for a pre-change stream — a log-noise calibration settled at
  implementation.
