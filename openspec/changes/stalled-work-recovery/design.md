# Design — stalled-work-recovery

## Context

See proposal.md — Why. The machinery is nearly all in place at v3.16.0: dead letters are rows
`(subscription, globalSeq, error, occurredAt, streamId)` in each module's store; the in-memory
`StalledReadModel` seeds from them at boot; the startup re-drive derives pending work from
folded state under the dispatch mutex and skips stalled streams; a later successful dispatch
already clears letters + exposure through one seam; both facades already emit a `stalled` flag
the web never reads. What is missing is a trigger that does not require a restart, the facade
reads/verbs around it, and the two registers' surfaces. Evidence base:
`docs/research/dead-letter-redrive-semantics.md` (all five verdicts + the ten-item pitfall
checklist, which this design tracks item by item); grill decisions 2026-08-05 in-conversation.
Depends on `auth-roles` (the `authorize` seam, `system:redrive` reserved).

## Goals / Non-Goals

**Goals:**

- Retire the DB-surgery redrive procedure: see, diagnose, and recover stalled work from the UI.
- Keep the domain pure: no stall/redrive concept enters events, commands, or deciders.
- Make the supervisor's undeliverable-outcome pathology visible to `/health`.

**Non-Goals:**

- No episode counter / letters archive (research §5.1–5.2 refinements; trigger: scripted or
  repeated redrive against the same stream becomes a real pattern).
- No pending-retries subsystem (research §5.3 — the stalled flag's stay-cleared-or-return
  behavior is the outcome signal, the Sidekiq property).
- No SSE/liveness changes; the existing self-refresh carries the stalled telling.
- No importer-supervisor work: the delivery-loop changes are downloader-only (the importer has
  no supervisor).

## Decisions

**D1 — The redrive operation lives on the reactor, exposed via the facade.** Each module's
reactor gains `redriveStalled(streamId)`: take the dispatch mutex (pitfall 2 — same seat as the
startup re-drive's check-then-act guard), verify letters exist (pitfall 1 — modeled refusal
otherwise; concurrent submissions collapse to one refusal + one run), log the letters about to
clear (pitfall 5), clear via the existing `clearStream` + `stalled.clear` seam (pitfall 4 — one
seam, read model can never disagree with the table), then reuse the existing `redriveStream`
logic minus its stalled-skip (pitfall 3 — normal ladder, fresh budget, no special mode; pitfall
7 — no arguments beyond the stream). The facade wraps it as a fire-and-forget verb returning
accepted/refused (pitfall 8). Alternative considered — a standalone application service
orchestrating store + reactor: rejected, it would duplicate the mutex and the pending-effect
derivation the reactor already owns.

**D2 — Stalled-work read is a facade query over existing parts.** `listStalled()` joins the
dead-letter rows (diagnostics, `occurredAt`) with the stream's work identity — additive DTO,
operator-register fields explicitly documented as such (raw error text is the point; the
recorder-style scrub question does not arise because nothing leaves the process). The web
composes both modules' reads; no cross-module contract (the compose stays in the BFF like the
attention queue's).

**D3 — Registers split exactly as grilled.** User register: `stalled` tone/copy joins the
existing decided-flag consumption path in `copy.ts`/detail/list (no re-derivation; the S2
hardening batch's `z.literal(true)` alignment is assumed but not required — `boolean` reads the
same). Operator register: a `/system` route behind `authorize(session, 'system:redrive')`;
its copy is exempt from the narration register (spec'd in `web-operations`), and the verb
inventory gains the redrive entry as non-destructive (pitfall 10) with cancellation offered
through the existing destructive-gated form.

**D4 — Supervisor backoff + readiness.** The `deliver` loop's flat `pollIntervalMs` sleep
becomes escalating backoff (base = poll cadence, factor 2, env-capped ceiling), keeping the
existing warn→error escalation cadence. Persistent failure past a configured attempt threshold
sets a delivery-failure gauge the runtime's `readiness()` consults; success (in-process or
post-restart re-emit) clears it. Threshold and ceiling are ordinary env config with defaults;
no new durable store (restart re-emit remains the heal). Stalled streams deliberately do NOT
degrade readiness (spec'd in `runtime-baseline`) — they are operator work, not process faults.

**D5 — E2E forces the stall with permissions, tunes the budget with env.** The phase makes the
staged library destination unwritable (root-owned read-only bind mount), submits a normally-
completing flow, waits for the stalled telling (env-tuned budget: retry count and backoff base
already flow from composition config; the e2e run sets them small), restarts once to prove
durability, repairs the mount, redrives via the operations route with an owner session (the
harness already mints cookies via the production codec — it gains the role claim from
`auth-roles`), and asserts ordinary completion. Copy scraped through `helpers.ts`'s centralized
phrase maps (the S3 batch moves the strays there).

**D6 — Naming.** The user-facing telling avoids "stalled" (jargon-adjacent); the register pass
picks the phrase during implementation, in the narrator's voice, with the tone map extended
exhaustively (`satisfies` totality as everywhere else). "Redrive" is the operator surface's
verb name verbatim — the operator register speaks infrastructure.

## Risks / Trade-offs

- **[Redrive races a concurrently-arriving event on the same stream]** → Both paths serialize on
  the dispatch mutex, and whichever runs second sees post-fold state; a duplicate effect settles
  as stale through `decide` (pitfall 6; spec'd scenario).
- **[The importer's multi-effect loop interacts with redrive]** → The S1 hardening batch fixes
  the sibling-drop hazard first; redrive dispatches whatever pending effects folded state
  derives, so it inherits the fixed semantics. Sequencing: S1 merges before this ships.
- **[Forcing exhaustion via env-tuned budgets weakens the e2e's production fidelity]** → The
  tuning uses the ordinary config surface only (spec'd); the restart-durability scenario runs
  under the same tuning, and production timings stay covered by the unit/integration tiers.
- **[A stalled item's diagnostics could contain peer usernames]** → Operator-register-only
  surface behind the owner gate; the S1 redaction work covers the log/dead-letter payload side.
- **[`waitingSince` plumbing]** → The operations surface orders by ledger `occurredAt`
  directly; the user-facing attention queue's dead `waitingSince` optional stays untouched (its
  producers remain the facades, per its own recorded deferral).

## Migration Plan

Ships after `auth-roles`. Additive contracts only; no data migration (existing dead-letter rows
surface immediately — any stall live on flight at deploy time becomes visible, which is the
point). Rollback is the previous image; letters and stalled exposure behave as today.

## Open Questions

- The exact user-register phrase and tone for the stalled telling — a copy decision inside the
  established register rules, settled at implementation with the usual copy tests.
- The default backoff ceiling and readiness threshold values — tuned at implementation against
  the supervisor's existing cadences; env-overridable either way.
