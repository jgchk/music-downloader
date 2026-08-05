# Tasks — stalled-work-recovery

Red-first TDD throughout: the failing test precedes every production edit, visible in commit
order. Prerequisite: `auth-roles` merged (the `authorize` seam and `system:redrive` action);
S1's importer multi-effect fix merged.

## 1. The redrive operation (both modules)

- [ ] 1.1 Downloader reactor `redriveStalled(streamId)` (red first): mutex seat, stalled
      precondition as a modeled refusal, letters logged then cleared through the one seam,
      re-dispatch via the existing re-drive logic with a fresh budget; tests pin the refusal on
      a non-stalled stream, idempotent concurrent submissions, the logged trail, the
      fresh-ladder re-stall, and the untouched event history.
- [ ] 1.2 Importer reactor: the same operation and test set, in the importer's own voice.
- [ ] 1.3 Stale-settlement path (red first): a redriven effect whose earlier execution had
      settled lands as a stale command through `decide` — one test per module.

## 2. Facade growth (additive)

- [ ] 2.1 Downloader facade (red first): `listStalled()` (work identity, `occurredAt`,
      diagnostics) and the fire-and-forget redrive verb returning accepted/refused; DTO schemas
      additive with operator-register fields documented; JSON round-trip + re-parse tests.
- [ ] 2.2 Importer facade: the same pair, same tests.
- [ ] 2.3 Contract tier: additive-DTO gates extended to the new shapes in both packages.

## 3. Supervisor escalation (downloader only)

- [ ] 3.1 Escalating backoff in the delivery loop (red first): base = poll cadence, factor 2,
      env-capped ceiling; existing warn→error cadence preserved; deterministic-timer tests.
- [ ] 3.2 Delivery-failure gauge into `readiness()` (red first): degraded past the configured
      threshold, cleared on success; stalled streams asserted NOT to degrade readiness.
- [ ] 3.3 Config surface: threshold + ceiling env vars with defaults, validated at boot.

## 4. Web — user register

- [ ] 4.1 Stalled telling (red first): tone map + copy for detail, timeline import section, and
      list rows, driven by the decided flags only; `satisfies` totality preserved; recovery
      leaves no residue; story stays live (self-refresh unchanged).
- [ ] 4.2 Attention queue exclusion (red first): stalled items never enter the queue; the
      queue's charter test updated to the amended wording.

## 5. Web — operations surface

- [ ] 5.1 `/system` route behind `authorize(session, 'system:redrive')` (red first): guest
      refused with no content leak and no nav entry; owner served.
- [ ] 5.2 Stalled-work list (red first): both modules composed in the BFF, longest-stalled
      first by ledger time, diagnostics verbatim, linked items, per-section modeled error on a
      failed read, explicit all-clear empty state.
- [ ] 5.3 Redrive verbs (red first): per-item form + redrive-all iteration, fire-and-forget
      acceptance, verb-inventory entries (redrive non-destructive; cancellation pairing points
      at the existing destructive-gated form); no dismiss verb exists (asserted).

## 6. E2E and verification

- [ ] 6.1 Env-tunable retry budget/backoff threaded through the ordinary config surface;
      documented in the e2e harness.
- [ ] 6.2 The stall-recovery phase (red first against the phase's own probes): unwritable
      library mount → stalled telling witnessed → restart proves durable exposure → repair →
      redrive via the operations route with an owner-role session → ordinary completion, no
      residue; scraped copy goes through the centralized phrase maps.
- [ ] 6.3 `run.sh` phase registration + honest phase-count comment; full local e2e run green.

## 7. Gate and done

- [ ] 7.1 Full gate (`pnpm check`) green across packages; 100% coverage without waivers.
- [ ] 7.2 Post-deploy verification (with Jake): any pre-existing stall on flight surfaces
      immediately; a live redrive recovers one; `/health` reflects a simulated delivery
      failure.
