# Design — extract-eventing-package

## Context

See `proposal.md — Why`. Current state that shapes the approach: the two seam subscriptions are one module written twice (zero code-line diff), each behind a 14-field dependency record whose tuning fields are supplied as constants at exactly one production call site per context. The correlation modules are byte-identical modulo `CONTEXT_NAME`, held identical by a string-equality test (`test/boundaries/correlation.test.ts`). Two research docs bound the decision space: `docs/research/bounded-contexts-vs-modules.md` (the "accidental shared kernel" pitfall: duplication forbidden to diverge is a shared kernel without its benefit) and `docs/research/poison-event-halt-vs-park.md` (halt-only verdict, 2026-08-18). Grilled decisions below were settled interactively on 2026-08-18; D3 was re-settled the same day against implementation evidence (see D3).

## Goals / Non-Goals

**Goals:**

- One deep module per seam mechanism: `checkpointedDrain` and the correlation mechanics, each with one implementation, one test suite, one fix site.
- Interfaces sized to what varies: ~5 required fields; everything that has never varied becomes a default behind one optional `tuning` escape hatch.
- The mechanism/model line recorded in specs so future extractions don't re-litigate it.

**Non-Goals:**

- No change to any event vocabulary, ACL schema, wire contract, or facade — model stays per-context by rule.
- **Both reactors are out of scope entirely** — not their effect sequencing, not their drain loops, not their scheduling. See D3.
- No consolidation of the other infra twins (outbound-feed, sqlite dead-letters/event-store) in this change — candidates for later changes under the same amended rule, each on its own evidence.
- No speculative genericity: the package is generic in shape (no knowledge of its consumers) but its surface is designed for this repo's two subscription consumers only.
- Not the reactor drift this change's investigation surfaced (the importer's unbudgeted re-dispatch on a checkpoint-write fault, its boot-blocking `await start()`, its ~25s retry tolerance, the downloader's unmirrored sibling-`break`) — filed as issues, fixed on their own evidence.

## Decisions

### D1 — Mechanism may be shared; model may not

The no-shared-kernel rule (merge-modular-monolith D1, extended by end-to-end-correlation D13) guarded coupling of the two *languages*; both recorded decisions reasoned about model types (IDs/paths; the correlation pair "as a common type"). The drain loop, checkpoint protocol, backoff, and mint/adopt mechanics carry no language. Sharing them ends the state the boundary test itself documents: mirror-on-every-change duplication, which the repo's own research doc names as running a shared kernel without its discipline. D1/D13's reasoning stands; their scope shrinks to model. Archived docs get annotations pointing here. *Alternative — keep 4 copies, shrink each interface independently:* rejected; pays the full duplication cost forever to honor a rule at a place its rationale never covered.

### D2 — One leaf package, `packages/eventing`

Both mechanisms are "mechanics of the seam"; two packages would be ceremony for ~700 lines. Lint-enforced leaf conditions (see module-architecture delta): no imports from other workspace packages, no domain vocabulary, consumed only outside `domain/`. Module identity (context name, subscription name) arrives as opaque construction parameters — the package's source contains neither "downloader" nor "importer".

### D3 — `checkpointedDrain` serves the two seam subscriptions; the reactors keep their own loops

Shape: `checkpointedDrain({ name, checkpoints, feed, step, logger, tuning? })` → `{ start, stop, poll, reset, isHalted }`, where `step: (event) => Result<void, Transient | Permanent>`. Its two consumers are the seam subscriptions, whose step is tolerant-read + ACL + dispatch. `tuning?: Partial<{retry, batchSize, pollIntervalMs, sleep, interval}>` holds every knob that has never varied, defaulted; tests reach determinism through `tuning`, production never passes it. The coalescing pass (`running`/`pending` do-while) is an **unexported internal** — with only two consumers, both served by the drain, it needs no interface of its own. The stop path keeps the settled invariant: await the in-flight cycle before the caller closes the DB.

**Revised 2026-08-18 against implementation evidence.** The original decision (settled at Q2 on the premise that the reactors "share the coalescing-drain state machine") also folded both reactors in as step functions. Reading the code refuted the premise: the reactors share only a ~20-line scheduler, not the protocol, and they differ from the subscriptions *and from each other* in ways an archived change decided on purpose. `2026-07-23-importer-reactor-durability-parity` names it — the downloader **parks-and-advances-past** (per-stream isolation, `streamId` key, `nextRetryAt`/`due()` backoff, a startup re-drive pass, one mutex serializing re-drive against live drains) while the importer **holds the global checkpoint** (`globalSeq` key, no scheduler, "re-drive is the drain"). That doc lists rewriting the importer into the downloader's scheduler as an explicit Non-Goal, its risk register calls a shared key "a false parity", and the importer's own port docstring repeats it. The deep reason: every importer effect is in-process beets/filesystem work that cannot outlive the process, whereas the downloader's `Download` drives an out-of-process slskd transfer whose completion signal is lost on a crash — so only the downloader needs state-derived re-drive.

Folding the reactors in would therefore mean either a knobbed loop module (inject a mutex, dual work sources, optional halt, caller-owned checkpoints, per-consumer defect containment) whose interface is as wide as its implementation — the shallowness this change exists to remove — or a silent rewrite of a deliberate isolation strategy. It would also collide with `stalled-work-recovery`, drafted and parked, whose first two tasks add `redriveStalled` to both reactors.

