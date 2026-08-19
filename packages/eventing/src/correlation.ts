/**
 * The operation-correlation identity pair (change: end-to-end-correlation; extraction:
 * extract-eventing-package D5).
 *
 * **Terminology — fixed, and the one thing not to get wrong.** `correlationId` is the STORY: it is
 * minted exactly once at an operation's outermost trigger and copied verbatim through every
 * subsequent hop, so one id joins a whole conversation. `causation` is the IMMEDIATE PARENT: it is
 * rewritten at every hop. This is the Young/EventStoreDB naming. **Axon inverts it** — Axon's
 * `correlationId` is this file's causation and its `traceId` is this file's correlation — so a
 * reader arriving from Axon's docs will read every line here backwards. The research this design
 * adopts (`docs/research/correlation-causation-conventions.md` §2.3) documents the hazard; the
 * names in this codebase mean what this paragraph says and nothing else.
 *
 * The pair is **shell-only infrastructure**: deciders, `evolve`, and every other domain construct
 * are blind to it (pinned by the boundaries tier). It travels beside commands as a
 * {@link CommandContext} and lands in event metadata, never in an event payload.
 *
 * The id is an opaque observability identity, not anyone's model — which is why this module is
 * shared rather than duplicated per context, and why the only thing a consumer supplies is the
 * NAME of the store its coordinates address ({@link createCorrelation}).
 */

/**
 * A phantom brand — a compile-time-only tag that makes a validated value distinct from its raw
 * structural shape. The tag is a type-level fiction: it is erased at runtime, so a branded value
 * *is* its underlying value and JSON round-tripping is byte-identical to the unbranded shape.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

/** 32 lowercase hex — the W3C trace-id format, so a later OTel adoption can carry this value. */
export const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * A story id. Branded so a bare string — an aggregate id, a command id — cannot be threaded in
 * where a story belongs. The brand carries the FORMAT too, which is why the only unchecked lift
 * ({@link toCorrelationId}) is documented as trusted and why {@link CorrelationSource} mints this
 * type rather than a raw string.
 */
export type CorrelationId = Brand<string, 'CorrelationId'>;

/** Whether `value` is a well-formed story id (the check every tolerant reader must make). */
export function isCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}

/**
 * Lift a string already proven to be a well-formed story id into the brand. Trusted — the single
 * sanctioned cast. Call it only behind {@link isCorrelationId}, at the composition root's mint
 * where the format is literally visible, or on a value a boundary schema has validated against
 * {@link CORRELATION_ID_PATTERN}.
 */
export function toCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

/**
 * The minting capability, injected. It mints the BRANDED id, so the composition root's
 * implementation is the single place the format is established.
 */
export interface CorrelationSource {
  mint(): CorrelationId;
}

/**
 * The immediate parent of a unit of work. Two shapes, because parents come in two kinds: a fresh
 * command issued at an outermost trigger, and a stored event that a reactor (or a cross-context
 * consumer) is reacting to. The event form uses STORE COORDINATES rather than a per-event uuid —
 * the Eventide precedent — so it needs no new identity column and stays replay-stable.
 *
 * `context` namespaces those coordinates by the STORE THEY ADDRESS, which is the whole point once a
 * reference can arrive from the other side of a seam: a reference whose `context` is not the
 * reader's own names a row in a DIFFERENT database and must never be resolved against it. Nothing
 * resolves a causation reference today; this note exists so the first thing that does checks the
 * context first.
 */
export type CausationReference =
  | { readonly kind: 'command'; readonly commandId: string }
  | {
      readonly kind: 'event';
      readonly context: string;
      readonly streamId: string;
      readonly version: number;
    };

/**
 * The identity pair as it travels the application seam: passed explicitly alongside every command
 * (never inside the command object the domain sees), and written into event metadata at append.
 * Explicit passing over ambient AsyncLocalStorage is deliberate — this codebase injects every other
 * ambient capability, and an explicit parameter is the thing the compiler can check.
 */
export interface CommandContext {
  readonly correlationId: CorrelationId;
  readonly causation: CausationReference;
}

