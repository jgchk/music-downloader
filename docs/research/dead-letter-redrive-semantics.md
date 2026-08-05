# How do mature systems redrive dead-lettered work?

**Research date:** 2026-08-05.

**Question.** The reactor dead-letters a budget-exhausted effect into a SQLite ledger row
`(subscription, globalSeq, error, occurredAt, streamId)` and marks the stream stalled; recovery
today is manual DB surgery + restart. We are adding an operator-facing **redrive verb** on an
owner-gated admin surface. The house leaning (open to challenge): redrive is an infra-level
operation — no domain event — per-stream, implemented as *clear the stream's letters + stalled
mark, then re-dispatch the pending effect derived from current state through the normal dispatch
path*. What do mature messaging/event systems actually do on the five open sub-questions:
failure-again semantics, ledger disposition, operator feedback, granularity, and the paired
give-up verb?

**Method.** Primary sources only, fetched 2026-08-05: AWS SQS developer guide and API reference;
Particular Software's own ServicePulse/NServiceBus docs; MassTransit's docs; Confluent's Kafka
Connect DLQ deep-dive (Robin Moffatt); Sidekiq's wiki plus the actual `api.rb` and Web UI route
source on GitHub; Oban's hexdocs; Temporal's docs and CLI reference; Hohpe & Woolf's
enterpriseintegrationpatterns.com; erlang.org; the `systemctl(1)` man page. House constraints
from `docs/development/event-sourcing.md`, `docs/development/error-handling.md`, and the reactor
source. Citations gathered in §6. Unreachable/secondary sources are flagged where used:
freedesktop.org returned 403 for the systemctl page (the man7.org mirror of the same man page is
cited instead); `docs.particular.net/servicecontrol/errors` returned 404 (superseded by the
ServicePulse pages, which were fetched directly); one NServiceBus inference is marked
[secondary].

The supervisor/delivery-loop side of this territory — why effects settle off the mutex, how
outcomes re-enter as commands — was already researched in
[`nonblocking-external-work-observation.md`](nonblocking-external-work-observation.md) and is
cross-referenced, not re-argued.

---

## 1. The house shape being decided (facts from this repo)

- A dead letter is recorded per failed effect with `streamId` "so the owning acquisition can be
  exposed as stalled"; the port already has `clearStream` ("Drop a resolved stream's letters
  (idempotent) — the acquisition is no longer stalled") and `prune` (retention horizon)
  (`packages/downloader/src/application/ports/dead-letter-port.ts:4-29`).
- A stalled stream that is later driven successfully by any event already self-heals: "A stalled
  acquisition's stream was driven successfully again (a cancellation, an operator resubmission):
  its dead letters are resolved — clear them and the stalled exposure"
  (`packages/downloader/src/application/acquisition/reactor.ts:296-300`).
- The startup re-drive is level-triggered — "fold every stream and re-dispatch the effect its
  current state is waiting on through the normal idempotent path" — and **deliberately skips
  stalled streams**: "landed; awaiting an operator" (`reactor.ts:188-196`, `:221`). So the
  proposed verb is precisely "un-land this stream and give it back to the machinery that already
  knows how to drive it."
- Constitution constraints: events are business facts, "not incidental telemetry"
  (`docs/development/event-sourcing.md` §"Events are facts"); errors are values handled "at the
  boundary that can actually make a decision, once" (`docs/development/error-handling.md`);
  at-least-once delivery with idempotency via re-entry through `decide`
  (`event-sourcing.md` §"Decisions in `decide`, effects in `react`"); no breaking changes to
  public contracts (CLAUDE.md non-negotiables).

---

## 2. Prior art, system by system

### 2.1 AWS SQS — DLQ redrive as an asynchronous *move* task

- Redrive "move[s] unconsumed messages from a dead-letter queue to another destination for
  processing. By default, dead-letter queue redrive moves messages from a dead-letter queue to a
  source queue" [Q3]. It is a **move, not a copy**: the minimum IAM permissions for a redrive are
  `ReceiveMessage` + `DeleteMessage` on the DLQ and `SendMessage` on the destination [Q3] — the
  message leaves the DLQ as it goes.
