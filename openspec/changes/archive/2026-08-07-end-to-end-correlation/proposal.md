# Proposal: end-to-end-correlation

## Why

`docs/development/logging.md` promises "follow a single operation through the whole system by
its correlation id" — and none of it exists. The whole-project review sweep (2026-08-05) found
`EventMetadata.correlationId` declared in both contexts and populated nowhere, zero child-logger
bindings, and adapter log lines omitting even the stream identity in scope, so an incident's
adapter half cannot be joined to its acquisition. The design follows
`docs/research/correlation-causation-conventions.md` (adopted wholesale, grill 2026-08-05):
seven independent designs converge on the same shape, and the constitution's promise is
unsatisfiable with anything less.

## What Changes

- **The pair, defined once.** Every unit of work carries a **correlation id** — the story,
  minted once at the outermost trigger in a W3C-trace-id-compatible format and copied verbatim
  through every hop — and a **causation reference** — the immediate parent, rewritten at each
  hop, expressed as store coordinates (`streamId@version`) when the parent is an event rather
  than a fresh UUID. Terminology is fixed as correlation/causation (the Young/ESDB naming; the
  research documents the Axon inversion hazard).
- **Minted at the outermost trigger, carried by the shell.** The BFF's request hook mints per
  request; non-HTTP triggers (pollers, the intake scanner, boot re-emit, the drafted redrive
  verb) mint fresh per unit of work. Commands carry an application-level context; append writes
  it into event metadata; reactors copy the story id from the triggering stored event and point
  causation at it; the supervisor pins the watch's originating context at watch creation so its
  async callbacks and outcome delivery inherit it. Deciders and evolve never see any of it.
- **One operational id crosses the seam.** Published integration events gain an optional,
  additive metadata block; the consuming context adopts the producer's correlation id as its own
  operational story id (causation pointing at the consumed event), per the unanimous field
  practice — the ACL translates the model, never the observability envelope. Business
  provenance (`acquisitionId`) is untouched and remains a separate concept.
- **Logs bind the same identity.** Request-scoped pino child at the BFF (on `locals`),
  per-dispatch children in reactors and the supervisor binding
  `{correlationId, streamId, globalSeq}`, adapters inheriting through the already-injected
  logger — no adapter-code awareness, no ambient AsyncLocalStorage.
- **Additive-only retrofit.** Metadata fields are optional in every reader forever; historical
  events are never backfilled and upcasters never fabricate ids; published schemas evolve
  additively under the existing contract gates. Correlation-keyed queries, if ever wanted, are
  projections — never truth.
- **Non-goals:** no OpenTelemetry SDK, exporter, or tracing backend (trace-id-compatible format
  keeps that door open); no inbound `traceparent` trust at the BFF (we mint, we don't adopt
  callers' ids); no UI surfacing of ids (log-and-store-only — keeps the e2e copy blast radius at
  zero); no retroactive correlation of pre-change events.

## Capabilities

### New Capabilities

- `operation-correlation`: the correlation/causation identity contract — pair semantics,
  minting points, shell-only carriage, cross-seam adoption, log binding, and the additive
  retrofit rules.

### Modified Capabilities

- `outbound-events`: the downloader's published events gain the optional correlation metadata
  block under the additive-only contract.
- `importer-outbound-events`: the importer's published verdicts gain the same optional block.

## Impact

- **Code:** both modules' application layers (command context, append metadata, reactor
  propagation, supervisor context pinning), both facades' command entry points, the BFF request
  hook and server logger, adapters only via the loggers they already receive; both published
  event renderers/schemas (additive) and their contract gates; no domain-layer changes.
- **Contracts:** additive only — optional metadata on stored events and published events;
  tolerant readers unchanged in behavior when the block is absent.
- **Docs:** `logging.md`'s Correlation section becomes true rather than aspirational; the
  research doc's 11-item pitfall checklist is tracked in design.md.
- **Operations:** incident debugging gains story-joined logs across BFF → reactor → adapter →
  cross-context consumer; nothing changes for existing data.