/** A causation reference to a stored event at `streamId@version` in the named context's store. */
export function causedBy(context: string, streamId: string, version: number): CausationReference {
  return { kind: 'event', context, streamId, version };
}

/**
 * Start a new story: the outermost-trigger mint. Every unit of work that begins without a parent —
 * an inbound request, a poll tick, the boot re-emit, an operator action — starts here.
 *
 * The command id comes from the same source as the story. It is opaque, never leaves its store, and
 * is only ever compared for equality, so it needs no format of its own — but note it is
 * deliberately NOT a {@link CorrelationId}, and nothing may treat it as one.
 */
export function newOperation(source: CorrelationSource): CommandContext {
  return {
    correlationId: source.mint(),
    causation: { kind: 'command', commandId: source.mint() },
  };
}

/**
 * All a reactor hop needs of the event that triggered it. Declared structurally so this module
 * stays a leaf that a consumer's event-store port can depend on; a stored event satisfies it.
 *
 * It must come from the CONSUMER'S OWN store: {@link Correlation.continueFrom} namespaces the
 * coordinates it derives with that consumer's context name. An event that arrived over a seam has
 * its own path ({@link adoptStory} at the inbound ACL) and must not be passed here.
 */
export interface TriggeringEvent {
  readonly streamId: string;
  readonly version: number;
  readonly metadata: { readonly correlationId?: string };
}

/**
 * Where a continued story came from. The three cases are NOT interchangeable, which is why callers
 * are handed the reason rather than left to re-derive it:
 *  - `carried` — the normal path.
 *  - `absent` — a row written before this capability existed. Permanent, expected, unactionable.
 *  - `malformed` — a row whose story is present but unusable. Every append since this capability
 *    shipped goes through a compiler-checked write gate, so this means a FIRST-PARTY INVARIANT HAS
 *    BEEN VIOLATED, and it deserves a louder level than `absent` ever should.
 */
export type StoryOrigin = 'carried' | 'absent' | 'malformed';

export interface ContinuedOperation {
  readonly context: CommandContext;
  readonly origin: StoryOrigin;
}

/**
 * A unit of work as the shell hands it to whatever performs it: the identity to carry, and a logger
 * already bound to that identity. Handing both together is what lets an effect log joinable lines
 * and issue follow-up commands on the same story without ever reading — or managing — a correlation
 * field itself.
 *
 * Generic in the logger so each consumer keeps its own logger type through the scope; this module
 * needs only that a logger can bear children.
 */
export interface ChildLogger<TSelf extends ChildLogger<TSelf>> {
  child(bindings: Record<string, unknown>): TSelf;
}

/**
 * What a scope's caller may add: the subject identity the unit of work is about (stream, position).
 * The story itself is not theirs to set — {@link operationScope} owns that key.
 */
export type SubjectBindings = Record<string, unknown> & { correlationId?: never };

export interface OperationScope<TLogger> {
  readonly context: CommandContext;
  readonly logger: TLogger;
}

/**
 * The sanctioned way to open a scope: bind the story onto a child of `parent` and pair it with the
 * context it was bound from, so the two can never disagree. `bindings` adds the subject identity
 * the unit of work is about (stream, position).
 */
export function operationScope<TLogger extends ChildLogger<TLogger>>(
  context: CommandContext,
  parent: TLogger,
  bindings: SubjectBindings = {},
): OperationScope<TLogger> {
  return {
    context,
    // The story is bound LAST. Spread first and a caller passing its own `correlationId` would get
    // a logger filed under a different story than the context it is handed beside — defeating the
    // one invariant that makes these two members a single type. `SubjectBindings` also says so in
    // the type, so the mistake does not compile.
    logger: parent.child({ ...bindings, correlationId: context.correlationId }),
  };
}

/**
 * Adopt a story minted in another context, under a causation reference to whatever carried it in.
 * The observability envelope crosses a seam untranslated on purpose: the anti-corruption layer
 * translates the MODEL, and re-minting here would defeat the single promise this capability exists
 * to keep — one id follows one operation through the whole system.
 */
export function adoptStory(
  correlationId: CorrelationId,
  causation: CausationReference,
): CommandContext {
  return { correlationId, causation };
}

