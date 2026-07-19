## Context

music-importer (sibling service) judges deposited releases with beets matching and will publish rejection verdicts for releases that fail it. The settled cross-tool posture: each tool owns its outbound event schemas; consumers are tolerant readers behind ACLs. This change is the downloader's consumer side of that loop plus the domain edge it triggers. The design was settled in discussion (2026-07-19), explicitly rejecting two alternatives: caller-supplied exclusion lists (externalizes the aggregate's rejected-set memory to callers) and a per-target blacklist store (rebuilds state the aggregate already knows how to hold).

## Goals / Non-Goals

**Goals:**

- A bad delivered candidate leads, without manual intervention, to the next-best candidate through the existing bounded ladder.
- Keep the domain's language pure: "external validation failed", never "import".
- Keep the loop safe: stale-guarded, idempotent, budget-bounded, and inert when unconfigured or when no verdict ever arrives.

**Non-Goals:**

- No positive-verdict handling or sealed/accepted state (additive later if a need appears; rejecting-after-accepting has no realistic flow today).
- No revival window/timeout policy (the attempt budget bounds total activity; time-bounding can be added as policy later without model change).
- No knowledge of music-importer: the receiver is a generic signed-verdict edge; its tolerant-reader schema names only what this domain needs.

## Decisions

### D1 — A late external validation failure, in the native language

The adjudication is validation that ran outside the system, so the command is `RecordExternalValidationFailed` and the event `FulfillmentRejected` — distinct from `ValidationFailed` (which rejects an in-flight candidate during `Validating`) because it rejects a *delivered outcome*, and the phase narrative should say so. `decide` on `Fulfilled` with a matching candidate mints `[FulfillmentRejected, CandidateRejected, selectNext(...)]` — the exact `rejectAndAdvance` shape already used for download/validation failures, reusing the rejected set, working set, re-search rounds, and attempt bounds unchanged.

### D2 — Fulfilled is stable-but-defeasible; convergence is preserved

Terminality splits into two honest flavors: **absorbing** (`Exhausted`, `Cancelled`, `MetadataFailed`, `Conflicted` — no command revives them) and **stable-but-defeasible** (`Fulfilled` alone). Nothing operational needed "done forever": streams are kept indefinitely regardless, the sweep's resource cleanup at fulfilment is unaffected (a revival creates fresh resources), and `isTerminal` remains true for `Fulfilled` for all existing consumers — the revival is a single narrow exception inside `decide`, not a reclassification. Every revival spends the existing budgets, so total activity per acquisition stays provably bounded and the system still converges to an absorbing state on its own. No acknowledgement flow: self-determined terminality is preserved for the standalone tool.

### D3 — The stale-guard: Fulfilled retains the judged candidate's identity

`FulfilledState` today keeps only progress counters and the location; to guard verdicts it additionally retains the fulfilled candidate's identity and the ladder-resume context (target, policies, working set, request) — an internal fold-shape change, additive, no public contract impact. `decide` ignores a verdict whose candidate identity does not equal the retained one (the standard stale-outcome guard), which makes redelivery and double-revival convergent: after a revival the state is no longer `Fulfilled`, so a duplicate verdict no-ops through the existing terminal/phase guards. Legacy histories fold to a Fulfilled state with no retained candidate; verdicts against them are ignored — the correct degraded behavior for acquisitions fulfilled before this capability existed.

### D4 — The receiver is a tolerant-reader edge behind the ACL

A single webhook endpoint accepts Standard Webhooks-style deliveries: verify the HMAC signature and timestamp, dedupe by `webhook-id`, tolerantly parse **only** the fields this domain needs — acquisition id, candidate identity, a rejected verdict, optional reasons — ignoring everything else in the sender's payload (consumer-defined minimal schema; the sender's full schema is its own business). The parsed fact translates through the anti-corruption layer into `RecordExternalValidationFailed` and enters through the same command handler as every other command, where `decide`'s guards make redelivery safe end-to-end. Config-dormant: without `VERDICT_WEBHOOK_SECRET`, the route is not registered.

## Risks / Trade-offs

- **[Stale working set on revival]** The retained working set may be weeks old. → Acceptable: candidates are re-validated on download, and an empty/expired set falls through to the existing bounded re-search — the ladder's normal degradation path.
- **[Fold-shape growth on Fulfilled]** Retaining the working set in a terminal state keeps more in memory per fold. → Negligible at this scale; the alternative (re-search-only revival) throws away useful ranking for no measurable saving.
- **[Verdict for a revived-and-refulfilled acquisition]** A slow verdict could name candidate A after a revival already led to fulfilment with candidate B. → The stale-guard handles it: A ≠ retained B → ignored. A verdict against B is a legitimate new judgment and revives again, spending budget.
- **[Endpoint abuse]** A public-ish POST that mutates state. → HMAC signature + timestamp window + id dedupe; unsigned/invalid requests are rejected before parsing.

## Open Questions

- Whether the receiver should also accept accepted-verdicts now and simply record them as inert facts (cheap forward-compat) or reject unknown verdict values (stricter) — lean stricter; additive to relax later.
