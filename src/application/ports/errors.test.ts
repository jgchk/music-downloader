import { describe, expect, it } from 'vitest';
import { infraError } from './errors.js';

describe('infraError', () => {
  it('builds a tagged infrastructure error carrying the operation and cause', () => {
    const cause = new Error('ECONNREFUSED');
    expect(infraError('slskd.search', 'unreachable', cause)).toEqual({
      kind: 'InfraError',
      operation: 'slskd.search',
      message: 'unreachable',
      cause,
    });
  });

  it('omits the cause when none is given', () => {
    expect(infraError('ffprobe', 'missing binary').cause).toBeUndefined();
  });
});
