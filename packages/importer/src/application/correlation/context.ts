import type { Logger } from '../logging/logger.js';
import type { CorrelationSource } from '../ports/system-ports.js';
import { isCorrelationId, toCorrelationId } from './correlation-id.js';
import type { CorrelationId } from './correlation-id.js';

/**
 * The operation-correlation identity pair (change: end-to-end-correlation).
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
 */

/** This module's namespace in a causation reference — see {@link CausationReference}. */
export const CONTEXT_NAME = 'importer';

/**
 * The immediate parent of a unit of work. Two shapes, because parents come in two kinds: a fresh
 * command issued at an outermost trigger, and a stored event that a reactor (or a cross-context
 * consumer) is reacting to. The event form uses STORE COORDINATES rather than a per-event uuid —
 * the Eventide precedent — so it needs no new identity column and stays replay-stable.
 *
 * `context` namespaces those coordinates by the STORE THEY ADDRESS, which is the whole point once
 * a reference can arrive from the other side of the seam: a reference whose `context` is not
 * {@link CONTEXT_NAME} names a row in a DIFFERENT database and must never be resolved against this
 * one. Nothing resolves a causation reference today; this note exists so the first thing that does
 * checks the context first.
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
 * Explicit passing over ambient AsyncLocalStorage is deliberate — this codebase injects every
 * other ambient capability, and an explicit parameter is the thing the compiler can check.
 */
export interface CommandContext {
  readonly correlationId: CorrelationId;
  readonly causation: CausationReference;
}

/**
 * A causation reference to a stored event at `streamId@version` in the named context's store. See
 * {@link CausationReference} on why `context` is load-bearing rather than decoration.
 */
export function causedBy(context: string, streamId: string, version: number): CausationReference {
  return { kind: 'event', context, streamId, version };
}

/**
 * Start a new story: the outermost-trigger mint. Every unit of work that begins without a parent —
 * an inbound request, a poll tick, the boot re-emit, an operator action — starts here.
 *
 * The command id comes from the same source as the story. It is opaque, never leaves this store,
 * and is only ever compared for equality, so it needs no format of its own — but note it is
 * deliberately NOT an {@link CorrelationId}, and nothing may treat it as one.
 */
export function newOperation(source: CorrelationSource): CommandContext {
  return {
    correlationId: source.mint(),
    causation: { kind: 'command', commandId: source.mint() },
  };
}

/**
 * All a reactor hop needs of the event that triggered it. Declared here rather than importing
 * `StoredEvent` so this module stays a leaf the event-store port can depend on; `StoredEvent`
 * satisfies it structurally.
 *
 * It must come from THIS context's store: {@link continueFrom} namespaces the coordinates it
 * derives with {@link CONTEXT_NAME}. An event that arrived over the seam has its own path
 * (`contextForDelivery` at the inbound ACL) and must not be passed here.
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
 * Continue the story of a stored event: the reactor hop. The story is copied verbatim; causation
 * is rewritten to the triggering event's own coordinates.
 *
 * An event with no usable story gets a FRESH one rather than a fabricated link — history written
 * before this capability existed is permanently uncorrelated, and inventing provenance that never
 * happened is worse than a story that starts late. The caller is told which case it was so the two
 * can be logged differently; deriving that a second time at the call site is how the log line and
 * the behaviour drift apart.
 */
export function continueFrom(
  stored: TriggeringEvent,
  source: CorrelationSource,
): ContinuedOperation {
  const carried = stored.metadata.correlationId;
  const origin: StoryOrigin =
    carried === undefined ? 'absent' : isCorrelationId(carried) ? 'carried' : 'malformed';
  return {
    context: {
      correlationId: origin === 'carried' ? toCorrelationId(carried!) : source.mint(),
      causation: causedBy(CONTEXT_NAME, stored.streamId, stored.version),
    },
    origin,
  };
}

/**
 * A unit of work as the shell hands it to whatever performs it: the identity to carry, and a
 * logger already bound to that identity. Handing both together is what lets an effect log joinable
 * lines and issue follow-up commands on the same story without ever reading — or managing — a
 * correlation field itself.
 *
 * Build it with {@link operationScope}. The binding is the invariant that makes these two members
 * one type rather than two bolted together, and a hand-assembled pair can silently break it.
 */
export interface OperationScope {
  readonly context: CommandContext;
  readonly logger: Logger;
}

/**
 * The sanctioned way to open a scope: bind the story onto a child of `parent` and pair it with the
 * context it was bound from, so the two can never disagree. `bindings` adds the subject identity
 * the unit of work is about (stream, position).
 */
export function operationScope(
  context: CommandContext,
  parent: Logger,
  bindings: Record<string, unknown> = {},
): OperationScope {
  return {
    context,
    logger: parent.child({ correlationId: context.correlationId, ...bindings }),
  };
}

/**
 * Adopt a story minted in another context, under a causation reference to whatever carried it in.
 * The observability envelope crosses the seam untranslated on purpose: the anti-corruption layer
 * translates the MODEL, and re-minting here would defeat the single promise this capability
 * exists to keep — one id follows one operation through the whole system.
 */
/**
 * Parse a causation reference read back from the store. The column is JSON written by some past
 * version of this process, so the union's discriminant has proven NOTHING on the way back in —
 * unlike event payloads, metadata has no upcaster registry and no schema. Without this, the first
 * reader to write the obvious `if (m.causation?.kind === 'event') use(m.causation.streamId)` would
 * narrow on a tag TypeScript never checked and read `undefined` at runtime.
 *
 * Anything unrecognised becomes `undefined` — the same degradation an unusable story gets, for the
 * same reason: provenance we cannot read is absent provenance, and inventing one is worse.
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
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
    return undefined;
  return causedBy(context, streamId, version);
}

export function adoptStory(
  correlationId: CorrelationId,
  causation: CausationReference,
): CommandContext {
  return { correlationId, causation };
}

/**
 * Adopt a story a caller has already minted, or start a fresh one if it is unusable. The command
 * id is always fresh, so two commands of one story get distinct causations — causation is rewritten
 * per hop, correlation is not.
 *
 * Lives here rather than in each facade because it is correlation POLICY, and a wire-shaped
 * boundary is not where the degrade rule should be decided — a second interface (MCP, HTTP) would
 * otherwise copy it a third time. The caller is told which case it was so an unusable story from a
 * LIVE caller can be reported; unlike a pre-capability row, that one is actionable.
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

export { CORRELATION_ID_PATTERN, isCorrelationId, toCorrelationId } from './correlation-id.js';
export type { CorrelationId } from './correlation-id.js';
