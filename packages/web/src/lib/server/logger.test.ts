import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('builds a pino logger at the requested level', () => {
    const logger = createLogger('silent');
    expect(logger.level).toBe('silent');
  });
});