/**
 * Adopt a story a caller has already minted, or start a fresh one if it is unusable. The command id
 * is always fresh, so two commands of one story get distinct causations — causation is rewritten
 * per hop, correlation is not.
 *
 * Lives here rather than in each facade because it is correlation POLICY, and a wire-shaped boundary
 * is not where the degrade rule should be decided. The caller is told which case it was so an
 * unusable story from a LIVE caller can be reported; unlike a pre-capability row, that one is
 * actionable.
 */
export function adoptOrMint(story: string, source: CorrelationSource): ContinuedOperation {
  const origin: StoryOrigin = isCorrelationId(story) ? 'carried' : 'malformed';
  return {
    context: {
      correlationId: origin === 'carried' ? toCorrelationId(story) : source.mint(),
      causation: { kind: 'command', commandId: source.mint() },
    },
    origin,
  };
}

/**
 * A store version: a non-negative safe integer. `Number.isSafeInteger` already rejects every
 * non-number, so a `typeof` guard beside it would be dead code that no test could ever kill.
 */
function isStreamVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Parse a causation reference read back from a store. The column is JSON written by some past
 * version of the process, so the union's discriminant has proven NOTHING on the way back in —
 * unlike event payloads, metadata has no upcaster registry and no schema. Without this, the first
 * reader to write the obvious `if (m.causation?.kind === 'event') use(m.causation.streamId)` would
 * narrow on a tag TypeScript never checked and read `undefined` at runtime.
 *
 * Anything unrecognised becomes `undefined`, because a reference we cannot read is no reference —
 * and inventing one is worse. Note this is NOT the same case as an absent story: `causation` is
 * mandatory on the write path, so a stored one that fails to parse means a first-party invariant has
 * been violated, exactly as a malformed `correlationId` does. Nothing resolves causation yet, so that
 * distinction has no consumer to report it to; the first reader to resolve a reference should take
 * it as an origin the way {@link Correlation.continueFrom} does.
 */
export function parseCausation(value: unknown): CausationReference | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'command') {
    return typeof candidate.commandId === 'string' && candidate.commandId !== ''
      ? { kind: 'command', commandId: candidate.commandId }
      : undefined;
  }
  if (candidate.kind !== 'event') return undefined;
  const { context, streamId, version } = candidate;
  if (typeof context !== 'string' || context === '') return undefined;
  if (typeof streamId !== 'string' || streamId === '') return undefined;
  if (!isStreamVersion(version)) return undefined;
  return causedBy(context, streamId, version);
}

/**
 * The one part of correlation that is consumer-specific: which store a derived causation addresses.
 * Everything else in this module is context-free and exported directly.
 */
export interface Correlation {
  /** The name this instance stamps onto the causation references it derives. */
  readonly contextName: string;
  /**
   * Continue the story of a stored event: the reactor hop. The story is copied verbatim; causation
   * is rewritten to the triggering event's own coordinates, namespaced by {@link contextName}.
   *
   * An event with no usable story gets a FRESH one rather than a fabricated link — history written
   * before this capability existed is permanently uncorrelated, and inventing provenance that never
   * happened is worse than a story that starts late. The caller is told which case it was so the two
   * can be logged differently; deriving that a second time at the call site is how the log line and
   * the behaviour drift apart.
   */
  continueFrom(stored: TriggeringEvent, source: CorrelationSource): ContinuedOperation;
}

export function createCorrelation(contextName: string): Correlation {
  return {
    contextName,
    continueFrom(stored, source) {
      const carried = stored.metadata.correlationId;
      const origin: StoryOrigin =
        carried === undefined ? 'absent' : isCorrelationId(carried) ? 'carried' : 'malformed';
      return {
        context: {
          // `carried` is non-undefined on the 'carried' arm by construction above; the compiler
          // cannot see that through the origin variable, and re-testing it here would add a branch
          // no test could ever kill.
          correlationId: origin === 'carried' ? toCorrelationId(carried!) : source.mint(),
          causation: causedBy(contextName, stored.streamId, stored.version),
        },
        origin,
      };
    },
  };
}
