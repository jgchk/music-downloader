import type { Brand } from '../../domain/shared/brand.js';
import { branded } from '../../domain/shared/brand.js';
import type { Logger } from '../logging/logger.js';
import type { CorrelationSource } from '../ports/system-ports.js';

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
 * A story id: 32 lowercase hex characters, deliberately W3C-trace-id-compatible so a later
 * OpenTelemetry adoption can carry the same value as a trace id rather than mint a parallel one.
 * Branded so a bare string cannot be threaded in as one.
 */
export type CorrelationId = Brand<string, 'CorrelationId'>;

const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Whether `value` is a well-formed story id (the format any tolerant reader must check). */
export function isCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}

/**
 * Lift a string already proven to be a well-formed story id into the brand. Trusted: call it only
 * behind {@link isCorrelationId}, on a {@link CorrelationSource} mint, or on a value a boundary
 * schema has already validated against the same pattern.
 */
export function toCorrelationId(value: string): CorrelationId {
  return branded<CorrelationId>(value);
}

/**
 * The immediate parent of a unit of work. Two shapes, because parents come in two kinds: a fresh
 * command issued at an outermost trigger, and a stored event that a reactor (or a cross-context
 * consumer) is reacting to. The event form uses STORE COORDINATES rather than a per-event uuid —
 * the Eventide precedent — so it needs no new identity column and stays replay-stable. `context`
 * namespaces those coordinates by the store they address, so a downloader `acq-1@3` and an
 * importer `imp-1@3` can never be confused once a reference crosses the seam.
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

/** A causation reference to a stored event at `streamId@version` in the named context's store. */
export function causedBy(context: string, streamId: string, version: number): CausationReference {
  return { kind: 'event', context, streamId, version };
}

/**
 * Start a new story: the outermost-trigger mint. Every unit of work that begins without a parent —
 * an inbound request, a poll tick, the boot re-emit, an operator action — starts here.
 */
export function newOperation(source: CorrelationSource): CommandContext {
  return {
    correlationId: toCorrelationId(source.mint()),
    causation: { kind: 'command', commandId: source.mint() },
  };
}

/**
 * All a reactor hop needs of the event that triggered it. Declared here rather than importing
 * `StoredEvent` so this module stays a leaf the event-store port can depend on; `StoredEvent`
 * satisfies it structurally.
 */
export interface TriggeringEvent {
  readonly streamId: string;
  readonly version: number;
  readonly metadata: { readonly correlationId?: string };
}

/**
 * Continue the story of a stored event: the reactor hop. The story is copied verbatim; causation
 * is rewritten to the triggering event's own coordinates.
 *
 * An event whose metadata carries no usable story id gets a FRESH one rather than a fabricated
 * link — history written before this capability existed is permanently uncorrelated, and inventing
 * provenance that never happened is worse than a story that starts late.
 */
export function continueFrom(stored: TriggeringEvent, source: CorrelationSource): CommandContext {
  const carried = stored.metadata.correlationId;
  const isUsable = carried !== undefined && isCorrelationId(carried);
  return {
    correlationId: toCorrelationId(isUsable ? carried : source.mint()),
    causation: causedBy(CONTEXT_NAME, stored.streamId, stored.version),
  };
}

/**
 * A unit of work as the shell hands it to whatever performs it: the identity to carry, and a
 * logger already bound to that identity. Handing both together is what lets an effect log joinable
 * lines and issue follow-up commands on the same story without ever reading — or managing — a
 * correlation field itself.
 */
export interface OperationScope {
  readonly context: CommandContext;
  readonly logger: Logger;
}

/**
 * Adopt a story minted in another context, under a causation reference to whatever carried it in.
 * The observability envelope crosses the seam untranslated on purpose: the anti-corruption layer
 * translates the MODEL, and re-minting here would defeat the single promise this capability
 * exists to keep — one id follows one operation through the whole system.
 */
export function adoptStory(
  correlationId: CorrelationId,
  causation: CausationReference,
): CommandContext {
  return { correlationId, causation };
}
