import { describe, expect, it } from 'vitest';
import { CONTEXT_NAME, continueFrom, newOperation, operationScope } from './context.js';
import { fixedCorrelation, STORY, OTHER_STORY } from '../__fixtures__/correlation.js';
import { createLogger } from '../logging/logger.js';
import type { DestinationStream } from 'pino';

/**
 * The mechanism — mint, adopt, the causation parser, the degrade rules — belongs to
 * `@music/eventing` and is tested there. What this module adds is the BINDING: which store its
 * derived coordinates address, and this module's own logger type carried through a scope. Only
 * those two facts are asserted here.
 */

const triggeringEvent = (correlationId?: string) => ({
  streamId: 'acq-1',
  version: 3,
  metadata: correlationId === undefined ? {} : { correlationId },
});

function collecting(): { stream: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  return { lines, stream: { write: (chunk: string) => void lines.push(chunk) } };
}

describe("this module's correlation binding", () => {
  it('namespaces a derived causation with this context, not the other one', () => {
    // A reference whose context is not this one names a row in a DIFFERENT database; the namespace
    // is the only thing standing between a future resolver and the wrong store.
    const { context } = continueFrom(triggeringEvent(STORY), fixedCorrelation(OTHER_STORY));

    expect(CONTEXT_NAME).toBe('downloader');
    expect(context.causation).toEqual({
      kind: 'event',
      context: 'downloader',
      streamId: 'acq-1',
      version: 3,
    });
  });

  it('still degrades a story it cannot use, through the shared rule', () => {
    // One case is enough to prove the binding really delegates; the full matrix lives in eventing.
    const { context, origin } = continueFrom(triggeringEvent(), fixedCorrelation(OTHER_STORY));

    expect(origin).toBe('absent');
    expect(context.correlationId).toBe(OTHER_STORY);
  });

  it('binds the story onto this module’s own logger type', () => {
    const { stream, lines } = collecting();
    const logger = createLogger({ level: 'info', destination: stream });
    const context = newOperation(fixedCorrelation(STORY, 'command-1'));

    const scope = operationScope(context, logger, { acquisitionId: 'acq-1' });
    scope.logger.info('working');

    expect(lines.join('')).toContain(STORY);
    expect(lines.join('')).toContain('acq-1');
  });
});
