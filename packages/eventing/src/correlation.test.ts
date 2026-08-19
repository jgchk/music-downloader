import { describe, expect, it } from 'vitest';
import {
  adoptOrMint,
  adoptStory,
  causedBy,
  createCorrelation,
  isCorrelationId,
  newOperation,
  operationScope,
  parseCausation,
  toCorrelationId,
} from './correlation.js';
import type { ChildLogger, CorrelationSource, TriggeringEvent } from './correlation.js';

/**
 * The minimum a logger must be for a scope: able to bear a child that is itself one. Written as a
 * self-referential alias rather than an empty extending interface, which lint reads (correctly) as
 * equivalent to its supertype.
 */
type TestLogger = ChildLogger<TestLogger>;

const source = (...values: readonly string[]): CorrelationSource => {
  let index = 0;
  return {
    mint: () => toCorrelationId(values[Math.min(index++, values.length - 1)]!),
  };
};

const STORY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '00112233445566778899aabbccddeeff';

const triggeringEvent = (metadata: { readonly correlationId?: string }): TriggeringEvent => ({
  streamId: 'stream-1',
  version: 3,
  metadata,
});

describe('isCorrelationId', () => {
  it('accepts a 32-character lowercase hex string', () => {
    expect(isCorrelationId(STORY)).toBe(true);
  });

  it.each([
    ['too short', 'a1b2c3'],
    ['too long', `${STORY}00`],
    ['uppercase hex', STORY.toUpperCase()],
    ['non-hex characters', 'z1b2c3d4e5f60718293a4b5c6d7e8f90'],
    ['a uuid with dashes', 'a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isCorrelationId(value)).toBe(false);
  });
});

describe('newOperation', () => {
  it('mints a fresh story and a command causation naming its own command', () => {
    const context = newOperation(source(STORY, 'command-1'));

    expect(context).toEqual({
      correlationId: STORY,
      causation: { kind: 'command', commandId: 'command-1' },
    });
  });

  it('mints a distinct story per unit of work', () => {
    const minter = source(STORY, 'command-1', OTHER, 'command-2');

    expect(newOperation(minter).correlationId).not.toBe(newOperation(minter).correlationId);
  });
});

describe('createCorrelation', () => {
  it('namespaces the causation it derives with the context name it was given', () => {
    // The ONE thing a consumer supplies: which store the coordinates address. A reference whose
    // context is not this one names a row in a DIFFERENT database and must never be resolved here.
    const { context } = createCorrelation('ctx-a').continueFrom(
      triggeringEvent({ correlationId: STORY }),
      source(OTHER),
    );

    expect(context.causation).toEqual({
      kind: 'event',
      context: 'ctx-a',
      streamId: 'stream-1',
      version: 3,
    });
  });

  it('gives two consumers their own namespace from the one module', () => {
    const first = createCorrelation('ctx-b').continueFrom(
      triggeringEvent({ correlationId: STORY }),
      source(OTHER),
    );
    const second = createCorrelation('ctx-a').continueFrom(
      triggeringEvent({ correlationId: STORY }),
      source(OTHER),
    );

    expect(first.context.causation).toMatchObject({ context: 'ctx-b' });
    expect(second.context.causation).toMatchObject({ context: 'ctx-a' });
  });

  it('exposes the context name it was built with', () => {
    expect(createCorrelation('ctx-a').contextName).toBe('ctx-a');
  });
});

describe('continueFrom', () => {
  const correlation = createCorrelation('ctx-a');

  it('copies the triggering event story verbatim and reports it as carried', () => {
    const { context, origin } = correlation.continueFrom(
      triggeringEvent({ correlationId: STORY }),
      source(OTHER, 'unused'),
    );

    expect(origin).toBe('carried');
    expect(context.correlationId).toBe(STORY);
  });

  it('mints a fresh story when the triggering event predates correlation metadata, reporting it as absent', () => {
    // `absent` and `malformed` are not interchangeable — a pre-capability row is permanent and
    // unactionable, an unusable one means a writer is emitting bad ids right now — and the caller
    // logs them at different levels off this field alone.
    const { context, origin } = correlation.continueFrom(triggeringEvent({}), source(OTHER));

    expect(origin).toBe('absent');
    expect(context.correlationId).toBe(OTHER);
  });

  it('mints a fresh story when the stored id is not well-formed, reporting it as malformed', () => {
    const { context, origin } = correlation.continueFrom(
      triggeringEvent({ correlationId: 'not-a-trace-id' }),
      source(OTHER),
    );

    expect(origin).toBe('malformed');
    expect(context.correlationId).toBe(OTHER);
  });
});

describe('adoptStory', () => {
  it('adopts a story minted elsewhere verbatim under the given causation', () => {
    const causation = causedBy('ctx-b', 'stream-9', 4);

    expect(adoptStory(toCorrelationId(STORY), causation)).toEqual({
      correlationId: STORY,
      causation: { kind: 'event', context: 'ctx-b', streamId: 'stream-9', version: 4 },
    });
  });
});

describe('parseCausation', () => {
  it('accepts a stored event reference', () => {
    expect(parseCausation({ kind: 'event', context: 'x', streamId: 's', version: 3 })).toEqual({
      kind: 'event',
      context: 'x',
      streamId: 's',
      version: 3,
    });
  });

  it('accepts version zero — the first event of a stream is a legitimate parent', () => {
    expect(parseCausation({ kind: 'event', context: 'x', streamId: 's', version: 0 })).toEqual({
      kind: 'event',
      context: 'x',
      streamId: 's',
      version: 0,
    });
  });

  it('accepts a stored command reference', () => {
    expect(parseCausation({ kind: 'command', commandId: 'c-1' })).toEqual({
      kind: 'command',
      commandId: 'c-1',
    });
  });

  it.each([
    ['a null', null],
    // The column is absent altogether on rows written before causation existed, so `undefined` is
    // the likeliest input of all — and the one a reader must be sure cannot fault the parse.
    ['an absent value', undefined],
    ['a primitive', 'event'],
    ['an unknown kind', { kind: 'saga', streamId: 's', version: 1 }],
    ['a missing kind', { context: 'x', streamId: 's', version: 1 }],
    ['an empty commandId', { kind: 'command', commandId: '' }],
    ['a missing streamId', { kind: 'event', context: 'x', version: 1 }],
    ['an empty context', { kind: 'event', context: '', streamId: 's', version: 1 }],
    ['an empty streamId', { kind: 'event', context: 'x', streamId: '', version: 1 }],
    ['a non-string streamId', { kind: 'event', context: 'x', streamId: 7, version: 1 }],
    ['a non-string context', { kind: 'event', context: 7, streamId: 's', version: 1 }],
    ['a non-string commandId', { kind: 'command', commandId: 7 }],
    ['a negative version', { kind: 'event', context: 'x', streamId: 's', version: -1 }],
    ['a fractional version', { kind: 'event', context: 'x', streamId: 's', version: 1.5 }],
    ['a stringly version', { kind: 'event', context: 'x', streamId: 's', version: '1' }],
  ])('drops %s rather than handing back a union nothing checked', (_label, value) => {
    // The column is JSON written by some past version of this process. A reader narrowing on
    // `kind` would otherwise read `undefined` off a shape TypeScript never verified.
    expect(parseCausation(value)).toBeUndefined();
  });
});

describe('adoptOrMint', () => {
  it('adopts a well-formed caller story and reports it as carried', () => {
    // The source can only mint OTHER, so adopting STORY and re-minting are distinguishable.
    const { context, origin } = adoptOrMint(STORY, source(OTHER));

    expect(origin).toBe('carried');
    expect(context.correlationId).toBe(STORY);
    expect(context.causation).toEqual({ kind: 'command', commandId: OTHER });
  });

  it('mints fresh for an unusable caller story and reports it as malformed', () => {
    // A live caller got it wrong — unlike a pre-capability row, that IS actionable.
    const { context, origin } = adoptOrMint('not-a-trace-id', source(OTHER));

    expect(origin).toBe('malformed');
    expect(context.correlationId).toBe(OTHER);
  });
});

describe('operationScope', () => {
  it('binds the story onto a child logger paired with the context it came from', () => {
    // The binding IS the invariant that makes these two members one type: a hand-assembled pair
    // can log one story while issuing commands on another.
    const bound: Record<string, unknown>[] = [];
    const parent: ChildLogger<TestLogger> & TestLogger = {
      child(bindings: Record<string, unknown>) {
        bound.push(bindings);
        return parent;
      },
    };
    const context = newOperation(source(STORY, 'command-1'));

    const scope = operationScope(context, parent, { streamId: 'stream-1' });

    expect(scope.context).toBe(context);
    expect(bound).toEqual([{ correlationId: STORY, streamId: 'stream-1' }]);
  });

  it('binds the story alone when the unit of work has no subject identity yet', () => {
    const bound: Record<string, unknown>[] = [];
    const parent: ChildLogger<TestLogger> & TestLogger = {
      child(bindings: Record<string, unknown>) {
        bound.push(bindings);
        return parent;
      },
    };

    operationScope(newOperation(source(STORY, 'command-1')), parent);

    expect(bound).toEqual([{ correlationId: STORY }]);
  });
});
