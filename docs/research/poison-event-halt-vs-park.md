# Poison events on an ordered seam: when do mature systems halt, and when do they park?

**Research date:** 2026-08-18.

**Question.** The two bounded contexts integrate through in-process catch-up subscriptions —
each consumer reads the other's ordered SQLite feed with a durable consumer-owned checkpoint,
at-least-once, in feed order. The current spec offers two poison-event policies after bounded
retries: **halt** (stop the subscription without advancing; order over progress) or **park**
(dead-letter row, advance past; progress over order), each subscription declaring exactly one.
Both production subscriptions declare `halt`; the `park` arm has zero production callers. The
team is consolidating four copies of the drain mechanism into one deep module and leans
"delete park, keep halt only." What does the field actually do — and is there a synthesized
best, especially **per-stream parking** (quarantine the failing aggregate's events, keep other
streams flowing), given that business order here matters only per aggregate stream and the
consumer deciders are idempotent?

**Method.** Primary sources fetched 2026-08-18: Marten's current async-daemon docs plus the
archived v5 docs and the maintainers' GitHub issue on the v7 redesign; KurrentDB server docs
(persistent subscriptions) and .NET client docs (catch-up subscriptions); Axon Framework 4.11
reference (event processors, dead-letter queue); Particular Software's NServiceBus
recoverability docs and their ordered-delivery essay; Akka Projections and Akka supervision
docs; Uber's consumer-DLQ engineering blog [engineering-blog tier, marked]; RFC 9114; the Lean
Enterprise Institute lexicon. House facts from this repo's spec, archived design doc, and
subscription source. Unreachable sources are named rather than paraphrased from memory:
`docs.particular.net/nservicebus/messaging/message-order` returned 404 (the vendor's
ordered-delivery essay is cited instead); `global.toyota`'s production-system page returned 403
(lean.org's lexicon substitutes); Marten's official v4 docs archive returned 404 (the v5 docs
deployment at `marten-docs-v5.netlify.app` substitutes); `docs.kurrent.io/clients/grpc/…`
returned 404 (the .NET client page substitutes). Two reused citations from the sibling doc
(fetched 2026-08-05, not refetched) are marked [sibling].

**Territory split.** What happens *after* parking — redrive semantics, ledger disposition,
give-up verbs — is [`dead-letter-redrive-semantics.md`](dead-letter-redrive-semantics.md)'s
territory and is cross-referenced, not re-argued. This doc covers the upstream decision:
whether/when to park at all vs halt, and at what granularity. Note the two docs sit at
different altitudes: the sibling's subject is the **reactor's per-stream effect dead-letters**
(external work that failed); this doc's subject is the **subscription seam's poison events**
(delivered facts that cannot be consumed). The distinction turns out to be load-bearing (§5).

---

## 1. The house shape being decided (facts from this repo)

- The spec: after bounded retries with backoff, "it SHALL apply its declared policy: **halt**
  (stop the subscription without advancing, surfacing the stall via structured logs) or
  **park** (record the event's position and error as a dead-letter row in the consumer's
  store, then advance). Each subscription MUST declare exactly one policy"
  (`openspec/specs/cross-module-delivery/spec.md` §"Poison-event policy per subscription").
- The recorded rationale: policy is "explicit configuration per subscription, mirroring
  Marten's configurable error handling", with halt "correct where order is workflow-critical,
  e.g. verdict intake"
  (`openspec/changes/archive/2026-07-21-merge-modular-monolith/design.md` D7).
- The implementation is sharper than the spec's summary: a `Transient` handler failure retries
  in place, then **holds** the checkpoint for the next cycle — an implicit periodic retry at
  poll cadence, forever, never invoking the poison policy. Only a classified-`Permanent`
  failure goes "straight to the poison policy" ("Deterministic failures gain nothing from
  repetition") (`packages/downloader/src/application/events/catch-up-subscription.ts:306-335`,
  twinned in `packages/importer/src/application/events/catch-up-subscription.ts`).
- The halt arm has **three** feeders sharing one `halted` flag — poison event under `halt`, an
  unreadable checkpoint at start, and a permanent feed render defect — all holding the
  checkpoint and reporting module readiness `down` (`catch-up-subscription.ts:120-127`,
  `:130-157`, `:266-291`; spec §"An unreadable checkpoint halts…", §"A permanent render defect
  at the feed halts…"). The park arm has none: both production subscriptions declare `halt`
  (`packages/downloader/src/composition/runtime.ts:375`,
  `packages/importer/src/composition/runtime.ts:295`).
- Halt's recovery verb already exists: the checkpoint is resettable, the reset is serialized
  against the drain, and a successful reset clears `halted` and resumes delivery without a
  restart (`catch-up-subscription.ts:199-233`; spec §"Checkpoint is consumer-owned … and
  resettable"). A restart after a fix-deploy resumes from the held checkpoint and reprocesses
  in order — halt's redrive is *free and order-preserving*.
- The consumers are **deciders emitting business facts** (verdict intake driving the
  acquisition saga; fulfillment intake driving imports), idempotent under redelivery — not
  rebuildable read models. This is the single most decision-relevant house fact (§2.1).
- Poison provenance is constrained by the constitution: contracts are additive-only and
  producer and consumer deploy together (one process, one image), so a poison event "usually
  means a schema/tolerant-reader bug" — a defect in *this* image, systemic per event **type**,
  not particular to one aggregate. The tolerant reader already advances past unknown types and
  unknown fields without failing (spec §"Tolerant consumption is preserved").
- The spec has already met the per-stream-park question once and deferred it: "Precise
  per-event dead-lettering for a `park` consumer would need the feed to carry the failing
  global position; the seam error only exposes `kind`, so that is deferred"
  (`catch-up-subscription.ts:275-277`). The seam event likewise carries no producer stream
  identity as a first-class field (`SeamEvent`, `:29-40`) — per-stream anything at this seam
  is new surface area.

---

## 2. Prior art, system by system

### 2.1 Marten — the cited precedent, which has since gutted the very palette D7 mirrored

- **What D7 mirrored (v5):** a fluent per-exception policy machine — `Retry`/`RetryLater`,
  `Pause` ("Pause the current projection shard for a user supplied duration"), `PauseAll`,
  `Stop` ("Stop the current projection shard"), `StopAll`, `SkipEvent` ("Skip poison pill
  events"), and `DoNothing` ("Do nothing and pretend nothing is wrong"), with per-exception
  defaults like `RetryLater(250ms, 500ms, 1s).Then.Pause(30s)` [MA2].
- **What Marten offers today:** that machine is gone. Error handling is three booleans —
  `SkipApplyErrors`, `SkipSerializationErrors`, `SkipUnknownEvents` — defaulting **true in
  continuous mode, false in rebuild mode**; skipped poison events are recorded: "you can see a
  record of this in the `DeadLetterEvent` storage in your database (the
  `mt_doc_deadletterevent` table) along with the exception." When skipping is disabled and an
  error occurs, "the specific projection pauses … paused projections remain inactive until
  manually addressed." "Poison event detection is a little more automatically integrated into
  Marten 7.0" [MA1].
- **Why they flipped continuous mode to park-and-advance** (the maintainers' own words, from
  the v7 design issue): for normal operation, "In real you want to continue operating, as you
  always can rebuild it later"; for rebuilds, "when you're rebuilding then when you faced an
  error, you can fix the code and restart" [MA3].

Two lessons. First, the precedent **consolidated its policy surface drastically** — from seven
continuation actions to booleans — which is direct support for the consolidation instinct, in
whichever direction. Second, and cutting the other way for this repo: Marten consolidated
*toward* park **because its consumers are projections** — rebuildable read models where a
skipped event costs a rebuild, not a lost business decision. Marten's own split is exactly the
governing distinction: rebuildable → skip-and-dead-letter; fix-the-code-shaped (rebuild mode)
→ stop. This repo's subscription consumers are the second kind: a skipped verdict is not
rebuildable later by replaying a projection — it is a workflow decision that silently never
happens.

### 2.2 KurrentDB (EventStoreDB) — park exists only in the mode that already gave up order

- **Persistent subscriptions** (server-checkpointed, competing consumers) own the park verb:
  messages exceeding `maxRetryCount` are "parked in the persistent subscription's parked
  message stream" (`$persistentsubscription-{stream}::{group}-parked`), and an operator can
  "Replay the parked messages for that subscription. This will push the parked messages to
  subscribers before any new events," with a `stopAt` limit [K1].
- The same docs disclaim order in that mode: "Ordering is not guaranteed with persistent
  subscriptions due to the possibility of messages being retried, or consumers handling events
  before others"; mitigation strategies are "still on a best-effort basis and messages may
  still arrive to consumers out of order" [K1].
- **Catch-up subscriptions** — the mode this repo's seam is modeled on ("catch-up
  subscriptions must keep the last known position on the subscriber side, while persistent
  subscriptions keep the position on the server" [K1]) — have **no park verb at all**. A
  handler error drops the subscription (`SubscriberError`), the client stores the checkpoint,
  and recovery is resubscribe-from-checkpoint: "you'd need to store the current position of
  the subscription somewhere, and then use it to restore the subscription from the point where
  it dropped off" [K2]. Catch-up is halt-by-construction.

The product that has both modes ties park to the mode that has already traded away ordering
for competing-consumer throughput, and offers only halt in the ordered, client-checkpointed
mode. That is the sharpest single datapoint on question 4.

### 2.3 Axon Framework — halt-with-auto-retry by default; per-sequence parking as opt-in

- **Defaults.** At the listener level, "By default, these exceptions are logged (with the
  `LoggingErrorHandler` implementation), and processing continues" — but the recommended
  processor-level default is the `PropagatingErrorHandler`, "which will rethrow any exceptions
  it catches," upon which a streaming processor "will go into error mode, releasing any tokens
  and retrying at an incremental interval (starting at 1 second, up to max 60 seconds)" [AX1].
  That is **halt-with-automatic-periodic-retry**: the processor never advances past the
  failing event, and a fixed world un-sticks it without an operator.
- **SequencedDeadLetterQueue (4.6+)** is the field's one attested per-stream park. It
  maintains "a sequence identifier for each event, determined by the sequencing policy"
  (default: the aggregate identifier); on failure it parks the event, and — the essential
  ordering move — "it will prevent handling of later events in the same sequence until the
  failed event is successfully processed": every subsequent event with the same sequence
  identifier is enqueued straight into the DLQ rather than handled [AX2][AX3]. Other
  sequences keep flowing.
- **Its caveats, from its own docs:** it is **not enabled by default** (explicit opt-in per
  processing group); "If your event handlers are not idempotent, processing letters may
  result in undesired side effects. Hence, we strongly recommend making your event handlers
  idempotent"; "Currently, there is no support for using a dead-letter queue for sagas";
  sequence limits default to 1024 and exceeding them "triggers
  `DeadLetterQueueOverflowException`, stopping the processing group entirely" — i.e. under
  sustained failure the per-stream park **degenerates to halt** [AX2]. Redrive is
  whole-sequence, via `SequencedDeadLetterProcessor` (`processAny()` for the oldest sequence,
  `process(Predicate)` to filter) — never per-event, precisely to preserve intra-sequence
  order [AX2]. Enqueue-if-present also implies a per-event presence check against the DLQ on
  the hot path — a standing bookkeeping cost paid by every healthy event.

### 2.4 NServiceBus / Particular — park-by-default, purchased by rejecting order outright

- Recoverability: "By default, up to five immediate retries are performed", then delayed
  retries ("delays start with at 10 seconds, then 20 seconds, and lastly 30 seconds"), then
  "when messages continuously fail during the immediate and delayed retry mechanisms, they
  will be moved to the error queue" [N1]. Park is the terminal default.
- The precondition is stated in their ordered-delivery essay: once "The poison message has
  been dealt with … another message can now be taken from the queue, one that was supposed to
  be processed *after* the poison message" — ordering is broken by design, and "to guarantee
  message ordering is technically very difficult and, even if successful, always comes with
  tradeoffs like lower message throughput and less scalability." Their answer is application-
  level: sagas that "allow us to orchestrate business processes" and absorb out-of-order
  arrival with conditional logic [N2].

NServiceBus can afford park-as-default because it never promised order and pushes reordering
tolerance into every consumer. A seam whose spec promises in-order delivery (this repo's does)
does not get park at that price.

### 2.5 Akka Projections — the same two-policy split, with `fail` as the shipped default

`HandlerRecoveryStrategy` offers exactly this decision as four values: `fail` ("immediately
give up and the projection will be restarted"), `skip` ("give up, discard the element and
continue with next"), `retryAndFail`, `retryAndSkip` (bounded retries with delay, then the
respective terminal). **The default is `fail`**, and a failed projection restarts under
exponential backoff (3s min, 30s max) [AK1] — again halt-with-automatic-retry, not
halt-until-operator. Notably, Akka's `skip` arms discard the envelope with **no dead-letter
record at all** — the field's floor, below this repo's `park`. (Lagom's read-side processors
expose the same strategy set; Lagom is end-of-life and was not separately fetched — its
pattern is represented here by Akka Projections, its successor library.)

### 2.6 Kafka practitioners — DLQ topics for progress, with the order concession named

- Kafka Connect's default is fail-fast — `errors.tolerance = none` stops the connector task —
  and the DLQ topic is opt-in via `errors.tolerance = all`, after which "valid messages are
  processed as normal, and the pipeline keeps on running" with reprocessing as a second
  consumer over the DLQ topic [K-M, sibling].
- Uber's consumer DLQ [U1, engineering-blog tier] is the canonical head-of-line-blocking
  framing: with inline blocking retries "the Kafka consumer will not commit a new offset and
  the batches with these bad messages would be blocked, as they are re-consumed again and
  again"; their fix is a ladder of delayed retry topics ("a leaky bucket pattern") ending in a
  DLQ that operators can list, purge, or merge back. The purchase price is stated twice:
  "Kafka only guarantees in-order processing within partitions and not across them, it must
  be acceptable for an application to handle events outside of the exact order in which they
  occur," and the architecture requires "consumer dependency idempotency" [U1].

### 2.7 EIP — the poison this repo expects is Invalid-Message-shaped, not Dead-Letter-shaped

Hohpe & Woolf split undeliverable-vs-unprocessable: the Dead Letter Channel takes messages the
system "cannot or should not deliver" (plausibly transient; worth redriving once the cause is
fixed), the Invalid Message Channel takes semantically improper messages whose remedy is
diagnosis and a code fix, not retry [E1][E2, sibling; re-argued in the sibling doc §2.8]. A
deploy-coupled schema/tolerant-reader bug is Invalid-Message material: its remedy is a fix in
the next image. That matters because park's whole payoff is *redrive after the cause is
fixed* — but under halt, the fix-deploy **is** the redrive (restart resumes from the held
checkpoint and reprocesses in order), whereas a parked event needs out-of-band reinjection
that arrives *after* successors that already processed, breaking exactly the per-stream order
that made the event matter.

### 2.8 Adjacent domains: supervision, transport HOL blocking, the andon cord

- **Actor supervision** offers Resume / Restart ("clearing out its accumulated internal
  state") / Stop, with escalation upward for permanent failures — and a sharp caveat for this
  decision: on restart "the message during which the failure occurred is not re-processed",
  and "if you want to retry processing of a message, you need to deal with it yourself" [AK2].
  Supervision restart is therefore *skip-shaped at the message level* — safe for actors
  because the mailbox is not a durable ordered fact feed. It does not transfer to a
  checkpointed seam, where dropping the failing fact is precisely the hazard.
- **Transport head-of-line blocking** is the same problem shape solved per-stream: under
  HTTP/2 on TCP "a lost or reordered packet causes all active transactions to experience a
  stall regardless of whether that transaction was directly impacted", and QUIC's answer is
  "reliable, in-order, per-stream delivery" so unaffected streams progress [Q1]. Convergent
  with Axon's SDLQ: when streams are genuinely independent and volume is high, per-stream
  isolation is the principled fix. The convergence also carries the cost signal — it took a
  new transport protocol, and a new persistence-backed framework subsystem, respectively.
- **Manufacturing (jidoka/andon):** "Andon is a visual management tool that … signals whenever
  an abnormality occurs"; pulling the cord stops the line "not immediately, but after the
  product reaches a predetermined position", and "the jidoka concept is maintained because
  abnormalities are remedied and defects never passed on" [L1]. Stop-the-line is the halt
  policy's pedigree in a domain that cannot "rebuild the projection later" — physical product,
  like business decisions, is not replayable. Two transferable details: the stop is *bounded
  and orderly* (finish the piece in hand — the house equivalent: finish the batch's committed
  effects, hold the checkpoint), and the stopped line is *loud by construction* — halt without
  a surfaced signal is not andon, it is just a wedged line.

---

## 3. Synthesis across the sub-questions

### 3.1 When is halt actually correct for an ordered consumer?

The field halts (or defaults to halting) exactly when four properties co-occur, all of which
hold at this repo's seam:

1. **The consumer's effects are not rebuildable.** Marten's own maintainers draw the line:
   park-and-advance is justified because "you always can rebuild it later" [MA3] — and flip to
   stop in rebuild mode, where the remedy is "fix the code and restart". Deciders emitting
   business facts have no rebuild-later escape hatch.
2. **The poison is code-fix-shaped** (EIP's Invalid Message [E2, sibling]) — deterministic,
   remedied by a deploy, after which halt's recovery is automatic and order-preserving (§2.7).
3. **Order is a promised property of the seam.** Every park-by-default system surveyed openly
   disclaims order at the same moment (KurrentDB persistent [K1], NServiceBus [N2], Uber
   [U1]); no surveyed system parks while still promising in-order delivery.
4. **The stall is loud and bounded.** Akka restarts the projection, not the service [AK1];
   Axon's error mode is per-processor [AX1]; the spec already scopes halt per subscription
   with readiness `down` — the andon pairing [L1].

One refinement the field near-universally adds: halt is rarely operator-only. Axon retries
the halted position at 1s→60s intervals [AX1], Akka restarts under backoff [AK1], Marten v5's
default ladders ended in `Pause(30s)` then resumed [MA2]. The house already has this — but
only on the `Transient` arm (hold + fallback poll). The house's classified-`Permanent` halt is
stickier by design, which is sound *only while the classification boundary is trustworthy*
(§5, pitfall 2).

### 3.2 When is park correct, and what do its practitioners require?

Park is the field's choice when the consumer is rebuildable (Marten continuous mode [MA1]),
order-indifferent by explicit design discipline (NServiceBus + sagas [N1][N2]), or when
head-of-line cost dominates at volume (Uber [U1], Kafka Connect DLQ [K-M, sibling]). Its
practitioners consistently require, as a package:

- **A durable diagnostic record**, never a bare skip: Marten's `DeadLetterEvent` table [MA1],
  KurrentDB's parked stream [K1], NServiceBus's error queue with exception details [N1].
  (Akka's `skip` — discard with no record [AK1] — is the floor, and even Akka defaults away
  from it.)
- **Redrive tooling as a first-class operator surface** — the sibling doc's entire territory;
  a park verb without one is MassTransit's negative lesson (sibling §2.3). KurrentDB ships
  replay-parked [K1]; Uber ships list/purge/merge [U1].
- **Idempotent consumers** (Axon: "strongly recommend" [AX2]; Uber: required [U1]) — this
  house has that — **and out-of-order-tolerant consumers** (NServiceBus sagas [N2]; Uber's
  "must be acceptable" [U1]) — this house's per-stream workflows are exactly what that
  tolerance is *not*: a parked-and-later-reinjected verdict arrives after successor events of
  its own stream.
- **An honest order disclaimer in the contract** — which would mean weakening this seam's
  spec, not just adding a policy.

### 3.3 The synthesized best: per-stream parking, retry ladders, periodic re-attempts

- **Per-stream/per-sequence parking has been built exactly once in the surveyed field**: Axon's
  SequencedDeadLetterQueue [AX2][AX3]. It is real and principled (QUIC solves the same shape
  at the transport layer [Q1]), and its own vendor hedges it comprehensively: opt-in, not
  default; hot-path presence check per event; consumer-side sequence store; whole-sequence
  (never per-event) redrive; unsupported for sagas — i.e. for *workflow* consumers, the very
  kind at this seam; and a bounded queue whose overflow **stops the processing group
  entirely** — per-stream park under sustained failure converges back to halt [AX2].
- **Retry-then-park ladders** (Uber's delayed retry topics [U1]; NServiceBus
  immediate→delayed→error [N1]) are broker-infrastructure answers to "retry later without
  blocking"; their *semantics* — timed re-attempt at increasing intervals — already exist in
  this house as the Transient hold + fallback poll, without new infrastructure.
- **Automatic periodic retry of the stuck position** is the field's consensus companion to
  halting (§3.1), attested by Axon [AX1], Akka [AK1], and Marten v5's defaults [MA2].

### 3.4 So: halt-only, park-only, both, or per-stream-park?

The evidence sorts by consumer profile, not by taste:

| Consumer profile | Field's answer | Source |
|---|---|---|
| Ordered, client-checkpointed catch-up feed | Halt only (no park verb exists) | KurrentDB catch-up [K1][K2] |
| Rebuildable projection | Park + dead-letter table (default) | Marten continuous [MA1][MA3] |
| Same projection, during rebuild ("fix the code") | Halt (default) | Marten rebuild [MA1][MA3] |
| Workflow decider / saga | Halt; per-stream DLQ *explicitly unsupported* | Axon [AX1][AX2] |
| Order-disclaimed competing consumers | Park + replay | KurrentDB persistent [K1], NServiceBus [N1][N2] |
| High-volume independent keys, order concession accepted | Per-key DLQ / retry ladder | Uber [U1], Axon SDLQ [AX2] |

This seam is row 1 and row 4: an ordered client-checkpointed feed consumed by workflow
deciders. The field's answer for that profile is halt — with the automatic-retry companion —
and the one per-stream-park implementation that exists disclaims precisely this consumer kind.

---

## 4. Collisions with the house constitution

- **Errors as values — no conflict, and the house is ahead.** Every surveyed policy engine is
  exception-driven (Marten's `OnException` [MA2], Axon's rethrow-to-error-mode [AX1]); the
  house already models the decision as `ConsumeFailure = Transient | Permanent` flowing
  through the declared channel, with the policy applied once at the subscription boundary
  (`catch-up-subscription.ts:55-57`, `:306-365`). The *semantics* port; the mechanics were
  never going to.
- **Additive-only contracts + single deploy unit change the poison calculus.** Every surveyed
  park-first system assumes independently deployed producers: a bad producer can poison you
  through no fault of your own, and parking keeps you alive while *someone else* ships a fix.
  Here producer and consumer ship in one image; poison means this image has a bug, and the
  image that fixes it also un-halts the subscription. Park's availability argument is at its
  weakest in a deploy-coupled monolith.
- **Poison is systemic per event type, not per aggregate.** A tolerant-reader/schema bug fails
  every event of the affected type, whichever stream it belongs to. Per-stream parking would
  quarantine stream after stream until the sequence limits blew — Axon's overflow-halts-the-
  group behavior [AX2] is that convergence, designed in. The failures that genuinely *are*
  per-aggregate (the external world misbehaving for one acquisition) occur at the reactor
  altitude, where the house **already has per-stream isolation**: per-stream effect
  dead-letters, a stalled flag, self-healing on successful drive, and the redrive verb under
  design (sibling doc §1). The architecture already parks per-stream — at the layer where
  failures are per-stream.
- **Per-stream park at the seam would grow the seam's surface.** It needs the feed to carry
  the failing global position (already noted and deferred in-source,
  `catch-up-subscription.ts:275-277`) and a producer stream identity / sequencing policy on
  the consumer side — producer identity crossing the seam as routing infrastructure, the kind
  of accidental coupling the bounded-contexts research warns accretes into an undisciplined
  shared kernel ([`bounded-contexts-vs-modules.md`](bounded-contexts-vs-modules.md)
  §pitfalls, "Accidental shared kernel").
- **Test-first / no fiction tests.** The park arm is production-unreachable code kept green by
  tests that exercise a policy no caller declares. The 100%-coverage constitution explicitly
  rejects tests written to feed the gate; deleting the arm deletes the obligation
  (CLAUDE.md non-negotiables; `docs/development/testing.md`).
- **The D7 record has drifted from its precedent.** D7 mirrors "Marten's configurable error
  handling" [D7]; Marten has since deleted that configurability in favor of skip-booleans +
  dead-letter table + pause [MA1][MA2][MA3]. The precedent now stands for *consolidating the
  policy surface* — and for choosing by consumer profile, which points this seam at halt.

---

## 5. Verdict — applied to the unified drain module

**Question 4, concretely: offer `halt` only. Delete the `park` arm — policy type, dead-letter
write path in the subscription, and its tests — and record per-stream park as the named,
non-adopted upgrade path.** The current leaning survives the steelman:

- The steelman FOR park is head-of-line blocking [U1][Q1]: one poison event stalls every other
  acquisition's intake on that subscription. The field's evidence dissolves it here: (a)
  poison at this seam is deploy-coupled and per-event-type (§4), so parking would not save the
  feed — it would dead-letter the type's whole traffic while hiding the outage from readiness;
  (b) under halt, the code fix that poison demands *is* the redrive — restart resumes from the
  held checkpoint and reprocesses in order — while a parked event's reinjection arrives after
  its stream's successors, breaking the per-stream order that was the point (§2.7); (c) the
  genuinely per-stream failure class is already parked per-stream at the reactor altitude
  (sibling doc), which is the correctly-placed half of the "synthesized best."
- Per-stream park at the subscription (Axon SDLQ) is attested but is the field's *most* hedged
  mechanism: opt-in, idempotency-demanding, saga-unsupported, overflow-halting, hot-path-taxed
  [AX2]. Its adoption trigger — a subscription whose poison profile is per-aggregate and
  volume high enough that a stalled feed is unacceptable — describes none of this system's
  subscriptions (deploy-coupled producer, homelab volume, single operator). Do not build it
  now; if a future seam consumes a feed that does *not* deploy with it, revisit with §2.3 as
  the template and its caveats as the entry checklist.
- Halt-only is not a degenerate offering: it is exactly what the on-point mode of the on-point
  product offers (KurrentDB catch-up [K1][K2]), what Akka ships as default [AK1], what Axon
  prescribes for workflow consumers [AX1][AX2], and what Marten itself keeps for the
  "fix the code" regime [MA1][MA3].

**Pitfall checklist for the consolidation:**

1. **Keep halt loud and bounded** — readiness `down`, per-subscription blast radius, the other
   subscription unaffected (already spec'd). A halt without its surfaced signal is a wedged
   line, not an andon stop [L1].
2. **The classification boundary becomes the load-bearing wall.** With park gone,
   `Permanent` = halt; a Transient fault misclassified `Permanent` stalls the seam until an
   operator acts, and a Permanent misclassified `Transient` spins the hold forever behind a
   healthy readiness signal. Keep `Permanent` reserved for deterministic failures (the
   in-source rule, `catch-up-subscription.ts:313-315`), and keep the render-defect/other-kind
   split the spec pins at the feed (spec §"A permanent render defect…").
3. **Preserve the Transient hold as the automatic-retry companion** (field consensus §3.1) —
   the fallback poll re-attempting the held position is the house's Axon-error-mode
   equivalent; consolidation must not collapse hold-and-retry into halt.
4. **Keep halt's recovery restart-free where possible.** The reset verb (serialized, clears
   `halted`) is halt's redrive; keep it in the unified module, and test the full recovery
   story: poison → halt → fix-deploy/restart → in-order backlog drain from the held
   checkpoint.
5. **Do not touch the reactor's per-stream dead-letter machinery.** It is a different
   altitude solving the genuinely per-stream failure class; its operator story is the sibling
   doc's territory. Deleting the *subscription's* dead-letter write must not orphan or delete
   the reactor's store.
6. **Update the spec and D7's trail.** Remove the park requirement/scenario from
   `cross-module-delivery` (or mark the policy set halt-only), and annotate the D7 rationale's
   Marten citation with what Marten now does [MA1] — the recorded precedent no longer exhibits
   the recorded behavior.
7. **Keep the deep module's policy seam cheap to reopen.** The field's history (Marten
   deleting seven policies; Axon adding SDLQ in 4.6) says poison policy is revisited as
   consumer profiles change. Halt-only should be a narrow waist (one policy application
   point), not halt assumptions smeared through the drain loop — so a future `park`/SDLQ arm
   is an addition, not a rewrite.
8. **If per-stream park is ever built:** require the Axon package or none of it — sequencing
   policy, enqueue-if-present for successors, whole-sequence redrive only, idempotency
   asserted by test, an overflow bound that degrades to halt, and a feed extended (additively)
   to carry failing position + stream identity — with the shared-kernel warning from
   `bounded-contexts-vs-modules.md` §pitfalls weighed at the seam design.

**Thin-coverage honesty.** No surveyed system offers this repo's exact current design — a
per-subscription *declared* choice between halt and park-with-dead-letter on an ordered feed
(Akka Projections' per-projection strategy is the closest [AK1]); the two-policy design
appears to be a house synthesis, which is itself weak evidence that the unused arm lacks field
demand in this profile. Lagom was not independently verified (EOL; represented via Akka
Projections). Uber's account is a single vendor engineering blog. Marten's v5 palette was
read from the archived docs deployment, not the official site (404 at the official archive
path). The Kafka Connect default (`errors.tolerance = none`) is reused from the sibling doc's
2026-08-05 fetch, not refetched.

---

## 6. Citations

**This repository** (checkout `/home/jake/Projects/music-downloader-2`, state at research
time):

- `openspec/specs/cross-module-delivery/spec.md` — poison-event policy requirement, tolerant
  consumption, resettable checkpoint, render-defect halt
- `openspec/changes/archive/2026-07-21-merge-modular-monolith/design.md` — D7
- `packages/downloader/src/application/events/catch-up-subscription.ts` (and the importer
  twin) — Transient hold vs Permanent poison, halt feeders, reset, deferred per-event
  park note (`:275-277`)
- `packages/downloader/src/composition/runtime.ts:375`,
  `packages/importer/src/composition/runtime.ts:295` — both production policies `halt`
- [`docs/research/dead-letter-redrive-semantics.md`](dead-letter-redrive-semantics.md) —
  post-park redrive semantics; reactor per-stream dead-letters; MassTransit negative lesson
  (§2.3); EIP channels ([E1][E2], fetched 2026-08-05)
- [`docs/research/bounded-contexts-vs-modules.md`](bounded-contexts-vs-modules.md) —
  accidental-shared-kernel pitfall
- `docs/development/error-handling.md`, `docs/development/testing.md`, `CLAUDE.md`

**Marten / JasperFx:**

- [MA1] Async Projections Daemon (current) — `SkipApplyErrors`/`SkipSerializationErrors`/
  `SkipUnknownEvents`, defaults (continuous true / rebuild false), `DeadLetterEvent` /
  `mt_doc_deadletterevent`, pause-until-addressed, "Poison event detection is a little more
  automatically integrated into Marten 7.0":
  <https://martendb.io/events/projections/async-daemon.html>
- [MA2] Async Projections Daemon (v5 archived docs deployment) — `OnException` fluent actions
  (`Retry`/`RetryLater`, `Pause`, `PauseAll`, `Stop`, `StopAll`, `SkipEvent`, `DoNothing`)
  and per-exception defaults: <https://marten-docs-v5.netlify.app/events/projections/async-daemon>
  (official v4 archive URL returned 404 at research time)
- [MA3] Issue #2938, "Serialization Failure Behavior in Async Daemon" — maintainer rationale
  for continuous-skip vs rebuild-stop ("you always can rebuild it later"; "fix the code and
  restart"), targeted at 7.0: <https://github.com/JasperFx/marten/issues/2938>

**KurrentDB (EventStoreDB):**

- [K1] Persistent subscriptions (server v25.0) — parked message stream, `maxRetryCount`,
  replay (+`stopAt`), "Ordering is not guaranteed…", catch-up vs persistent position
  ownership: <https://docs.kurrent.io/server/v25.0/features/persistent-subscriptions.html>
- [K2] Catch-up subscriptions (.NET client v1.0) — `SubscriberError` drop on handler error,
  application-owned checkpoint, resubscribe-from-checkpoint pattern:
  <https://docs.kurrent.io/clients/dotnet/v1.0/subscriptions>
  (`docs.kurrent.io/clients/grpc/subscriptions.html` returned 404 at research time)

**Axon Framework (4.11 reference):**

- [AX1] Event processors — `LoggingErrorHandler` listener default, `PropagatingErrorHandler`
  processor default, error mode "retrying at an incremental interval (starting at 1 second,
  up to max 60 seconds)":
  <https://docs.axoniq.io/axon-framework-reference/4.11/events/event-processors/>
- [AX2] Dead-letter queue — sequence identifier, "prevent handling of later events in the same
  sequence", `SequencedDeadLetterProcessor` (`processAny`/`process`), idempotency strongly
  recommended, no saga support, 1024 sequence limit / `DeadLetterQueueOverflowException`
  stops the group, disabled by default:
  <https://docs.axoniq.io/axon-framework-reference/4.11/events/event-processors/dead-letter-queue/>
- [AX3] Dead Letter Queues in Axon Framework (guide) — enqueue-if-present for subsequent
  events of a poisoned sequence, default sequencing policy = aggregate id:
  <https://docs.axoniq.io/dead-letter-queue-guide/4.11/>

**Particular Software (NServiceBus):**

- [N1] Recoverability — five immediate retries, 10/20/30s delayed retries, "moved to the
  error queue", rate-limiting on outage:
  <https://docs.particular.net/nservicebus/recoverability/>
- [N2] "You don't need ordered delivery" — poison message → successor processed first;
  ordering guarantees "technically very difficult … lower message throughput and less
  scalability"; sagas as the reordering discipline:
  <https://particular.net/blog/you-dont-need-ordered-delivery>
- Note: `docs.particular.net/nservicebus/messaging/message-order` returned 404 at research
  time; the essay above is the vendor's canonical ordering statement.

**Akka:**

- [AK1] Akka Projections — Error handling: `HandlerRecoveryStrategy`
  (`fail`/`skip`/`retryAndFail`/`retryAndSkip`), default `fail`, restart backoff (3s/30s/0.2):
  <https://doc.akka.io/libraries/akka-projection/current/error.html>
- [AK2] Akka — Supervision and Monitoring: Resume/Restart/Stop, escalation, "the message
  during which the failure occurred is not re-processed":
  <https://doc.akka.io/libraries/akka-core/current/general/supervision.html>

**Kafka practitioners:**

- [U1] Uber Engineering, "Building Reliable Reprocessing and Dead Letter Queues with Apache
  Kafka" — blocking-retry HOL framing, retry-topic ladder ("leaky bucket"), DLQ
  list/purge/merge, order concession, idempotency requirement [engineering-blog tier]:
  <https://www.uber.com/blog/reliable-reprocessing/>
- [K-M, sibling] Robin Moffatt (Confluent), "Kafka Connect Deep Dive — Error Handling and Dead
  Letter Queues" — `errors.tolerance` none-by-default / `all` + DLQ topic; fetched 2026-08-05
  for the sibling doc, reused here:
  <https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/>

**Adjacent domains:**

- [Q1] RFC 9114 (HTTP/3) — HTTP/2-on-TCP "a lost or reordered packet causes all active
  transactions to experience a stall"; QUIC "reliable, in-order, per-stream delivery":
  <https://www.rfc-editor.org/rfc/rfc9114.html>
- [L1] Lean Enterprise Institute, Lexicon: Andon — signal on abnormality, fixed-position line
  stop, "abnormalities are remedied and defects never passed on":
  <https://www.lean.org/lexicon-terms/andon/> (global.toyota's production-system page
  returned 403 at research time)
- [E1][E2, sibling] Hohpe & Woolf — Dead Letter Channel / Invalid Message Channel; fetched
  2026-08-05 for the sibling doc:
  <https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html>,
  <https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html>

---

*These findings are research input to a decision, not normative policy. Nothing here changes
the constitution or any spec until adopted through an OpenSpec change.*
