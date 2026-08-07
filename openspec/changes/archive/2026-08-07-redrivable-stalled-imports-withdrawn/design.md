# Design — redrivable-stalled-imports

## Context

See `proposal.md` for motivation (the 2026-08-02 chromaprint incident; recovery required manual
store surgery — the procedure is recorded in session memory `import-reactor-redrive-procedure`).

What already exists and is NOT changed here:

- The reactor's durable retry budget, dead-lettering, and stalled exposure
  (`import-management` spec "A failing import effect's retry budget is durable…"): budgets live
  in `parked_effects` keyed by the event's `global_seq`; dead letters carry the owning
  `stream_id`; the stalled read model seeds from the dead-letter store at boot; `clearStalled`
  clears dead letters + exposure when any non-failing event of the stream is processed
  (`packages/importer/src/application/import/reactor.ts`).
- `ApplyingState` retains `directory` and `mode` (`state.ts`), and `react()` already derives the
  Apply effect purely from that state for existing arms (`react.ts`).
- The import status DTO already exposes `stalled?: true` (additive, decided).

## Goals / Non-Goals

**Goals:** the redrive is one domain event riding the existing durability machinery; the UI
renders the decided stalled fact and offers one honest affordance; recovery never touches the
store by hand again.

**Non-Goals:** no automatic redrive policy (a stall means something environmental needs a human
first — the incident's fix was a config change); no reactor/durability changes; no import detail
page; no downloader involvement; no liveness/pacing changes (a stalled page keeps its poll — the
retry resolves on the very page being watched).

## Decisions

### D1 — The redrive is a domain event; the durability machinery does the rest

New command `RetryApply` → event `ApplyRetryRequested` (no payload beyond the standard
metadata):

- `decide`: terminal states absorb (`ok([])`, the established terminal-absorption pattern);
  phase `applying` emits `ApplyRetryRequested`; every other phase is the modeled `illegal`
  refusal.
- `evolve`: identity on the applying state — the event is a re-drive fact, not a state change.
- `react`: `case 'ApplyRetryRequested'` mirrors the existing arms —
  `state.phase === 'applying' ? [{ type: 'Apply', directory: state.directory, mode: state.mode }] : []`.

Everything else is emergent from the shipped durability design, deliberately: the new event has
a new `global_seq`, so `parked_effects` starts a fresh attempt tally (fresh budget by
construction); processing the event is a non-failing stream event, so `clearStalled` clears the
old dead letters and the stalled exposure; if the re-driven apply fails through its budget, it
dead-letters and stalls again through the normal path. Alternative considered — an infra-level
"redrive dead letter" facade operation replaying the original event (rejected: it would need
checkpoint surgery semantics in production code, bypass the event log's account of what
happened, and leave the timeline unable to narrate the retry).

### D2 — The stalled gate lives in the application layer

`retryImport` (use-case) consults the stalled exposure before dispatching `RetryApply`: not
stalled → modeled `NotStalled` refusal. Rationale: "stalled" is an infrastructure fact (dead
letters), not a domain fact — the domain guard stays phase-only, and the application layer is
the altitude that composes domain + infra. This keeps the affordance honest (a live, still-
retrying apply can't be double-dispatched into two concurrent bridge runs) while the domain
stays pure. The double-click race (two retries before the first processes) is bounded: the
second `RetryApply` finds the exposure already cleared → refused; and the bridge adapter
serializes invocations regardless (its own design: one bridge process at a time).

### D3 — Additive facade surface

- Command `retryImport({ id })` → modeled errors: `NotFound`, `NotStalled`, and the decide-level
  refusal for wrong phases. Response `{ importId }` (matches `resolveReview`'s shape).
- History: additive entry kind `apply-retried` (carrying `at`), so consumers narrate instead of
  hitting the tolerant unknown arm. Existing consumers are tolerant readers — additive-only rule
  holds.
- No new list/read endpoints: the queue composes from `listImports()` (already carries
  `stalled?` and `acquisitionId?` per entry).

### D4 — The copy (reviewed as content; extends the shipped register + verb inventory pattern)

| Surface | Copy |
| --- | --- |
| Overall status (stalled) | tone `attention`, phrase `Adding to the library stopped — needs a retry` |
| Now-row (stalled) | attention state (no spinner): `Adding to the library stopped — retry it below` |
| Retry affordance | `Retry adding to the library` — consequence-free label (the consequence IS the label's verb); dispatches `retryImport` |
| Timeline `apply-retried` | Layer 1 `Retried adding to the library`, state routine, no disclosure payload |
| Attention queue chip (ask) | `Retry the import` |
| Modeled `NotStalled` error | `This import isn’t waiting on a retry — it may have resumed or settled. Reload to see its current state.` |

Register rules as shipped: no internal vocabulary (dead letter, reactor, effect stay out of
layer 1), verb-led imperative affordance, no hedges on deterministic outcomes. The stalled
now-row and status phrase gate on the DECIDED `stalled` flag (v3.12.0 doctrine), never on
re-deriving from history shapes.

### D5 — Queue membership and titling

`attentionItems` gains a third arm: imports from `listImports()` with `stalled === true` become
items (kind `stalled-import`, module importer, ask per D4), titled through the existing
composed-title fallback chain (the queue load already composes titles by import id). Items with
an acquisition correlation link to `/acquisitions/{id}` (where the affordance lives); an
uncorrelated stalled import is still listed — `AttentionItem.href` becomes optional and an
unlinked row renders its title plainly (listed-not-dropped per the web-ui sparse-fields rule).
The nav badge count follows automatically (it reuses `attentionItems`).

## Risks / Trade-offs

- [Retry offered while the cause persists → stall loops] → accepted and honest: each loop is an
  explicit human act; the fresh dead letter re-exposes the stall; the incident-class fixes are
  environmental (config/image) and the affordance note tells the user nothing it can't promise.
- [Two rapid retries] → bounded by the D2 gate + serialized bridge; worst case one modeled
  refusal after the fact.
- [`apply-retried` shown to older acquisitions' merged timelines] → additive kind; the web's
  tolerant arm covers a version skew window (single deployable, so none in practice).
- [Stalled page keeps polling at ~5s] → unchanged from today; the page in question is exactly
  where the human acts, and the poll picks up the outcome.

## Migration Plan

Additive events/commands only; history folds at read time; no upcasters, no storage changes.
Standard release pipeline; rollback is a prior-image redeploy.

## Open Questions

None blocking. Deferred by intent: exposing the dead-lettered error text through the facade for
the detail page's disclosure (today it lives only in logs/store; the visible line doesn't need
it and the incident memory records the operator path).