*Alternative — a shared `CoalescingPass` primitive (cycle, repeatWhile, serialize) adopted by all four sites, so no copy of the state machine survives:* rejected. With the reactors out, its only consumers are the two subscriptions, which `checkpointedDrain` already unifies — it would be a module with one caller. *Alternative — fold the reactors in anyway, per the original Q2 answer:* rejected on the evidence above; Q2's stated goal was killing the duplicated state machine, and the duplication that remains is between two deliberately different consumers, not two copies of one design.

### D4 — Halt-only poison policy

Per the research verdict: transient failures hold the checkpoint for poll-driven redelivery (never halt); permanent failures halt without advancing; restart/reset after a fix is the in-order redrive. The park arm is deleted (zero production callers; parking breaks per-stream order on reinjection while our poison profile — deploy-coupled schema defects — poisons a whole event type anyway). The `Transient`/`Permanent` classification is now load-bearing and gets explicit tests per consumer. The policy sits behind a narrow waist inside the module so a future park/per-stream-park arm is an addition, not a rewrite. Both reactors' parked-*effect* machinery (per-stream isolation at the altitude where failures genuinely are per-stream) is a different mechanism and is untouched.

### D5 — Correlation: full share, parameterized by opaque context name

Mint (W3C trace-id), adopt-vs-mint, causation chaining, envelope attach/parse, the branded `CorrelationId`, and the envelope schema all move to `packages/eventing`, constructed per context via `createCorrelation({ contextName })`. The tolerant-reader property earns its keep on the event payload contract, not on the never-fatal observability sidecar; keeping ceremonial per-context envelope schemas would preserve exactly the duplication this change ends. This amends D13's conclusion while keeping its core claim: the envelope still crosses the seam as data, the facades still take a plain `StoryId` string. *Alternative — share mechanics but keep per-context schemas/brands:* rejected as letter-over-spirit; protects nothing real.

### D6 — Tests move with the behaviour; the boundary pin retires

The consolidated drain suite lands in `packages/eventing` first (ported red-green from the two existing subscription suites, reconciling the 259 drifted lines as a union), then both consumers switch over and their duplicate drain tests are deleted; per-context tests keep only step-function facts (ACL translation, classification). Reactor suites are untouched. The string-equality describe block in `test/boundaries/correlation.test.ts` is deleted — the twins it pinned stop existing, which is its mission completed. `packages/eventing` joins the workspace coverage merge and the `pnpm check` lanes under the same 100% gate.

### D7 — One change, two commits

Commit 1: `packages/eventing` + `checkpointedDrain` + both seam subscriptions + spec deltas. Commit 2: correlation extraction + boundary-test retirement + doc annotations. Independently revertable; one doctrine decision recorded once.

### D8 — The reactor drift found on the way is filed, not fixed here

Investigating D3 surfaced four cross-reactor drift items and one defect in a drafted change. They are filed as issues rather than folded in: this change must stay a mechanism extraction with no behavioural surface, and three of the four need spec text or collide with `stalled-work-recovery`.

- **#190** — the importer re-dispatches a real beets `Apply` every poll with no budget when a checkpoint *write* keeps failing (the one retry path that is not a parked effect).
- **#191** — the importer's `await reactor.start()` boots the composed web server behind its whole beets backlog: the shape of a documented ~2h outage the downloader already fixed with `void`.
- **#192** — the importer's effective retry tolerance is ~25s against the downloader's 6h, and is unoverridable from composition.
- **#193** — the downloader `break`s where the importer now `continue`s past a stale-rejected sibling effect (fixed and pinned on the importer 2026-08-05, never mirrored; latent only because `react()` yields at most one effect).
- **#194** — `stalled-work-recovery`'s D1 specifies `redriveStalled` taking "the dispatch mutex" and reusing "the existing `redriveStream` logic": constructs the importer does not have, because its parity change decided the hold model instead.

## Risks / Trade-offs

- [Extraction regresses a live delivery path — every seam event crosses this code] → behaviour is pinned in the eventing suite *before* either consumer switches (test-first port); `pnpm check` + e2e full-loop gate the merge.
- [The two subscription test suites drifted 259 lines — the union may reveal contradictory pinned behaviour] → treat any contradiction as a latent bug surfaced, resolve explicitly in review rather than silently picking one side.
- [Scope was cut mid-implementation; the reactors keep their own coalescing loops] → accepted and recorded (D3): the surviving duplication is between two deliberately different consumers, and the reactors are owned by `stalled-work-recovery`.
- [Coupling: a breaking change to the eventing interface now forces both contexts to move together] → accepted; both contexts already deploy as one image, and the package is versionless workspace-internal. If a context is ever extracted to a service, the package rides along as a library.
- [Deleting park forecloses progress-over-order if a long-lived poison ever blocks a seam] → accepted per research (halt is today's only exercised behaviour; the fix-deploy is the redrive); per-stream park stays a documented upgrade path behind the narrow waist.
- [Lint gap: nothing today stops a future PR adding a domain import to the leaf package] → the leaf conditions land as lint rules in the same commit that creates the package, spec-tested like the existing dependency rule.

## Migration Plan

No data or wire migration: stores, schemas, checkpoints, and envelopes are byte-compatible; runtime behaviour is identical except the removed (never-exercised) park arm. Deploy is the normal release train. Rollback = revert the offending commit; no state to unwind.
