import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../ports/event-store-port.js';
import {
  CONTEXT_NAME,
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
    mint: () => values[Math.min(index++, values.length - 1)]!,
  };
};

const STORY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '00112233445566778899aabbccddeeff';

const storedEvent = (metadata: StoredEvent['metadata']): StoredEvent =>
  ({
    globalSeq: 7,
    streamId: 'imp-1',
    version: 3,
    type: 'ImportSubmitted',
    event: { type: 'ImportSubmitted' },
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
    const context = continueFrom(
      storedEvent({
        importId: 'imp-1',
        occurredAt: '2026-08-06T00:00:00.000Z',
        correlationId: STORY,
      }),
      source(OTHER, 'unused'),
    );

    expect(context).toEqual({
      correlationId: STORY,
      causation: { kind: 'event', context: CONTEXT_NAME, streamId: 'imp-1', version: 3 },
    });
  });

  it('mints a fresh story when the triggering event predates correlation metadata', () => {
    const context = continueFrom(
      storedEvent({ importId: 'imp-1', occurredAt: '2026-08-06T00:00:00.000Z' }),
      source(OTHER),
    );

    expect(context).toEqual({
      correlationId: OTHER,
      causation: { kind: 'event', context: CONTEXT_NAME, streamId: 'imp-1', version: 3 },
    });
  });

  it('mints a fresh story when the stored id is not a well-formed correlation id', () => {
    const context = continueFrom(
      storedEvent({
        importId: 'imp-1',
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
    const causation = causedBy('downloader', 'acq-9', 4);

    expect(adoptStory(toCorrelationId(STORY), causation)).toEqual({
      correlationId: STORY,
      causation: { kind: 'event', context: 'downloader', streamId: 'acq-9', version: 4 },
    });
  });
});
