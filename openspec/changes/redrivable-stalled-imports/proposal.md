# Proposal: redrivable-stalled-imports

## Why

The 2026-08-02 incident (chromaprint abort → dead-lettered apply) proved that when an import
stalls, the system knows — the reactor dead-letters the effect and the status read model exposes
`stalled` — but the user can't see it and can't act on it. The acquisition page showed
"Adding to the library…" forever, the attention queue showed nothing, and recovery took manual
SQLite surgery on the production store plus a container restart. A stalled import is a
human-decision pause; the web-ui spec already demands every such pause surface in the attention
queue, and an operator affordance must exist so recovery is a click, not database surgery.

## What Changes

- **A redrive is a domain fact.** New importer command `RetryApply` → event `ApplyRetryRequested`,
  legal only while the import is in its `applying` phase. The reactor reacts to it by re-deriving
  the same Apply effect it derives today from the applying state — which, by the existing
  durability design, automatically grants a fresh retry budget (budgets key on the new event's
  position) and clears the old dead letters (`clearStalled` fires on any non-failing event of the
  stream). Zero changes to the reactor's durability machinery.
- **The facade gains an additive `retryImport` command**, permitted only while the import is
  actually stalled (the application layer consults the stalled exposure; a non-stalled applying
  import gets a modeled refusal, so the affordance can't double-dispatch a live apply).
- **The import history additively gains an `apply-retried` kind** so the timeline narrates the
  retry in the register instead of falling to the tolerant unknown-kind line.
- **The web renders the decided `stalled` flag** (v3.12.0 doctrine — rendered, never re-derived):
  the acquisition detail presents the stall as an attention state with a retry affordance in the
  affordance register, and stalled imports join the attention queue with an ask-oriented chip.
- **Non-goals:** no downloader changes; no reactor/durability changes; no automatic re-drive
  policy (retry stays a human decision); no import detail page (the acquisition detail remains
  the surface); no change to liveness pacing.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `import-management`: new requirement — a stalled import is redrivable through a domain command
  that grants a fresh budget and clears its dead letters; the facade exposes it as an additive
  command and narrates it as an additive history kind.
- `web-ui`: the acquisition detail SHALL present a stalled import as an attention state with a
  register-compliant retry affordance; the attention queue SHALL list stalled imports.

## Impact

- **Code:** `packages/importer` domain (`commands/events/decide/evolve/react`), application
  (retry use-case + stalled gate), facade (additive command + history kind);
  `packages/web` (copy additions, acquisition-detail affordance + route action, attention
  queue membership). No `packages/downloader` changes.
- **Contracts:** additive only — one facade command, one history entry kind. No cross-module
  contract touch; no upcasters (new event type, existing events unchanged).
- **Tests:** full unit ladder in both packages; e2e blast radius expected nil (new testids only)
  but local `pnpm test:e2e` mandatory (user-visible strings in the diff).
