## Context

`AcquisitionState` (`src/domain/acquisition/state.ts`) is the folded write-model of the decide/evolve/react decider (D2). It is one interface with a `phase: AcquisitionPhase` field and six optional fields (`request`, `policies`, `target`, `current`, `location`, plus always-present collections). Which fields are populated in which phase is documented only in comments and enforced only by `decide`'s runtime phase guards — so `decide` and `react` carry 14 non-null assertions, and TypeScript happily represents states like `Downloading` with no `current`.

The state type is fully encapsulated: only `state.ts`, `decide.ts`, `react.ts`, and `acquisition.ts` touch it; everything else sees `AcquisitionSnapshot` or `AcquisitionPhase` (both unchanged by this design). Blast radius is those four files plus tests.

The exploration also surfaced a staging leak (see Decision 5): `Cleanup` fires only on `CandidateRejected`, so import conflicts, cancellations, and even successful imports leave files or directories orphaned under the staging root.

Literature grounding (researched 2026-07-05): the discriminated-union state and the totality semantics below are the explicitly recommended practice of the decider pattern's authors — Chassaing's Decider posts/gists, Dudycz's event-driven.io articles and Emmett framework, Equinox's documentation, and the Greg Young school. Key sources:

- Dudycz, ["Should you throw an exception when rebuilding the state from events?"](https://event-driven.io/en/should_you_throw_exception_when_rebuilding_state_from_events/) — argues **ignore** head-on; throwing permanently bricks a stream because a compensating event can never be reached.
- Dudycz, ["Writing and testing business logic in F#"](https://event-driven.io/en/writing_and_testing_business_logic_in_fsharp/) — DU state with `| _ -> state` wildcard: "our business logic should guard us later on."
- Chassaing, [Functional Event Sourcing Decider](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider) + his implementation gists (`| _ -> state`).
- [Equinox DOCUMENTATION.md](https://github.com/jet/equinox/blob/master/DOCUMENTATION.md): a fold "should not throw Exceptions or log."
- Wlaschin, [Making illegal states unrepresentable](https://fsharpforfunandprofit.com/posts/designing-with-types-making-illegal-states-unrepresentable/).

## Goals / Non-Goals

**Goals:**

- Make invalid acquisition states unrepresentable: each phase variant carries exactly the fields valid in that phase.
- Delete all 14 state-related non-null assertions; `decide`'s existing guards narrow the union for free.
- Give `evolve` explicit, tested totality semantics for out-of-protocol events.
- Make terminal states honest (no stale in-flight payload) and use the variant payloads to fix the staging-cleanup gaps that are cleanly fixable today.
- Zero public-contract change: commands, events, `DomainError`, `Effect`, `AcquisitionPhase`, `AcquisitionSnapshot` shape, HTTP/MCP surfaces all untouched.

**Non-Goals:**

- Aborting in-flight slskd transfers on cancellation. Cancel-during-`Downloading` cleanup is racy without port-level transfer cancellation (slskd keeps writing into the staging dir after we `rm` it). This design leaves a deliberate seam (Decision 4) for that future change.
- Typing the event↔post-state correlation in `react` via conditional types / transition-table types (Decision 3 explains why not).
- Fat events / stateless `react` (fmodel-ts style). Noted as a possible long-term direction; not now.
- Persisted snapshots of folded state. We refold from events every time; if snapshotting is ever added, the union becomes a serialization contract and needs its own design.

## Decisions

### 1. One variant per phase, with shared payload bases

`AcquisitionState` becomes a union of 11 variants discriminated on `phase`, built from factored bases rather than 11 hand-rolled shapes:

```ts
/** History facts valid in every non-Empty phase. */
interface Progress {
  readonly rejected: readonly string[];
  readonly searchRounds: number;
  readonly attempts: number;
}
interface Requested extends Progress {
  readonly request: AcquisitionRequest;
  readonly policies: AcquisitionPolicies;
}
interface Targeted extends Requested {
  readonly target: Target;
}

export interface EmptyState { readonly phase: 'Empty' }
export interface PendingState extends Requested { readonly phase: 'Pending' }
export interface SearchingState extends Targeted { readonly phase: 'Searching' }
export interface SelectingState extends Targeted {
  readonly phase: 'Selecting';
  readonly working: readonly RankedCandidate[];
}
export interface DownloadingState extends Targeted {
  readonly phase: 'Downloading';
  readonly working: readonly RankedCandidate[];
  readonly current: Candidate;
}
export interface ValidatingState extends Targeted {
  readonly phase: 'Validating';
  readonly working: readonly RankedCandidate[];
  readonly current: Candidate;
  readonly downloadedFiles: readonly DownloadedFile[];
}
export interface ImportingState extends Targeted { /* same payload as Validating */ ... }
// Terminal:
export interface FulfilledState extends Progress { readonly phase: 'Fulfilled'; readonly location: string }
export interface ConflictedState extends Progress {
  readonly phase: 'Conflicted';
  readonly location: string;
  readonly current: Candidate; // always reachable from Importing — non-optional
}
export interface ExhaustedState extends Progress { readonly phase: 'Exhausted' }
export interface CancelledState extends Progress {
  readonly phase: 'Cancelled';
  readonly current?: Candidate; // present iff cancelled from Validating/Importing (Decision 4)
}
export interface MetadataFailedState extends Requested { readonly phase: 'MetadataFailed' }

export type AcquisitionState = EmptyState | PendingState | ... ;
```

Rationale: this is exactly the pattern exhibited by Chassaing/Dudycz/Emmett; shared bases are the attested mitigation for variant count (cf. nordfjord's Equinox sample sharing one payload record across tags). `Validating`/`Importing` keep distinct variants even though payloads match — grouping would re-blur the phase distinctions this change exists to sharpen. `working` is kept on `Downloading`–`Importing` because `selectNext` consults it after a rejection.

The `phase` field keeps the existing `AcquisitionPhase` values, so the public phase type is untouched (it stays exported; the union's discriminant simply references it).

**Alternative considered:** grouped variants (one `InFlight` variant with `current?`) — rejected; it reintroduces the optionality we're removing.

**A warning from the literature we adopt:** resist compressing `evolve`'s per-phase arms with clever generics. Trivial, verbose arms are the point (Chassaing: evolve "should be extremely simple").

### 2. `evolve` totality: ignore out-of-protocol events

Each `evolve` case narrows to the event's legal source phase(s) and returns `state` unchanged otherwise:

```ts
case 'TargetResolved':
  if (state.phase !== 'Pending') return state; // out-of-protocol: ignore (see design.md D2)
  return { ...state, phase: 'Searching', target: event.target };
```

Rationale (the researched consensus, unanimous among argued positions):

- **Recoverability** (Dudycz's strongest argument): a throwing fold permanently bricks the stream — the compensating event that would heal it can never take effect because replay dies first. Ignoring keeps the stream foldable.
- **Errors-as-values fit:** `evolve` returning `Result` is *not* the errors-as-values answer — no mid-fold caller can meaningfully handle the error. Totality is the errors-as-values design for folds.
- **Safety is preserved by construction:** an ignored event leaves the state in its prior phase, so the very next command hits `decide`'s phase guards and returns a typed `IllegalTransition`. Validation after folding, in the business logic — exactly where Dudycz says it belongs.

**Alternatives considered:**

- *Throw* — violates the no-throw domain rule and recoverability; minority position attested only in code samples, argued against by the literature.
- *`Corrupted` pseudo-phase* — unattested anywhere in the decider literature; costs a new variant, a blanket `decide` rejection path, and public `DomainError` growth, to buy only diagnosability — which belongs in the application layer (a load-time integrity check may log; the domain may not). Not adopted; noted as a possible future application-layer addition.
- *Log-and-ignore* — the fold may not log (domain purity; Equinox agrees).

Scope note: this covers genuinely corrupt/hand-edited histories only. Legacy event-schema drift is a codec problem (upcasters at deserialization, cf. FsCodec/Marten), not an `evolve` problem — `evolve` only ever sees current event shapes.

### 3. `react`: runtime narrowing on post-state with a no-op fallback

`react(event, postState)` keeps its event-keyed switch; cases that need state payload narrow on `postState.phase` and return `[]` on mismatch:

```ts
case 'SearchRequested':
  return state.phase === 'Searching'
    ? [{ type: 'Search', target: state.target, round: event.round }]
    : [];
```

The guarantee "after `DownloadCompleted` the state is `Validating`" exists only by construction (`state = evolve(prev, event)`); no decider implementation in the surveyed literature expresses it in types. Chassaing's canonical decider has no `react` at all; fmodel-ts makes its saga stateless (data rides on events). A conditional-type `PostPhase<E>` encoding exists in the TS FSM literature but would mean hand-maintaining the transition table twice with no compiler check they agree — adopt only if `evolve` is ever *derived* from a single transition table.

The `[]` fallbacks are consistent with Decision 2's semantics (a mismatched pair yields no effects) and are directly testable, satisfying the coverage gate with meaningful tests rather than ignore-pragmas.

### 4. Terminal variant payloads, and what `Cancelled` deliberately forgets

- `Conflicted.current: Candidate` — non-optional; `ImportConflicted` is only reachable from `Importing`. Enables conflict cleanup (Decision 5) with zero event-schema change.
- `Cancelled.current?: Candidate` — populated by `evolve` **only when cancelling from `Validating` or `Importing`** (transfer settled, staged files known and stable). Cancelling from `Downloading` drops `current`: an in-flight slskd transfer keeps writing after any `rm`, so firing cleanup there is a lie — the racy case is deliberately excluded and the absent-`current` variant is the seam where a future download-abort change plugs in. Cancelling from earlier phases has no `current` to begin with, so the optionality is honest domain truth, not incidental modeling.
- `Fulfilled`/`Exhausted` carry no candidate/working payload. Consequence: `AcquisitionSnapshot.currentCandidate` (derived via `state.current`) is absent on terminal states, where today spreading leaks a stale in-flight candidate into cancelled/conflicted snapshots. This is a small observable read-model change — from misleading to truthful — and no consumer depends on the stale value.
- `Imported` becomes a state no-op in `evolve`: `AcquisitionFulfilled` (always co-emitted by `decide` in the same batch, and the only reader path) carries `location`, so `Importing` needs no `location?` field. `react` still handles `Imported` (Decision 5).

### 5. Staging cleanup via the new variants

`react` gains three `Cleanup` emissions, all enabled by Decision 4's payloads and requiring **no** port, adapter, event, or command changes (`Cleanup` effect and `LibraryPort.discardStaging` already exist):

| Event | Narrow | Effect |
| --- | --- | --- |
| `ImportConflicted` | post-state `Conflicted` | `Cleanup(state.current.identity)` — the downloaded release will never be imported |
| `AcquisitionCancelled` | post-state `Cancelled` **and** `current` present | `Cleanup(state.current.identity)` — settled staged files discarded |
| `Imported` | post-state `Importing` | `Cleanup(state.current.identity)` — removes the now-empty candidate staging dir after files moved to the library |

The `Imported` case is safe by ordering: the library adapter has already renamed/copied every file out of staging before `RecordImported` is applied, and `discardStaging` is a forced recursive `rm` (idempotent on an empty or missing dir). Reactor at-least-once redelivery of any of these events re-fires `Cleanup` harmlessly for the same reason.

### 6. Testing strategy for the fold's totality (coverage gate)

One **table-driven cartesian test**: every `AcquisitionEvent` type applied to every non-matching phase variant, asserting `evolve` returns the input state **identically** (same reference or deep-equal). This single parameterized test covers all ignore-fallback branches for the 100% gate *and* doubles as the totality property. `react`'s `[]` fallbacks get the same treatment (event × mismatched post-state ⇒ no effects). Existing decider given/when/then tests continue to cover the happy paths unchanged — per the standing `acquisition-aggregate` spec, all existing decider and e2e assertions must hold.

## Risks / Trade-offs

- **[Silently tolerated corruption]** A genuinely corrupt history replays to a confident-looking prior-phase state instead of failing loudly. → Mitigation: `decide`'s guards reject the next command with a typed error (the literature's recommended safety net); diagnosability can later be added as an application-layer load-time integrity check (allowed to log) without touching the domain.
- **[`evolve` verbosity]** 11 variants × 17 events makes `evolve` longer and each case must construct a full variant rather than spread blindly. → Accepted deliberately; arms stay trivial, and the blind spread was exactly the bug surface (Frankenstates, stale terminal payload).
- **[Behavioral deltas, small but real]** Terminal snapshots stop reporting `currentCandidate`; `Imported` no longer sets `location` on intermediate state; conflicts/cancels now delete staged files that yesterday lingered. → Each is an intended fix, called out in specs; e2e suite must still pass unmodified per the aggregate spec.
- **[Cleanup redelivery]** At-least-once reactor delivery can re-fire `Cleanup`. → `discardStaging` is idempotent (`rm -rf` force); already true for the existing rejection path.
- **[Future snapshotting]** If folded-state persistence is ever introduced, the union's shape becomes a versioned contract. → Out of scope; flagged here so that change knows to treat snapshots as schema-bearing (cf. Equinox snapshots-as-events).

## Migration Plan

Pure refactor of private domain internals plus additive `react` behavior — no data migration, no API version bump, no event upcasting (event schemas unchanged). Existing persisted histories fold correctly under the new `evolve` because every event sequence `decide` has ever produced follows the protocol; the ignore-fallbacks are unreachable for legal histories by construction. Rollback is a revert.

## Open Questions

None — the exploration and literature research (2026-07-05) resolved all of them: totality semantics (ignore), variant granularity (one per phase), react typing (runtime narrowing), cleanup scope (conflict + settled cancel + post-import in; download-abort out).
