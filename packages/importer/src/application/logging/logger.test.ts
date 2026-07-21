import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DestinationStream } from 'pino';
import { createLogger, DEFAULT_LOG_LEVEL } from './logger.js';

/** A pino destination that collects each emitted NDJSON line for assertions. */
function collectingDestination(): { stream: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string): void {
        lines.push(chunk);
      },
    },
  };
}

describe('createLogger', () => {
  let savedLevel: string | undefined;

  beforeEach(() => {
    savedLevel = process.env['LOG_LEVEL'];
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    if (savedLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = savedLevel;
    }
  });

  it('defaults to the info level when neither an option nor the env var is set', () => {
    const logger = createLogger();
    expect(logger.level).toBe(DEFAULT_LOG_LEVEL);
  });

  it('reads the level from the LOG_LEVEL env var', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const logger = createLogger();
    expect(logger.level).toBe('debug');
  });

  it('prefers an explicit level option over the env var', () => {
    process.env['LOG_LEVEL'] = 'warn';
    const logger = createLogger({ level: 'error' });
    expect(logger.level).toBe('error');
  });

  it('redacts the default credential paths from emitted lines', () => {
    const { stream, lines } = collectingDestination();
    const logger = createLogger({ destination: stream });

    logger.info({ slskd: { password: 'hunter2', apiKey: 'sk-secret' } }, 'connecting');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('sk-secret');
  });

  it('honours custom redaction paths', () => {
    const { stream, lines } = collectingDestination();
    const logger = createLogger({ destination: stream, redactPaths: ['secretField'] });

    logger.info({ secretField: 'do-not-leak' }, 'event');

    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('do-not-leak');
  });
});
