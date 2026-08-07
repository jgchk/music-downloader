import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../ports/event-store-port.js';
import {
  CONTEXT_NAME,
  adoptOrMint,
  parseCausation,
  adoptStory,
  causedBy,
  continueFrom,
  isCorrelationId,
  newOperation,
  toCorrelationId,
} from './context.js';
import type { CorrelationSource } from '../ports/system-ports.js';

const source = (...values: readonly string[]): CorrelationSource => {
  let index = 0;
  return {
    mint: () => toCorrelationId(values[Math.min(index++, values.length - 1)]!),
  };
};

const STORY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '00112233445566778899aabbccddeeff';

const storedEvent = (metadata: StoredEvent['metadata']): StoredEvent =>
  ({
    globalSeq: 7,
    streamId: 'acq-1',
    version: 3,
    type: 'AcquisitionSubmitted',
    event: { type: 'AcquisitionSubmitted' },
    metadata,
  }) as unknown as StoredEvent;

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

describe('continueFrom', () => {
  it('copies the triggering event story verbatim and points causation at its coordinates', () => {
    const { context } = continueFrom(
      storedEvent({
        acquisitionId: 'acq-1',
        occurredAt: '2026-08-06T00:00:00.000Z',
        correlationId: STORY,
      }),
      source(OTHER, 'unused'),
    );

    expect(context).toEqual({
      correlationId: STORY,
      causation: { kind: 'event', context: CONTEXT_NAME, streamId: 'acq-1', version: 3 },
    });
  });

  it('mints a fresh story when the triggering event predates correlation metadata', () => {
    const { context } = continueFrom(
      storedEvent({ acquisitionId: 'acq-1', occurredAt: '2026-08-06T00:00:00.000Z' }),
      source(OTHER),
    );

    expect(context).toEqual({
      correlationId: OTHER,
      causation: { kind: 'event', context: CONTEXT_NAME, streamId: 'acq-1', version: 3 },
    });
  });

  it('mints a fresh story when the stored id is not a well-formed correlation id', () => {
    const { context } = continueFrom(
      storedEvent({
        acquisitionId: 'acq-1',
        occurredAt: '2026-08-06T00:00:00.000Z',
        correlationId: 'not-a-trace-id',
      }),
      source(OTHER),
    );

    expect(context.correlationId).toBe(OTHER);
  });
});

describe('adoptStory', () => {
  it('adopts a story minted elsewhere verbatim under the given causation', () => {
    const causation = causedBy('importer', 'imp-9', 4);

    expect(adoptStory(toCorrelationId(STORY), causation)).toEqual({
      correlationId: STORY,
      causation: { kind: 'event', context: 'importer', streamId: 'imp-9', version: 4 },
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