- **Failure-again = fresh full budget, and a severed history.** "The redrive task resets the
  retention period. All redriven messages are considered new messages with a new `messageID` and
  `enqueueTime`" [Q3]. A new message starts a new receive count against the source queue's
  `maxReceiveCount` (the redrive policy that dead-letters "messages that are not processed
  successfully" after that many receives [Q1][Q2]) — so a still-broken message will burn a full
  retry budget and land in the DLQ *again*, as a fresh letter with no linkage to its previous
  episode.
- **Feedback = fire-and-forget with a status object.** `StartMessageMoveTask` "starts an
  asynchronous task" and returns a `TaskHandle`; status is polled via `ListMessageMoveTasks`
  ("the most recent message movement tasks (up to 10)") and a RUNNING task can be cancelled —
  already-moved messages stay moved [Q3][Q4].
- **Granularity = whole-queue only.** "Amazon SQS doesn't support filtering and modifying
  messages while redriving them from the dead-letter queue" [Q3]; there is no per-message
  redrive, only velocity control ("Custom max velocity … maximum allowed rate is 500 messages
  per second"), a 36-hour task ceiling, 100 active tasks per account, and "only one active
  message movement task … per queue at any given time" [Q3][Q4].
- **Give-up verb:** none dedicated — disposal is retention expiry or a queue purge; AWS's own
  best practice is to make the DLQ's retention *longer* than the source's because a moved
  message keeps its original enqueue timestamp on standard queues [Q1].

### 2.2 NServiceBus / ServiceControl / ServicePulse — the richest operator story surveyed

- Endpoint-side, recoverability is immediate retries ("by default, up to five") then delayed
  retries ("delays start with at 10 seconds, then 20 seconds, and lastly 30 seconds"), then
  "messages which fail multiple times are moved to the configured error queue" with exception
  details attached [P5]. ServiceControl ingests that error queue into its own database; the
  broker queue is not the operator's working surface — the ingested record is [P1].
- **Failure-again = a new failure, with an episode counter.** "A message that is sent for retry
  is marked as such and is not displayed in the failed message list or included in failed
  message groups **unless reprocessing the message fails again**"; "ServiceControl keeps track
  of all retry attempts in the background. If a retry operation fails, ServicePulse will show
  the number of failed retry attempts" [P2]. The redriven message re-enters the endpoint's input
  queue as an ordinary message, so it passes through the endpoint's full recoverability policy
  again before returning to the error queue [secondary — implied by the retry re-sending to the
  endpoint's queue [P2] and recoverability applying to message processing generally [P5]; not
  stated as one sentence in the fetched pages].
- **Ledger disposition = retain everything, re-label.** Nothing is deleted on retry — the record
  is hidden from the failed list while "sent for retry" and resurfaces on failure [P2]. Even the
  delete verb is soft: deleting (archiving) marks messages `Deleted`; "Data from a deleted
  message is still available … If any failed messages were deleted by mistake, they can be
  restored from the Deleted Messages tab", and actual removal happens later under the
  ServiceControl error-retention period [P3].
- **Feedback = asynchronous with a first-class limbo state.** Group retries show operation
  progress, and a "completed retry request … means those messages may not have been processed
  yet" [P1]. The **Pending Retries** view exists precisely for the fire-and-forget gap: "failed
  messages that have been requested to be retried but have not completed yet"; status updates
  only "when the message is processed again as either an audited message (i.e. a successful
  delivery) or as a failed message". Operators can retry again or "manually mark the failed
  message as resolved", with the warning: "Retrying pending messages can cause the same message
  to be processed multiple times. Do not retry a message if it has been processed by the
  endpoint" [P4].
- **Granularity = per-message first, then group.** Individual/custom selection retry is
  positioned for "testing system fixes before deciding to retry several messages in a group";
  groups (by exception type + stack trace, message type, endpoint) retry as a whole [P1].
- **Give-up verb = archive**, restorable, retention-pruned, plus **mark-as-resolved** for
  pending retries [P3][P4].

### 2.3 MassTransit — an error queue with *no* first-party redrive

Faulted messages move to a `_error` queue with "exception details … stored as headers with the
message for analysis" [M1]. The documented operator story is broker tooling: "Once the reason for
the fault has been resolved, you can use the tool to extract the original message and send it
back to the original consumer" — and for anything richer MassTransit explicitly points at
Particular's platform [M1]. The lesson is negative but real: a dead-letter surface without a
built-in redrive verb outsources the verb to raw infrastructure tools — exactly the "manual DB
surgery" stage this project is trying to graduate from.

### 2.4 Kafka (Confluent / Robin Moffatt) — the log-native disposition

Kafka Connect routes bad records to a dead-letter *topic* (with `errors.tolerance = all` and
optional error-context headers carrying topic/partition/offset/exception) while "valid messages
are processed as normal, and the pipeline keeps on running" [K1]. Reprocessing is *another
consumer over the DLQ topic* — Moffatt's worked pattern is a chained second sink that re-reads
the DLQ with different handling [K1]. Because the DLQ is a topic, records "remain … per
configured topic retention policies, not automatic deletion upon reprocessing" [K1]: worklist
position (consumer offset) and history (the log) are structurally separate, so redrive never
destroys the record of the episode. There is no per-record verb at all — granularity is "run a
consumer from an offset."

### 2.5 Sidekiq — the smallest complete operator UI in the survey

- Exhausted retries (default "25 retries over approximately 20 days") land the job in the Dead
  set: "a holding pen for jobs which have failed all their retries", capped at "10,000 jobs or
  6 months so it doesn't grow infinitely" [SK1].
- **Failure-again = one fresh attempt, budget otherwise preserved.** The Web UI's retry calls
  `SortedEntry#retry`, which is, in full:

  ```ruby
  def retry
    remove_job do |message|
      msg = Sidekiq.load_json(message)
      msg["retry_count"] -= 1 if msg["retry_count"]
      Sidekiq::Client.push(msg)
    end
  end
  ```

  — remove from the set, decrement the counter by exactly one, re-push [SK2]. The manual retry
  therefore doesn't consume budget: a dead job gets one real attempt and, on failure, returns to
  the morgue rather than restarting 25 retries. No fresh-budget reset, no immediate
  re-dead-letter either.
- **Ledger disposition = removal.** `remove_job` takes the entry out of the dead set as part of
  retrying it [SK2]; the job payload itself carries its error metadata forward, but the morgue
  row is gone.
- **Feedback = fire-and-forget.** Retry is a re-push onto the queue; the operator learns the
  outcome by the job's later reappearance in Retries/Dead tabs [SK1].
- **Granularity & verbs:** the Web UI routes are the whole verb inventory — morgue: per-job and
  selected-set `retry`/`delete`, plus `POST /morgue/all/retry` (`DeadSet.new.retry_all`) and
  `POST /morgue/all/delete` (`DeadSet.new.clear`); retries tab additionally has
  `POST /retries/all/kill` (send to morgue) [SK3]. **Kill and delete are distinct give-up
  verbs**: `kill` moves to the dead set and fires configured `death_handlers`
  (`DeadSet#kill` [SK2]); `delete` discards outright; `retry: false` jobs are "simply
  discarded" without ever entering the morgue [SK1].

### 2.6 Oban — the same one-more-attempt grant, stated in the API

`Oban.retry_job` on a `retryable`/`discarded`/`completed` job "sets a job as `available`,
**adding attempts if already maxed out**. Jobs currently `available` or `executing` are ignored"
[O1] — i.e. `max_attempts` is bumped just enough to permit another attempt, and the guard
refuses to retry work that isn't actually stuck. `retry_all_jobs` is the bulk twin; `cancel_job`
is the paired give-up (state `cancelled`; `discarded` = "failed all retry attempts") [O1].

### 2.7 Temporal — explicit, operator-chosen budget reset

- **Workflow reset** is the heavyweight verb: "A Reset terminates a Workflow Execution and
  creates a new Workflow Execution with the same Workflow Type and Workflow ID", copying event
  history "up to and including the reset point"; later events are not carried forward, though
  "Signals in the original history can be optionally copied to the new history" [T1][T2].
- **Activity-level recovery** is the closer analogue and is explicit about budgets:
  `temporal activity reset` "restarts the activity as if it were first being scheduled. That is,
  it will reset both the number of attempts and the activity timeout", with separate
  `--reset-heartbeats`; `pause`/`unpause` exist, and `unpause` takes `--reset-attempts` as an
  *option* [T3]. `update-options` can change the retry policy of a live activity incrementally
  [T3]. Fresh budget is a deliberate operator choice, expressed as flags — not an automatic
  consequence of retrying.

### 2.8 Enterprise Integration Patterns — two channels, two prognoses

Hohpe & Woolf split the space the house taxonomy already splits: the **Dead Letter Channel**
receives messages the system "cannot or should not deliver" [E1] (delivery/processing failure —
plausibly transient, worth redriving once the cause is fixed), while the **Invalid Message
Channel** receives "messages that could not be processed by their receivers" because they are
semantically improper — the guidance there is isolation and diagnosis by an error handler, not
retry [E2]. A redrive verb is a Dead-Letter-Channel verb; the give-up/archive verb is the act of
reclassifying a letter as Invalid-Message-Channel material.

### 2.9 Adjacent domains: OTP supervision and `systemctl reset-failed`

- **Erlang/OTP** bounds automatic restarts by intensity/period: "If more than `MaxR` number of
  restarts occur in the last `MaxT` seconds, the supervisor terminates all the child processes
  and then itself", escalating to the next supervisor, "to prevent a situation where a process
  repeatedly dies for the same reason, only to be restarted again" [ER1]. Exhaustion escalates
  *up a hierarchy* (which restarts the whole subtree with fresh counters) rather than parking
  for an operator; the doc's tuning guidance warns that multiplied intensities across levels
  produce excessive total restarts [ER1]. The house has no supervisor-of-supervisors; its
  escalation target *is* the operator — which is the systemd shape:
- **systemd** is the nearest analogue to an infra-level "clear the failure mark" verb. A unit
  that fails "will automatically enter the 'failed' state and its exit code and status is
  recorded for introspection by the administrator until the service is stopped/re-started or
  reset with this command" [SD1]. `systemctl reset-failed` does exactly and only the clearing:
  "Reset the 'failed' state of the specified units … In addition … it also resets various other
  per-unit properties: the start rate limit counter of all unit types is reset to zero, as is
  the restart counter of service units. Thus, if a unit's start limit … is hit and the unit
  refuses to be started again, use this command to make it startable again" [SD1]. Three
  properties worth copying: it is **not a domain operation** (no unit file changes, no history
  rewrite — the journal keeps the failure record); it **resets the whole rate-limit budget**
  (fresh episode, not one grudging attempt); and it is **separate from `start`** — clearing the
  mark and re-running the work are two verbs (the house proposal fuses them into one, which is a
  defensible convenience, not a conflict).

---

## 3. Synthesis: the five sub-questions across the field

### 3.1 Failure-again semantics

Nobody re-dead-letters a redriven item without at least one genuine processing attempt. Beyond
that the field splits cleanly on one axis — **how much budget a redrive grants**:

- **Fresh full budget (episode restart):** SQS (redriven message "considered new" [Q3], full
  `maxReceiveCount` again), systemd (`reset-failed` zeroes the rate-limit counters [SD1]),
  Temporal's `activity reset` ("as if it were first being scheduled" [T3]), and NServiceBus in
  effect (re-enters the endpoint queue and full recoverability [P2][P5, secondary]).
- **One additional attempt (budget preserved):** Sidekiq (`retry_count -= 1` then re-push
  [SK2]) and Oban ("adding attempts if already maxed out" [O1]) — the job-queue systems, where a
  hot loop of operator-retry → 25 automatic retries would be the worse failure mode.

What distinguishes the two camps is *where the automatic retry ladder lives*: systems whose
redrive re-enters the normal ladder (SQS, NServiceBus) grant the ladder; systems whose dead
items sit *past* the ladder (Sidekiq, Oban) grant a probe. Both camps keep an across-episode
trail: ServiceControl counts and displays failed retry attempts [P2]; Sidekiq's job payload
carries its retry state forward [SK2]; only SQS severs the linkage (new `messageID` [Q3]) — and
that is a limitation of its move-semantics, not a design ideal anyone else copied. Temporal
makes the budget question an explicit operator *option* (`--reset-attempts`) [T3].

### 3.2 Ledger disposition

The invariant everywhere: **the active worklist entry leaves the worklist on redrive** — SQS
deletes the message from the DLQ [Q3], Sidekiq's `retry` runs inside `remove_job` [SK2],
ServicePulse hides the record from the failed list [P2]. What differs is whether a *history*
survives, and that tracks whether the system separates worklist from record: ServiceControl
retains the full record and merely re-labels it (retry-in-flight, failed-again with attempt
counts, soft-`Deleted` with restore) [P2][P3]; Kafka's DLQ-as-topic keeps every episode by
construction, since reprocessing moves an offset rather than deleting records [K1]; SQS and
Sidekiq destroy the ledger row and keep history only in whatever the payload/logs carry. The
systems with the best operator reputation (ServiceControl, Kafka) are the ones that treat
stall-episode history as operationally valuable; SQS's history-severing is a known cost of its
design. So: yes, episode history is valued in the field — but by the systems whose dead-letter
store *is* their database, not by those whose store is a transport queue.

### 3.3 Operator feedback

Uniformly **fire-and-forget at the dispatch level, with status legible afterwards** — no
surveyed system blocks the operator's request on the reprocessing outcome. SQS returns a
`TaskHandle` and exposes task status/cancellation [Q4][Q3]; ServicePulse shows group-retry
progress, then relies on audit/error ingestion to settle each message's fate, with the explicit
caveat that a completed retry request "means those messages may not have been processed yet"
[P1][P2]; Sidekiq just re-pushes and lets the tabs tell the story [SK1][SK3]. The field's
hard-won lesson is ServicePulse's **Pending Retries** view [P4]: pure fire-and-forget without an
acknowledgment loop breeds a limbo state ("requested but not completed") that eventually needs
its own surface, its own re-retry verb, its own mark-as-resolved verb, and a duplicate-
processing warning. Systems whose outcome signal is intrinsic (the item either reappears in the
dead list or doesn't) escape that machinery; systems that track requests as first-class
operations inherit it.

### 3.4 Granularity

The operator-UI systems all lead with **per-item**, and offer bulk as a second verb: ServicePulse
individual/selection retry "before deciding to retry several messages in a group", then group
retry [P1]; Sidekiq per-job plus `all/retry`, `all/delete`, `all/kill` routes [SK3]; Oban
`retry_job` plus `retry_all_jobs` [O1]. SQS is the inversion — bulk-only, no per-message
selection, no filtering [Q3] — and it is the transport-level outlier, not the pattern. Bulk is
considered essential at queue scale (thousands of letters from one bug); its cost is one loop
over the per-item verb, which is why every system that has per-item also has all.

### 3.5 The give-up verb

**Universally paired with retry, never absent** in the operator-facing systems: ServicePulse
archive (soft, restorable, retention-pruned [P3]) and mark-as-resolved for pending retries
[P4]; Sidekiq `delete` (hard discard) *and* `kill` (demote from retry set to morgue, firing
death handlers [SK2][SK3]); Oban `cancel_job` (`cancelled` as a distinct terminal state from
`discarded` [O1]); EIP frames it as reclassification from dead-letter (retryable) to
invalid-message (diagnose, don't retry) [E1][E2]. Guards observed in the field: soft-delete with
a restore tab rather than hard delete (ServicePulse [P3]); duplicate-processing warnings before
resolving/retrying pending work [P4]; Sidekiq's morgue auto-prunes on age/size so even
un-actioned letters don't accumulate forever [SK1] (the house `prune` horizon is the same
mechanism, `dead-letter-port.ts:27-28`).

---

## 4. Collisions with the house constitution

- **Redrive as an infra verb, no domain event — attested, with one caveat.** systemd's
  `reset-failed` [SD1], SQS's move task [Q3], and ServiceControl's whole operation model
  [P1-P4] all live entirely outside business data; the failure mark and its clearing are
  operational state, exactly matching the house's deliberate choice of a ledger-derived (not
  event-derived) stalled flag. The one system that *does* touch history — Temporal reset
  terminates the execution and truncates its event history into a new run [T1] — is mutating an
  **orchestration journal**, not business truth (the same distinction
  `nonblocking-external-work-observation.md` §2.3 drew for Temporal's timer events). Ported
  naively to this codebase it would violate "events are never edited or deleted"
  (`event-sourcing.md`); it must be reported as conflicting prior art, and the house's
  no-domain-event leaning is the correct filter for it.
- **Re-dispatch derived from current state through the normal path — attested.** ServiceControl
  re-sends through the endpoint's ordinary processing [P2]; SQS re-enqueues to the source queue
  [Q3]; the house's own startup re-drive already is this operation minus the stalled-skip
  (`reactor.ts:188-196`). No surveyed system has a special "redrive execution mode" — the whole
  point is re-entering the normal machinery, which for this codebase also means duplicate
  settlement is absorbed by `decide` ("idempotency for free", `event-sourcing.md`).
- **At-least-once + duplicates.** ServicePulse's "Do not retry a message if it has been
  processed by the endpoint" [P4] is the field naming the hazard the house has already absorbed
  structurally: a redriven effect whose previous execution actually succeeded settles as a stale
  command through `decide`. The house is *stronger* here than ServicePulse, which must warn the
  operator instead.
- **Errors are values.** The dead-letter row is the reactor handling an exhausted infra fault "at
  the boundary that can actually make a decision" (`error-handling.md`) — and the redrive verb
  is that boundary deciding again, with human input. Nothing surveyed conflicts.
- **A house-specific wrinkle no surveyed system has:** in queue systems, deleting the letter *is*
  giving up, because the queue entry is the only carrier of the work's intent (Sidekiq `delete`
  discards the job [SK3]; SQS purge/expiry drops the message [Q1]). Here the intent lives in the
  event stream: clearing a stream's letters without redriving does not abandon anything — the
  stream still folds to a state that derives a pending effect, and the *next boot's* re-drive
  pass (which only skips streams while they are stalled, `reactor.ts:221`) would dispatch it
  anyway. An infra-only "dismiss/mark-resolved" verb therefore cannot express give-up in this
  architecture; it is merely a deferred redrive. Giving up on the work is a domain decision, and
  the domain already owns the verb for it (cancellation). This is a genuine divergence from the
  field's pairing, driven by event sourcing, not an omission.

---

## 5. Verdict — applied to the live decision

**Sub-question 1 — failure-again.** The field splits on budget (fresh full ladder: SQS, systemd,
Temporal-reset, NServiceBus [Q3][SD1][T3][P2]; single probe attempt: Sidekiq, Oban [SK2][O1]),
but converges on: at least one real attempt, re-dead-letter through the *same* machinery on
failure, and keep an across-episode trail. The house leaning — re-dispatch through the normal
dispatch path — lands it in the fresh-full-budget camp (the redriven effect gets the ordinary
park/backoff/exhaustion ladder and re-dead-letters at its end), which is the majority position
and the systemd/Temporal position specifically. Attested. The one refinement the field suggests:
ServiceControl counts and displays failed retry attempts across episodes [P2]; if runaway
redrive ever matters (scripted redrive against a permanently broken stream), an episode count is
the field's answer — surfaced, not enforced.

**Sub-question 2 — ledger disposition.** Split, and the split is explainable: transport-store
systems delete (SQS [Q3], Sidekiq [SK2]); database-store systems retain and re-label
(ServiceControl [P2][P3], Kafka-by-construction [K1]) — and the database-store systems clearly
treat episode history as operationally valuable. The house store is a database, but the house
leaning (delete via the existing `clearStream`) is also the *existing* semantics of
success-driven resolution (`reactor.ts:296-300`) and keeps one meaning for "letters exist ⇔
stream is stalled". Attested either way; the honest middle from the field: delete from the
worklist, but don't let the error text vanish into nothing at the moment of redrive — a
structured log line (letters count + errors) at redrive time, or a retained-but-resolved row, is
the ServiceControl lesson at SQLite scale. Do not adopt Temporal-style history mutation, and do
not mint a domain event for it (§4).

**Sub-question 3 — operator feedback.** Convergence: accept the request, return, and let an
existing status surface tell the story; no system blocks on the reprocessing outcome (a
redriven effect can legitimately take its whole retry ladder to settle). The house leaning is
compatible and the house already owns the status surface: the stalled flag clears on redrive,
the acquisition's history narration shows subsequent motion, and re-stalling re-appears in the
ledger-seeded read model. The ServicePulse lesson to heed [P4]: the window between "redrive
accepted" and "settled or re-stalled" should be legible (in-flight/parked already renders in the
UI's own language) — but the house does *not* need a pending-retries subsystem, because its
outcome signal is intrinsic (the stalled flag either stays cleared or returns), which is exactly
the property that let Sidekiq skip that machinery too.

**Sub-question 4 — granularity.** Convergence among operator-UI systems: per-item first, bulk as
a trivially-added second verb [P1][SK3][O1]; only the transport-level SQS is bulk-only [Q3]. The
house's per-stream leaning is attested and is the right first verb; a "redrive all stalled"
button is one loop over it and worth having (whole-fleet recovery after an infra fix — the
dominant real redrive scenario in ServiceControl's grouping model [P1]), but it is not essential
at a scale of single-digit stalled acquisitions.

**Sub-question 5 — give-up verb.** The field pairs retry with an explicit discard/archive
everywhere it has an operator surface (archive/restore [P3], delete/kill [SK3], cancel [O1],
mark-resolved [P4]), usually soft-deleted and retention-pruned. The house diverges *correctly*:
an infra-level dismiss cannot express abandonment here, because intent lives in the event stream
and the next boot re-derives the pending effect once the stalled skip is cleared (§4). The
give-up half of the pair already exists as the domain's cancellation verb; the OpenSpec proposal
should say so explicitly (the stalled UI offering both "redrive" and "cancel the acquisition" is
the field's pairing, correctly altitude-split), rather than inventing a letters-dismissal verb
that would silently behave as a deferred redrive.

**Pitfall checklist for the OpenSpec proposal:**

1. **Guard the verb's precondition.** Redrive only a stream that is actually stalled; reject or
   no-op otherwise (Oban ignores `available`/`executing` jobs [O1]; SQS allows one active move
   task per queue [Q4]). Concurrent/double redrive requests must be idempotent.
2. **Run it on the dispatch mutex.** The startup re-drive already runs under the mutex to avoid
   "a check-then-act re-attach hazard" (`reactor.ts:193-195`); the operator verb is the same
   operation and needs the same seat.
3. **No special execution mode.** Failure-again must flow through the ordinary
   park → backoff → exhaust → dead-letter ladder and land as a fresh letter set — no one-shot
   probe unless deliberately chosen against the majority pattern (§5.1).
4. **Clear ledger + in-memory stalled mark through one seam** (the existing `clearStalled`
   path), so the boot-seeded read model can never disagree with the table.
5. **Don't destroy the trail silently.** At minimum, log the cleared letters (count, errors,
   ages) at the moment of redrive; decide consciously whether an episode counter is wanted
   (ServiceControl precedent [P2]).
6. **Duplicate-settlement honesty.** The redriven effect may duplicate work whose earlier
   execution partially succeeded; the proposal should name `decide`'s stale-command absorption
   as the mechanism (not an operator warning à la ServicePulse [P4]) and test that path.
7. **No payload/state editing in the verb.** SQS explicitly refuses "filtering and modifying
   messages while redriving" [Q3]; the house verb re-derives the effect from folded state and
   takes no arguments beyond the stream.
8. **Fire-and-forget response shape.** Return accepted; feedback is the stalled flag + history
   surface. Do not await settlement in the HTTP handler (the ladder can take minutes by
   design).
9. **Pair it on the UI, not in the ledger.** The stalled surface should offer redrive alongside
   the existing domain cancellation; no infra "dismiss" verb (§4, §5.5).
10. **Additive contract only.** The admin surface's new verb and any status fields must be
    additive on the BFF contract, per the no-breaking-change rule (CLAUDE.md), and the verb
    belongs in the web register's verb inventory like every other action telling.

---

## 6. Citations

**This repository** (checkout `/home/jake/Projects/music-downloader-2`, branch state at research
time):

- `packages/downloader/src/application/ports/dead-letter-port.ts:4-29`
- `packages/downloader/src/application/acquisition/reactor.ts:188-196, 221, 296-300`
- `docs/development/event-sourcing.md`, `docs/development/error-handling.md`, `CLAUDE.md`
- [`docs/research/nonblocking-external-work-observation.md`](nonblocking-external-work-observation.md) — supervisor/delivery-loop prior art, Temporal journal-vs-business-truth distinction (§2.3)

**AWS SQS (developer guide + API reference):**

- [Q1] Using dead-letter queues in Amazon SQS — redrive policy, `maxReceiveCount`, retention
  best practice: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>
- [Q2] Configure a dead-letter queue (console) — maximum receives 1-1000:
  <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue.html>
- [Q3] Configure a dead-letter queue redrive — move semantics, "considered new messages",
  retention reset, velocity, no filtering/modifying, 36 h/100-task limits, cancel behavior,
  minimum IAM (Receive+Delete on DLQ, Send on destination):
  <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html>
- [Q4] `StartMessageMoveTask` API — asynchronous task, `TaskHandle`, DLQ-source-only, default
  destination = original source, `MaxNumberOfMessagesPerSecond` ≤ 500, one active task per
  queue: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html>

**Particular Software (NServiceBus / ServiceControl / ServicePulse):**

- [P1] Failed Message Monitoring — per-message/selection/group retry, grouping keys, group
  progress, "may not have been processed yet":
  <https://docs.particular.net/servicepulse/intro-failed-messages>
- [P2] Retrying failed messages — hidden while sent-for-retry, reappears on failure, retry
  attempts tracked and shown:
  <https://docs.particular.net/servicepulse/intro-failed-message-retries>
- [P3] Archived (deleted) messages — soft `Deleted` mark, restore tab, retention-scheduled
  removal: <https://docs.particular.net/servicepulse/intro-archived-messages>
- [P4] Pending Retries — the fire-and-forget limbo state, retry-again / mark-as-resolved,
  duplicate-processing warning:
  <https://docs.particular.net/servicepulse/intro-pending-retries>
- [P5] NServiceBus Recoverability — immediate/delayed retries, move to error queue with
  exception details: <https://docs.particular.net/nservicebus/recoverability/>
- Note: `docs.particular.net/servicecontrol/errors` returned 404 at research time (content
  reorganized into the ServicePulse pages above); the claim that a ServiceControl-retried
  message passes through full endpoint recoverability again is marked [secondary] in §2.2.

**MassTransit:**

- [M1] Exceptions — `_error` queues, fault headers, broker-tool extraction/resend, pointer to
  Particular's platform: <https://masstransit.io/documentation/concepts/exceptions> (redirects
  to masstransit.massient.com; fetched there)

**Kafka / Confluent:**

- [K1] Robin Moffatt, *Kafka Connect Deep Dive — Error Handling and Dead Letter Queues*
  (Confluent blog) — `errors.tolerance`, DLQ topic + context headers, chained-connector
  reprocessing, retention-based (non-deleting) disposition:
  <https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/>

**Sidekiq (Mike Perham's wiki + source, main branch @ 2026-08-05):**

- [SK1] Error Handling wiki — 25 retries/backoff formula, Dead set ("holding pen"), 10,000
  jobs / 6 months cap, `retry: false` discarded, `:kill`/`:discard` outcomes, Web UI tabs:
  <https://github.com/sidekiq/sidekiq/wiki/Error-Handling>
- [SK2] `lib/sidekiq/api.rb` — `SortedEntry#retry` (`retry_count -= 1` + re-push),
  `SortedEntry#kill`, `DeadSet#kill` (death handlers), `DeadSet#trim`:
  <https://github.com/sidekiq/sidekiq/blob/main/lib/sidekiq/api.rb>
- [SK3] `lib/sidekiq/web/application.rb` — morgue/retries routes: per-key and selected-set
  `retry_or_delete_or_kill`, `/morgue/all/retry` (`DeadSet#retry_all`), `/morgue/all/delete`
  (`DeadSet#clear`), `/retries/all/kill`:
  <https://github.com/sidekiq/sidekiq/blob/main/lib/sidekiq/web/application.rb>

**Oban:**

- [O1] `Oban.retry_job` / `retry_all_jobs` / `cancel_job` — "adding attempts if already maxed
  out", `available`/`executing` ignored, `cancelled` vs `discarded`:
  <https://hexdocs.pm/oban/Oban.html>

**Temporal:**

- [T1] Workflow Execution reset — terminates and re-creates with truncated history, optional
  signal re-application: <https://docs.temporal.io/workflow-execution/event#reset>
- [T2] `temporal workflow reset` CLI — reset points, batch reset types:
  <https://docs.temporal.io/cli/workflow>
- [T3] `temporal activity` CLI — `reset` ("as if it were first being scheduled", resets
  attempts + timeout), `pause`/`unpause --reset-attempts`, `update-options`:
  <https://docs.temporal.io/cli/activity>

**Enterprise Integration Patterns (Hohpe & Woolf):**

- [E1] Dead Letter Channel: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html>
- [E2] Invalid Message Channel: <https://www.enterpriseintegrationpatterns.com/patterns/messaging/InvalidMessageChannel.html>

**Erlang/OTP:**

- [ER1] Supervisor behaviour — restart intensity/period, self-termination and escalation,
  rationale: <https://www.erlang.org/doc/system/sup_princ.html>

**systemd:**

- [SD1] `systemctl(1)` — `reset-failed`: failed-state semantics, start rate limit counter and
  service restart counter reset, "make it startable again":
  <https://man7.org/linux/man-pages/man1/systemctl.1.html> (freedesktop.org canonical page
  returned HTTP 403 at research time; man7.org mirrors the same man page)

---

*These findings are research input to a decision, not normative policy. Nothing here changes the
constitution or any spec until adopted through an OpenSpec change.*
