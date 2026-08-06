# Proposal: stalled-work-recovery

## Why

Both modules' reactors dead-letter an effect after its retry budget exhausts, mark the stream
stalled, and wait for an operator — but the whole-project review sweep (2026-08-05) confirmed
the flag dies at the BFF: nothing under `packages/web` reads `stalled`, so a dead-lettered
import renders as ordinary in-flight work forever, and recovery is DB surgery plus a restart
(the chroma-plugin incident, verbatim). The download supervisor has the sibling gap: an
undeliverable outcome retries on a flat 1s cadence forever, invisible to `/health` — the
consciously deferred v3.16.0 follow-up. The grilling session (2026-08-05) converged the design;
the evidence base is `docs/research/dead-letter-redrive-semantics.md`, whose verdicts attest
every decision below and whose pitfall checklist shapes the specs.

## What Changes

- **Stalled work becomes visible in two registers.** The user register tells the truth in the
  narrator's voice — a stalled acquisition/import reads as stuck and needing the system's
  operator, never as an eternal "Adding to the library…" — on detail pages and list rows, with
  no verb attached. The attention queue stays scoped to user-resolvable judgments; operator
  work is expressly not its concern (its charter is amended to say so).
- **An owner-gated operations surface** (first consumer of `auth-roles`' `authorize` seam and
  its reserved `system:redrive` action) lists exactly the stalled work across both modules —
  linked item, when it stalled (the ledger's `occurredAt`, finally a real producer for
  longest-waiting ordering), and the dead-letter diagnostics in the operator's register — with
  per-item **redrive** and a redrive-all convenience. Expansion trigger: a second operational
  concern needing eyes (the supervisor's delivery-failure state is the named candidate).
- **The redrive verb is an infra operation, not a domain fact** (research §4: the
  systemd/ServiceControl camp; Temporal-style history mutation explicitly rejected). Per module,
  fire-and-forget: under the dispatch mutex, clear the stream's letters and stalled mark through
  the one existing seam, log the cleared trail (count, errors, ages — research §5.2), and
  re-dispatch the pending effect derived from folded state through the normal
  park → backoff → exhaust → dead-letter ladder — a fresh full budget (research §5.1, the
  majority camp), re-stalling honestly at its end. No domain event; duplicate settlement is
  absorbed by `decide` as stale (research §5.3). Redriving a non-stalled stream is a modeled
  no-op refusal; concurrent redrives are idempotent.
- **No letters-dismissal verb** — in this architecture a dismissed-but-unredriven stream is just
  a deferred redrive (the next boot re-derives the effect), so give-up remains the domain's own
  cancellation, offered alongside redrive on the operations surface (research §5.5, the
  altitude-split pairing).
- **The supervisor's delivery loop escalates beyond logs**: bounded escalating backoff replaces
  the flat 1s cadence, and persistent delivery failure degrades the module's readiness snapshot
  so `/health` finally sees it. Restart re-emit stays the durable heal; no new durable store.
- **The e2e tier gains a recovery phase**: force a genuine importer stall (unwritable library
  mount) against an env-tunable retry budget, witness the user-register telling, repair, redrive
  from the operations surface, and witness completion — the operator's golden path, exercised
  out-of-process.
- **Non-goals:** no domain/event-schema change in either module; no letters archive/episode
  counter (surfaced as a recorded refinement trigger, not built); no broader ops cockpit; no
  changes to the Needs-attention queue's membership.

## Capabilities

### New Capabilities

- `web-operations`: the owner-gated operations surface — the stalled-work list with operator
  diagnostics, the redrive verbs (per-item and all), the cancellation pairing, and its gating
  through the authorization seam.

### Modified Capabilities

- `cross-module-delivery`: dead-lettered work becomes operator-redrivable — the redrive
  operation's semantics (precondition, mutex seat, one clearing seam, fresh budget through the
  normal ladder, logged trail, fire-and-forget) join the park/dead-letter contract.
- `download-management`: the undeliverable-outcome delivery loop gains bounded escalating
  backoff and a readiness consequence.
- `runtime-baseline`: the readiness snapshot reflects persistent outcome-delivery failure, not
  only halted subscriptions. (e2e-review-resolution-loop hand-off: a seam subscription HELD past
  its retry budget — e.g. the intake consumer's `ExistingCycleStalled:<acquisitionId>` hold
  behind a dead-lettered intake deletion — head-of-line-blocks the seam while readiness reads
  `up`; a held-past-N-cycles readiness consequence belongs here.)
- `web-ui`: stalled work tells the truth in the user register; the attention queue's charter is
  scoped to user-resolvable judgments.
- `out-of-process-e2e`: the stall → surface → redrive → recovery phase.

## Impact

- **Code:** both modules' application layers (redrive operation on the reactor, facade queries
  for stalled diagnostics, facade redrive verb), the downloader's slskd supervisor (backoff +
  readiness wiring), both facades' additive DTO growth, `packages/web` (user-register tellings,
  the `/system` operations route behind `authorize`, verb-inventory entries), `test/e2e` (new
  phase + env-tunable retry budget), contract tiers for the additive facade shapes.
- **Contracts:** additive only — new facade queries/verbs and optional DTO fields; the wire
  `stalled` flag already exists on both facades (the downloader's encoding is being aligned to
  `z.literal(true)` by the concurrent S2 hardening batch; this change builds on it either way).
- **Dependencies:** requires `auth-roles` (the seam and the `system:redrive` action) merged
  first.
- **Operations:** closes the review sweep's sole Critical-severity gap and retires the
  DB-surgery redrive procedure memorialized in the incident notes.
