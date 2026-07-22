import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifiedFault } from './fault.js';

describe('classifiedFault', () => {
  it('marks a response-schema mismatch permanent — retrying cannot fix schema drift', () => {
    const parseFailure = z.object({ id: z.string() }).safeParse({ id: null }).error!;

    const fault = classifiedFault('musicbrainz.resolve', parseFailure);

    expect(fault.kind).toBe('InfraError');
    expect(fault.permanent).toBe(true);
    expect(fault.operation).toBe('musicbrainz.resolve');
  });

  it('leaves other causes transient — an unreachable upstream is worth retrying', () => {
    const fault = classifiedFault('slskd.download', new Error('fetch failed'));

    expect(fault.permanent).toBeUndefined();
    expect(fault.message).toContain('fetch failed');
  });
});
