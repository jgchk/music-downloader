import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('builds a pino logger at the requested level', () => {
    const logger = createLogger('silent');
    expect(logger.level).toBe('silent');
  });

  it('redacts both modules’ credential and PII paths from the composed root', () => {
    // This is the ONLY logger production constructs — the module runtimes receive this root, so
    // their own createLogger defaults never apply to a shipped line. A root without the composed
    // redaction union ships credentials and peer usernames verbatim; this test goes through the
    // production logger, not a module-tier one.
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });

    logger.info(
      { username: 'peer-42', slskd: { apiKey: 'sk-secret' }, fileContents: 'blob' },
      'composed line',
    );
    logger.warn({ transfer: { username: 'peer-42' } }, 'nested peer field');

    expect(lines).toHaveLength(2);
    const joined = lines.join('');
    expect(joined).toContain('[REDACTED]');
    expect(joined).not.toContain('peer-42');
    expect(joined).not.toContain('sk-secret');
    expect(joined).not.toContain('blob');
  });
});
