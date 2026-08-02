# Observing long-running external work without blocking the reactor

**Question.** How should an event-sourced system observe long-running external work — multi-file
transfers executed by a third-party daemon (slskd) — without blocking its reactor / process
manager?

**Method.** All claims below are traced to primary sources: this repo's constitution and source
(file:line), slskd's source on GitHub, Sonarr's source on GitHub, and the pattern authors' own
sites/docs (Hohpe & Woolf's enterpriseintegrationpatterns.com, Particular's NServiceBus docs,
Temporal's docs, kubernetes.io and the Kubernetes design-principles archive, erlang.org, Verraes,
Dudycz). Secondary write-ups were deliberately avoided. Citations are gathered in §7.

A note on scope: the review brief referenced a "Simple over easy" section of
`docs/development/design-principles.md`; that section does not exist in this checkout (nor in the
sibling working copy at the time of research). Where the analysis invokes simple-vs-easy it cites
Rich Hickey's *Simple Made Easy* directly [H1], which is the section's evident primary source:
*simple* = one concept per construct, un-entangled ("not complected"); *easy* = near-at-hand,
familiar. The two are orthogonal, and familiarity is not an architectural argument.

---

## 1. The problem, and what is actually verified

### 1.1 The blocking effect today

The reactor is a serial, durable process manager: every effect dispatch — live drain, parked
retry, startup re-drive — runs on **one** dispatch mutex
(`packages/downloader/src/application/acquisition/reactor.ts:74-75`, `:152-156`: "Everything that
dispatches effects runs under this one mutex"). The `Download` effect's interpreter calls
`DownloadPort.download(...)` and awaits its settlement
(`packages/downloader/src/application/acquisition/interpreter.ts:80-94`), and the slskd adapter's
implementation is an in-process `for (;;)` loop that enqueues, then polls slskd's transfers API
every second until the whole multi-file candidate settles — success, failure, stall timeout, or
queue timeout (`packages/downloader/src/adapters/slskd/download.ts:146-185`). An album can take an
hour; for that hour the mutex is held.

Two concrete pathologies follow structurally, not hypothetically:

1. **Cross-acquisition head-of-line blocking.** Every other acquisition's searches, metadata
   resolutions, retries, and verdict-driven follow-ons wait behind the held mutex. This violates
   the system's own spec: "an infrastructure fault retrying one acquisition's effect SHALL NOT
   delay the processing of any other acquisition's events"
   (`openspec/specs/acquisition-lifecycle/spec.md:145-147`) — the requirement's *letter* covers
   failing effects, but a healthy hour-long effect delays others identically, which the
   requirement's rationale (isolation between acquisitions) plainly intends to forbid.
2. **Same-stream cancellation is wedged.** Cancelling a downloading acquisition emits events whose
   `AbortDownload` effect is dispatched *by the same reactor* (`interpreter.ts:127-137`). That
   dispatch serializes behind the mutex the in-flight `Download` dispatch is holding — so the
   abort cannot reach slskd until the download it is meant to abort has already settled on its
   own. The blocking shape doesn't merely slow the system; it inverts a causal arrow.

### 1.2 The upstream facts (verified against slskd source)

- **slskd raises and persists events only for successes.** The full event vocabulary is the
  `EventType` enum in `src/slskd/Events/Types/Events.cs` [S1]: `DownloadFileComplete`,
  `DownloadDirectoryComplete`, `UploadFileComplete`, private/room messages, client
  connect/disconnect, `Noop`. **There is no failure, stall, error, or queue event of any kind.**
  Persisted events are queryable at `GET /api/v0/events` (offset/limit paging) via
  `EventsController.GetEvents` in `src/slskd/Events/API/EventsController.cs:79-100` [S2].
- **Webhook delivery is weak by default:** always a POST with the event JSON, "the default timeout
  for requests is 5 seconds" and "each request will be attempted only once per event"
  (configurable) — slskd `docs/config.md` [S3].
- **Failures/stalls/queue positions are observable only by sampling the transfers API over time.**
  Corollary of the first bullet, and confirmed by slskd's own behavior: **slskd's own web UI polls
  the transfers endpoint on a 1-second interval** — `window.setInterval(fetch, 1_000)` in
  `src/web/src/components/Transfers/Transfers.jsx:36` [S4]. The vendor treats sampling as the
  ground-truth observation channel for transfer state; the event/webhook channel is a
  success-notification convenience.
- **Stall and queue-abandonment judgment is our policy**, per request (stall timeout, max queue
  wait live in the domain's `DownloadPolicy`; the adapter's docstring records the division:
  "It owns the *detection* of stalls and hopeless queues against the policy's thresholds (the
  policy stays source-agnostic)" — `download.ts:30-34`).

So **some periodic sampling is irreducible**. The question is only *where the sampling loop
lives* and *how its outcomes re-enter the event-sourced core*.

### 1.3 Machinery already in place (relevant precedents inside the codebase)

- **Effect results already re-enter as commands through `decide`**, which guards staleness
  (`docs/development/event-sourcing.md` §"Decisions in `decide`, effects in `react`";
  `interpreter.ts:85-93`; stale-outcome requirement at
  `openspec/specs/acquisition-lifecycle/spec.md:184-197`).
- **A durable catch-up consumer already ingests another context's facts** tolerantly and
  translates them through an ACL into native commands
  (`packages/downloader/src/interfaces/events/verdict-consumer.ts:8-15`).
- **A transfer-ownership ledger with reconcile-before-enqueue** already re-attaches to live
  upstream transfers after a restart instead of double-downloading (`download.ts:112-119`,
  `:187-204`), and the startup re-drive is explicitly described as "level-triggered
  reconciliation: fold every stream and re-dispatch the effect its current state is waiting on"
  (`reactor.ts:189-196`).
- **Push is already treated as a hint, not a guarantee**, for the reactor's own event bus:
  "Wakeups are a lossy latency hint; the fallback poll is the delivery guarantee"
  (`reactor.ts:118-119`).
- **Progress is spec-bound to a read model, never events**
  (`openspec/specs/download-management/spec.md:22-29`).

These five precedents matter because the strongest option below is largely *assembled from them*.

---

## 2. What the prior art says (primary sources)

### 2.1 Enterprise Integration Patterns (Hohpe & Woolf)

- **Polling Consumer** [E1]: a receiver that "explicitly makes a call when it wants to receive a
  message" — a *synchronous* receiver whose thread blocks. Hohpe/Woolf present it as a legitimate
  pattern *for a dedicated consumer*, paired with **Event-Driven Consumer** [E2] as the
  alternative. Nothing in EIP endorses running a polling loop *inside* an orchestrator.
- **Channel Adapter** [E3]: a component that connects an application (here: slskd, via its API) to
  the messaging system, "access[ing] the application's API or data to publish messages" — i.e. the
  named pattern for *an adapter that polls a foreign API and emits messages inward*, keeping the
  core decoupled from the foreign system's observation mechanics.
- **Process Manager** [E4]: maintains process state and decides next steps from intermediate
  results — and the pattern's own description emphasizes **delegation**: the manager orchestrates;
  processing units do the work and report back. Our reactor is the Process Manager; the download
  is a processing unit's job.

### 2.2 Sagas and timeouts (Udi Dahan / NServiceBus)

The NServiceBus saga documentation states the discipline outright: **"A saga should only interact
with its own internal state and send or publish messages. It must not perform any I/O operations,
including calls to databases, web services, or other external resources, either directly or
indirectly through injected dependencies."** For integrations, the documented shape is: the saga
sends a command to a *handler*, the handler performs the external operation and **replies with a
result message**, and the saga reacts to that message [N1]. Waiting is modeled with **durable
timeout messages** (`RequestTimeout<T>`): non-blocking, persisted alongside saga state, delivered
back to the saga later; a late timeout arriving after the saga has moved on is *ignored based on
saga state* [N2] — precisely this codebase's stale-outcome idiom.

### 2.3 Workflow engines (Temporal/Cadence)

Temporal enforces the same split as a hard rule: **"Workflow code must be deterministic to support
replay. To handle non-deterministic operations like API calls … put them in Activities"** [T1].
Long-running activities (their example: "reading a large file from Amazon S3") **heartbeat**, and
a short heartbeat timeout is the stall detector: "we recommend using a relatively short Heartbeat
Timeout and a frequent Heartbeat" [T2]. Two details are instructive here:

- Heartbeats are **throttled and not all persisted** — routine liveness telemetry is deliberately
  kept out of durable history even by a system whose whole product *is* durable history [T2].
- Temporal *does* persist timer and activity-scheduling events — but into the **workflow
  execution's own orchestration history**, an infrastructure journal scoped to one execution and
  meaningless as business truth. It is the separation that matters: orchestration bookkeeping and
  business facts are different records.

### 2.4 Control loops (Kubernetes)

The Kubernetes design principles are the sharpest statement of the observation half of the
problem: **"Functionality must be *level-based*, meaning the system must operate correctly given
the desired state and the current/observed state, regardless of how many intermediate state
updates may have been missed. Edge-triggered behavior must be just an optimization."** and
"Assume an open world: continually verify assumptions" [K2]. Controllers watching external systems
"find their desired state from the API server, then communicate directly with an external system
to bring the current state closer in line" and re-observe continuously [K1]. Applied here: the
watcher must be able to reconstruct "what should I be watching" from durable truth at any time —
which the ownership ledger + folded state already provide — and any push signal (webhook) is at
most a latency optimization over the sampling loop, never the correctness mechanism.

### 2.5 Actor supervision (Erlang/OTP)

OTP's answer to long-running, failure-prone work is structural: workers do the risky work,
**supervisors** monitor and restart them; **monitors** deliver a *message* when the observed thing
dies, rather than propagating failure [ER1][ER2]. External OS processes get a dedicated owner
(port/middleman process) whose death is observed and handled — never a blocking wait inside the
coordinating process. The translation: give the external transfer a dedicated in-process observer
whose outcomes arrive as messages, and make its resurrection a supervision concern (here: the
startup re-drive).

### 2.6 The directly comparable product: Sonarr's download tracking

Sonarr (same domain: orchestrating a third-party download client, then importing) solved exactly
this problem, in code that has survived a decade of production:

- `DownloadMonitoringService` [A1] is a dedicated service — **not** part of any
  command-processing pipeline — triggered by grab/import events and commands, with a
  **5-second debouncer** coalescing bursts; each refresh polls *all* enabled download clients,
  filters the results to trackable items, updates the tracked set, and **publishes
  `TrackedDownloadRefreshedEvent`** for the rest of the system to consume.
- `TrackedDownloadService` [A2] keeps tracked-download state in a **volatile in-memory cache**,
  and correlates client items back to Sonarr's own records via its (durable) history by download
  ID. On restart the cache is simply **rebuilt by re-querying the client and re-correlating** —
  the download client itself is the durable truth of transfer state; Sonarr persists only its own
  business facts (history) and correlation keys.

That is: an observing supervisor module, polling on its own cadence, in-memory watch state,
level-triggered rebuild from (client + own ledger) on restart, outcomes fed to the core as
messages. Note also what Sonarr does *not* do: it does not persist per-poll observations, and it
does not block its command pipeline on a transfer.

### 2.7 Scheduling and time in event-sourced systems (Verraes, Dudycz)

Verraes' **Passage of Time Event** [V1] models time as *generic system-level* domain events
(`DayHasPassed`) consumed by whoever cares — with the explicit caveat that it suits coarse
granularity and is **unsuitable for near-realtime cadences** ("minutes or seconds or less").
Dudycz's refinement [D1] combines it with a **To-Do List** pattern: pending work is *derived from
events into a minimal read model* (id + deadline), cadence ticks trigger a query over that read
model, and detailed state stays in the event stream — i.e. even the practitioners friendliest to
"time as events" put the *schedule itself* in an operational side-table/read model, not appended
per-entity into business streams.

---

## 3. Per-option analysis against the constitution

The constitution's tests applied to each option: events are business facts, "not incidental
telemetry" (`docs/development/event-sourcing.md` §"Events are facts"); the domain stays pure
(`domain-driven-design.md` §"Keep the domain pure"); ports are narrow, adapters own foreign
mechanics (`architecture.md`); errors are values crossing the port as `Result`
(`error-handling.md`); tests are deterministic, "no real clock/network in unit tests"
(`testing.md` §"What to test") under a 100%-coverage hard gate; one acquisition must not delay
others (`acquisition-lifecycle/spec.md:145-147`); progress is a read model, never events
(`download-management/spec.md:22-29`).

### A. Status quo — synchronous blocking effect

**Named pattern:** a Polling Consumer [E1] embedded *inside* the Process Manager [E4] — the exact
composition every surveyed body of practice forbids: it is I/O inside the saga [N1], external
blocking inside workflow code [T1], and a worker's job done in the supervisor's thread [ER1].

**Constitution fit:** violates the isolation requirement in effect (§1.1.1), and structurally
wedges same-stream cancellation (§1.1.2). Its one virtue is real: the single mutex makes the whole
system's concurrency trivially reasoned about, and the effect's success/failure lands through the
existing `Result` channel with no new parts. But the virtue is exactly what an hour-long hold
turns into the defect.

**Verdict:** the baseline to beat; fails the system's own spec.

### B. Per-stream concurrency — one mutex per acquisition, effects stay blocking

**Named pattern:** per-entity mailboxes — half of the actor model. The half it takes
(serialization per entity) is the half the reactor already gives per-stream by other means; the
half it leaves out (supervised, non-blocking workers [ER1]) is the half this problem needs.

**Analysis:** it relieves *cross*-acquisition head-of-line blocking, but:

- **Same-stream cancellation stays wedged** — the `AbortDownload` dispatch now waits on the
  *stream's* mutex, which the in-flight `Download` dispatch holds. The causal inversion of §1.1.2
  survives untouched. (The lifecycle spec explicitly demands settlement-after-cancellation
  handling, `acquisition-lifecycle/spec.md:184-197` — a shape B makes unreachable until the
  download self-settles.)
- The single global checkpoint ("advance only once dispatched or parked") stops being coherent:
  with N streams mid-dispatch concurrently, the checkpoint can only advance to the *minimum*
  settled position — one hour-long download again holds the checkpoint (and therefore redelivery
  scope) for everyone, or the checkpoint model must be rebuilt per-stream. Either way the
  simplest, most load-bearing invariant in `reactor.ts` is spent on not solving the problem.
- An hour-long await still lives in process memory; a crash still loses it (mitigated today by
  reconcile-before-enqueue — but that machinery is doing the real work, not the mutex change).

**Verdict:** the most invasive change to the reactor's core invariants for the least behavioral
gain. No surveyed system chose this shape.

### C. Park-and-repoll — the parked-effect table as a scheduled continuation

**Named pattern:** genuinely well-trodden — this is the **durable timeout message** [N2] /
**scheduled continuation** shape, and close kin to Dudycz's To-Do List + Passage-of-Time
combination [D1]: durable side-table row = (stream, due-time, watch state), each due tick performs
one observation step, reschedules or settles.

**Constitution fit — credits first:**

- Keeps watch state (last bytes seen, budget clocks) **durable**, so a crash mid-watch resumes
  with honest budgets rather than reset ones — strictly better crash semantics than today
  (re-attach currently resets stall/queue budgets, `download.ts:112-115`).
- Zero new runtime components; scheduling stays where scheduling already lives; the observation
  step is short, so the mutex is held for milliseconds per tick; time-based logic is testable with
  the injected `Clock` exactly as retry scheduling already is.
- Nothing lands in the event stream — the spec's progress rule is honored.

**Debits:**

- **It complects two meanings of "parked"** (Hickey's precise sense of complect [H1]). Today a
  park means *unhealthy: a failing effect backing off*, with attempts, budgets, exhaustion,
  landing, and stalled-exposure semantics (`reactor.ts:333-407`). C adds *healthy: in-progress
  work observing on cadence*. Every consumer of the table — the retry scheduler, the exhaustion
  ladder, the stalled read model, the startup re-drive's "parked streams belong to the retry
  scheduler" rule (`reactor.ts:193`), operator surfaces — must now branch on which kind of park it
  is. That is the definition of entangled concepts, and it is *easy* (familiar table) rather than
  *simple*.
- **The no-leapfrog rule turns against cancellation.** A parked stream queues its later events
  behind the park (`reactor.ts:268-277`). A cancel arriving mid-watch therefore waits for the next
  scheduled tick before its abort can dispatch — better than A's wait-for-settlement, but
  cancellation latency is now coupled to poll cadence, or the no-leapfrog rule needs a carve-out
  for watch-parks (more branching on park kind).
- **Poll cadence per active download runs through the one global mutex.** Each step is short, but
  K active downloads at a ~1 s cadence make the reactor's drain loop a busy scheduler; the mutex
  is now contended by design rather than by exception. Verraes' own caveat applies: time-as-ticks
  machinery is not meant for second-granularity cadences [V1].
- The observation step itself (HTTP GET, aggregate, compare budgets) must be dressed as an
  "effect that fails retryably until done" — a healthy in-progress state expressed through the
  failure channel, which strains errors-as-values semantics (`error-handling.md`: "Business
  sadness is not an error" — and *business patience* isn't either).

**Verdict:** a legitimate, well-precedented runner-up. Its durable-budget property is real and is
the honest counterargument to the recommendation (§5).

### D. Scheduling-as-events — repoll ticks appended to the acquisition's event stream

**Named pattern:** Verraes' Passage of Time Event [V1] — *misapplied*. Verraes' events are
system-level, coarse (`DayHasPassed`), and explicitly cautioned against second-granularity use;
here they would be per-stream, ~1 s apart, for an hour: thousands of `WatchTicked` facts per
acquisition.

**Constitution fit:** fails directly. Events "capture business-meaningful transitions — not
incidental telemetry" (`event-sourcing.md` §"Events are facts"); the download-management spec
already rules the nearest cousin out by name ("SHALL NOT record progress updates as acquisition
events", `spec.md:22-29`); a tick is *less* meaningful than a progress update. Every projection,
the timeline UI, upcasting surface, and replay cost inherits the noise forever (events are never
deleted). The precedent D's proponents might cite — Temporal persisting timer events — actually
cuts the other way: Temporal persists them into a per-execution *orchestration journal*, a
different record from business truth (§2.3); this codebase's equivalent of that journal is
precisely the operational side-table C uses, not the acquisition stream. NServiceBus likewise
stores timeout state in saga persistence, not as messages in a business stream [N2].

**Verdict:** eliminated. The one thing it uniquely offers — deterministic replay of *when we
looked* — has no consumer: stall judgment needs the observation *results*, and those come from
the outside world, which replay cannot reproduce anyway.

### E. Observing-adapter / supervisor module

The adapter becomes an active module: the reactor's `Download` effect turns into a fast
**"enqueue + watch with these budgets"** command that returns as soon as slskd accepts the
enqueue (or rejects it — that path stays synchronous and value-typed exactly as today,
`download.ts:120-143`); the module then polls on its own cadence, owns stall/queue *detection*
against the domain-owned budgets it was handed (the division the adapter already documents,
`download.ts:30-34`), and settles by feeding the source-agnostic outcome — completed /
failed-with-reason / stalled-past-budget — back into the core **as a command through `decide`**,
the same re-entry every effect result and the importer's verdicts already use
(`interpreter.ts:85-93`, `verdict-consumer.ts:8-15`), where staleness (late settlement after
cancellation) is already specified and handled (`acquisition-lifecycle/spec.md:184-197`).
Progress remains the ephemeral read model. No second event store: slskd's transfers API +
persisted success log are the durable truth of transfer state; our ownership ledger is the durable
correlation record; on restart the reactor's existing level-triggered re-drive re-dispatches the
pending effect and reconcile-before-enqueue re-attaches the watch (`reactor.ts:189-196`,
`download.ts:112-119`).

**Named patterns — this is where the surveyed literature converges:**

| Source | The matching construct |
|---|---|
| EIP | Channel Adapter [E3] containing a Polling Consumer [E1], reporting to the Process Manager [E4] as messages |
| NServiceBus | the documented saga-integration shape: handler does the I/O, replies a result message; saga reacts, ignores stale arrivals [N1][N2] |
| Temporal | the long-running Activity: side-effectful, outside the deterministic orchestrator, heartbeat-supervised for stall detection [T1][T2] |
| Kubernetes | a controller for external state: level-based observation loop; push at most an optimization [K1][K2] |
| Erlang/OTP | worker + monitor: outcomes as messages; resurrection is supervision (here: startup re-drive) [ER1][ER2] |
| Sonarr | `DownloadMonitoringService` + volatile `TrackedDownload` cache rebuilt from client+ledger on restart [A1][A2] — the same domain, the same answer |
| slskd itself | its own UI observes transfers by 1 s polling [S4] |

**Constitution fit:**

- *Dependency rule / ports:* the port narrows to consumer shape (`startWatch(acquisitionId,
  candidate, policy)` + `abort`) with outcomes arriving via the existing command path; slskd's
  polling mechanics, cadence, and API quirks stay entirely in the adapter — where the constitution
  says foreign mechanics belong (`architecture.md` §"Ports & adapters"). The domain and decider do
  not change at all: `decide` already guards the same `RecordDownloadCompleted/Failed` commands.
- *Isolation:* the mutex is held only for the enqueue round-trip; searches, resolutions, retries,
  and — critically — the `AbortDownload` dispatch flow freely. Cancellation's causal arrow is
  restored: abort reaches slskd while the transfer is live, and the watcher then observes the
  cancellation like any other settlement.
- *Errors as values:* enqueue faults stay on the synchronous `Result` channel; watch outcomes are
  modeled outcomes (completed/failed/stalled), not errors — matching "business sadness is not an
  error" better than C's dress-a-poll-as-a-retryable-failure.
- *Events are facts:* only settlements enter the stream; ticks and progress never do.
- *Testability under the 100% gate:* the watch loop is a pure-scheduling core around an injected
  `Timer`/`Clock` (the adapter already injects `Timer`, `download.ts:69`); deterministic
  fake-clock unit tests for budget logic, adapter-tier tests against the recorded-fixture slskd
  client for the I/O skin — the same tiers that cover today's loop, minus the mutex entanglement.
  Nothing about the shape resists honest coverage.
- *Simple over easy:* each concept gets one home — orchestration (reactor), observation (watcher),
  correlation (ledger), truth (slskd + event stream), progress (read model). No construct carries
  two meanings. The cost of simplicity here is a genuinely new moving part; that cost is examined
  honestly in §5.

**Design obligations E must meet (from the same sources):**

1. **Level-triggered watch registration.** "What should I be watching" must be derivable from
   durable truth (folded state + ledger), never only from an in-memory registration — K8s's
   level-based rule [K2], Sonarr's restart rebuild [A2]. The existing re-drive already does this
   derivation; the watch command must stay idempotent under it (re-attach, don't re-enqueue —
   already the adapter's documented behavior).
2. **The watcher's own liveness is supervision, not trust.** If the watch loop dies with an
   unhandled fault, the acquisition must not go dark: the watcher's death must either surface as a
   retryable effect failure into the existing park machinery, or be re-derived by the re-drive on
   the next boot — never silently absent (the "pending forever, nothing in the logs" class the
   reactor already guards against, `reactor.ts:225-229`).
3. **Budget reset on re-attach is a documented, accepted loss.** In-memory watch state means a
   restart resets stall/queue clocks (as today, `download.ts:112-115`). Worst case a hopeless
   queue survives one budget per process lifetime — acceptable, but it should be stated in the
   spec rather than discovered. (If it ever stops being acceptable, persisting `watchStartedAt`
   per ledger row is a small, targeted fix — not a reason to choose C wholesale.)
4. **Concurrency honesty.** Outcome commands now race reactor dispatches; both funnel through
   `decide` + optimistic append, which is precisely the codebase's stated idempotency mechanism
   ("Effect results re-enter as commands and pass back through `decide` … giving idempotency for
   free", `event-sourcing.md`). No new locking is needed, but the review must treat the
   append-race path as first-class, not incidental.

### F. Upstream-push-primary — webhooks/SignalR as the main signal

**Named pattern:** Event-Driven Consumer [E2] — chosen against an upstream whose event vocabulary
cannot express the outcomes we need.

**Constitution/facts fit:** eliminated by verified upstream facts. slskd emits **no** failure,
stall, or queue events at all [S1]; the entire policy-judgment half of the problem (stalls,
hopeless queues) is invisible to the push channel *by construction*, and the success half defaults
to one delivery attempt with a 5 s timeout [S3]. Kubernetes names the principle exactly:
edge-triggered behavior "must be just an optimization" [K2]; this codebase already applies the
same rule to its own bus (`reactor.ts:118-119`). slskd's persisted success log
(`GET /api/v0/events` [S2]) *is* worth consuming — as a completion-latency hint and a
reconciliation cross-check inside E's watcher — but it can never carry correctness.

**Verdict:** eliminated as *primary*; retained as an optional latency optimization inside E.

---

## 4. Comparison

| | A status quo | B per-stream mutex | C park-and-repoll | D ticks-as-events | E observing adapter | F push-primary |
|---|---|---|---|---|---|---|
| Named pattern | Polling Consumer inside Process Manager (anti-composition) | half an actor model | durable timeout / scheduled continuation [N2][D1] | Passage-of-Time, misapplied [V1] | Channel Adapter + supervised worker [E3][N1][T2][K2][A1] | Event-Driven Consumer [E2] vs. an inexpressive upstream |
| Other acquisitions flow | ✗ | ✓ | ✓ (mutex busy but unblocked) | ✓ | ✓ | ✓ |
| Cancel an in-flight download promptly | ✗ (waits for settlement) | ✗ (same, per-stream) | ~ (next tick, or park-kind carve-out) | ~ | ✓ (abort dispatches immediately) | ✓ |
| Stall/queue judgment possible | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (no failure events exist [S1]) |
| Event stream stays facts-only | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Watch budgets survive crash | ✗ | ✗ | ✓ (durable rows) | ✓ (in stream) | ✗ (reset on re-attach; documented) | n/a |
| Reactor invariants untouched | ✓ | ✗ (checkpoint model rebuilt) | ~ (park semantics forked) | ~ | ✓ | ✓ |
| New moving parts | none | none | none | none | one (watcher module) | webhook endpoint |
| Concept entanglement (Hickey) | effect-duration ⊗ dispatch-lifecycle | same | park ⊗ (failure-backoff ∣ healthy-cadence) | stream ⊗ scheduler | none new | correctness ⊗ upstream vocabulary |
| Precedent in surveyed systems | none | none | NServiceBus timeouts | none at this granularity | NServiceBus, Temporal, K8s, OTP, Sonarr, slskd's own UI | none (all pair push with polling) |

---

## 5. Recommendation

**Option E — the observing-adapter/supervisor module — augmented with two elements from the
others:** the slskd persisted success log and (if later wired) webhooks as *latency hints* inside
the watcher (F's residue, under the codebase's own "lossy hint / poll is the guarantee" doctrine,
`reactor.ts:118-119`); and C's one genuinely superior property kept on the shelf as a targeted
follow-up (persist `watchStartedAt` in the ledger row) should budget-reset-on-restart ever prove
unacceptable in practice.

The evidence base: every surveyed body of practice that has solved this class of problem —
messaging (EIP, NServiceBus), durable workflow (Temporal), infrastructure control (Kubernetes),
fault-tolerant runtimes (OTP), and two products in this *exact* domain (Sonarr; slskd's own UI) —
independently converges on the same decomposition: **a deterministic orchestrator that never
blocks on external I/O; a side-effectful observer that samples on its own cadence, level-triggered
so restarts re-derive its work from durable truth; outcomes re-entering the orchestrator as
messages that stale-guard themselves.** This codebase already owns every piece of that
decomposition — the command re-entry path, the stale-outcome spec, the ownership ledger with
reconcile-before-enqueue, the level-triggered re-drive, the progress read model, the
push-as-hint doctrine — which is why E is less a new architecture than the completion of an
existing one: the blocking loop in `download.ts:146-185` is the only component currently sitting
on the wrong side of its own system's seams.

**The strongest counterargument (stated honestly):** C achieves durability of the *watch itself*
with zero new runtime components. E's watch state lives in process memory, so its crash story
rests on a two-part invariant — re-drive re-derives, reconcile re-attaches — that is subtler than
C's "the row is in the table", and re-attach resets stall/queue budgets where C's would resume
them honestly. A reviewer channeling the parked-effect table's designers can fairly say: *the
system already has a durable "look again later" mechanism; a supervisor module is a second
scheduler to operate, test to 100%, and reason about concurrently with the reactor.* The rebuttal
is Hickey's distinction and the park-semantics fork: C is easier (familiar parts) but complects
healthy observation with failure backoff across every consumer of the table, couples cancellation
latency to poll cadence through the no-leapfrog rule, and routes per-second observation of every
active download through the one mutex whose serial simplicity is its entire value — while the
durability C uniquely offers protects against a loss (budget reset on the rare restart) that is
bounded, already the status quo's behavior, and independently fixable with one ledger column. But
it is a real trade, not a strawman: if the team weighs "no new moving parts" above "one meaning
per construct", C is the defensible second choice — and D and F are not defensible at all.

---

## 6. Answers to the two framing questions

**Where does the irreducible sampling live?** In the slskd adapter, promoted to an active module
(Channel Adapter containing a Polling Consumer), because the sampling cadence, transfer-record
shapes, and re-attach mechanics are all facts about slskd — and the constitution places foreign
mechanics in adapters. The domain contributes only the budgets (policy values it already owns).

**How do outcomes re-enter the event-sourced core?** As the same source-agnostic settlement
commands they enter by today (`RecordDownloadCompleted` / `RecordDownloadFailed` with
source-agnostic reasons), through `decide`, which already converges redelivery and staleness to
no-ops — the identical shape used for the importer's verdicts. Ticks and progress never touch the
stream; progress remains the ephemeral read model the spec requires.

---

## 7. Citations

**This repository** (checkout: `/home/jake/Projects/music-downloader-2-proposal`, commit `54a1c19bc117`):

- `packages/downloader/src/application/acquisition/reactor.ts:74-75, 118-119, 152-156, 189-196, 225-229, 268-277, 333-407`
- `packages/downloader/src/adapters/slskd/download.ts:30-34, 69, 112-119, 120-143, 146-185, 187-204`
- `packages/downloader/src/application/acquisition/interpreter.ts:80-94, 127-137`
- `packages/downloader/src/interfaces/events/verdict-consumer.ts:8-15`
- `openspec/specs/download-management/spec.md:22-29` (progress is a read model, never events)
- `openspec/specs/acquisition-lifecycle/spec.md:145-147` (no cross-acquisition delay), `:175-183` (readiness), `:184-197` (stale outcomes; settlement-after-cancellation)
- `docs/development/event-sourcing.md`, `architecture.md`, `domain-driven-design.md`, `error-handling.md`, `testing.md`, `design-principles.md`

**slskd** (source, master @ 2026-08-02):

- [S1] `EventType` enum — success-only vocabulary, no failure/stall events: <https://github.com/slskd/slskd/blob/master/src/slskd/Events/Types/Events.cs>
- [S2] Persisted-events query API (`GET /api/v0/events`, offset/limit): <https://github.com/slskd/slskd/blob/master/src/slskd/Events/API/EventsController.cs> (route at line 49, `GetEvents` at 79-100)
- [S3] Webhook defaults — 5 s timeout, one attempt per event: <https://github.com/slskd/slskd/blob/master/docs/config.md>
- [S4] slskd's own web UI polls transfers at 1 s: <https://github.com/slskd/slskd/blob/master/src/web/src/components/Transfers/Transfers.jsx> (`window.setInterval(fetch, 1_000)`, line 36)

**Enterprise Integration Patterns (Hohpe & Woolf)**:

- [E1] Polling Consumer: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/PollingConsumer.html>
- [E2] Event-Driven Consumer: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/EventDrivenConsumer.html>
- [E3] Channel Adapter: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/ChannelAdapter.html>
- [E4] Process Manager: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html>

**NServiceBus (Particular Software docs)**:

- [N1] Sagas — "must not perform any I/O operations … directly or indirectly"; delegate to handlers, react to reply messages: <https://docs.particular.net/nservicebus/sagas/>
- [N2] Saga timeouts — durable, non-blocking, state in saga persistence, late timeouts ignored by saga state: <https://docs.particular.net/nservicebus/sagas/timeouts>

**Temporal**:

- [T1] Workflow determinism — "Workflow code must be deterministic to support replay … put [external interactions] in Activities": <https://docs.temporal.io/workflow-definition>
- [T2] Activity timeouts & heartbeats — short heartbeat timeout for long-running activities; heartbeat throttling (not all persisted): <https://docs.temporal.io/encyclopedia/detecting-activity-failures>

**Kubernetes**:

- [K1] Controllers — control loops, reconciliation, controllers for external state: <https://kubernetes.io/docs/concepts/architecture/controller/>
- [K2] Design principles — "Functionality must be level-based … Edge-triggered behavior must be just an optimization"; "Assume an open world": <https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/principles.md>

**Erlang/OTP**:

- [ER1] Supervision principles (workers/supervisors, restart): <https://www.erlang.org/doc/system/design_principles.html>
- [ER2] `supervisor` behaviour reference: <https://www.erlang.org/doc/apps/stdlib/supervisor.html>

**Sonarr** (source, develop @ 2026-08-02):

- [A1] `DownloadMonitoringService` — dedicated monitoring loop, 5 s debouncer, publishes `TrackedDownloadRefreshedEvent`: <https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Download/TrackedDownloads/DownloadMonitoringService.cs>
- [A2] `TrackedDownloadService` — volatile in-memory tracked cache, correlation via durable history by download ID, rebuilt on restart: <https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Download/TrackedDownloads/TrackedDownloadService.cs>

**Time & scheduling in event-driven systems**:

- [V1] Mathias Verraes, *Passage of Time Event* — coarse-grained time as system events; "unsuitable for realtime" cadences: <https://verraes.net/2019/05/patterns-for-decoupling-distsys-passage-of-time-event/>
- [D1] Oskar Dudycz, *Combining the To-Do List and the Passage Of Time patterns* — pending work derived into a minimal read model; schedule state outside business streams: <https://event-driven.io/en/to_do_list_and_passage_of_time_patterns_combined/>

**Simplicity**:

- [H1] Rich Hickey, *Simple Made Easy* (Strange Loop 2011) — simple (un-complected, one braid per concept) vs. easy (familiar, near-at-hand): <https://www.infoq.com/presentations/Simple-Made-Easy/>
