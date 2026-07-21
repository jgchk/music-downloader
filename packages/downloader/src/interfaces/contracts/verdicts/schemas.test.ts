import { describe, expect, it } from 'vitest';
import { verdictToFailureInput } from './mapping.js';
import { externalVerdictDeliverySchema } from './schemas.js';

const minimal = {
  data: {
    acquisitionId: 'acq-1',
    candidate: { username: 'peer1', path: 'peer1/Album [FLAC]' },
    verdict: 'rejected',
  },
};

describe('externalVerdictDeliverySchema — the tolerant reader (D4)', () => {
  it('parses the minimal payload this domain needs', () => {
    const parsed = externalVerdictDeliverySchema.parse(minimal);
    expect(parsed.data.acquisitionId).toBe('acq-1');
    expect(parsed.data.candidate).toEqual({ username: 'peer1', path: 'peer1/Album [FLAC]' });
    expect(parsed.data.verdict).toBe('rejected');
    expect(parsed.data.reasons).toBeUndefined();
  });

  it('reads the candidate size and the reasons when the sender provides them', () => {
    const parsed = externalVerdictDeliverySchema.parse({
      data: {
        ...minimal.data,
        candidate: { ...minimal.data.candidate, sizeBytes: 1000 },
        reasons: ['corrupt stub'],
      },
    });
    expect(parsed.data.candidate.sizeBytes).toBe(1000);
    expect(parsed.data.reasons).toEqual(['corrupt stub']);
  });

  it('ignores unknown fields at every level (the sender’s schema is its own business)', () => {
    const parsed = externalVerdictDeliverySchema.parse({
      type: 'import.rejected',
      timestamp: '2026-07-19T00:00:00.000Z',
      somethingElse: { nested: true },
      data: {
        ...minimal.data,
        candidate: { ...minimal.data.candidate, displayName: 'Peer One' },
        matchDistance: 0.42,
      },
    });
    expect(parsed).toEqual(minimal);
  });

  it('rejects an unknown verdict value (stricter today; relaxing later is additive)', () => {
    expect(
      externalVerdictDeliverySchema.safeParse({
        data: { ...minimal.data, verdict: 'accepted' },
      }).success,
    ).toBe(false);
  });

  it('rejects a payload missing the facts this domain needs', () => {
    expect(externalVerdictDeliverySchema.safeParse({}).success).toBe(false);
    expect(
      externalVerdictDeliverySchema.safeParse({
        data: { candidate: minimal.data.candidate, verdict: 'rejected' },
      }).success,
    ).toBe(false);
    expect(
      externalVerdictDeliverySchema.safeParse({
        data: { acquisitionId: 'acq-1', verdict: 'rejected' },
      }).success,
    ).toBe(false);
  });
});

describe('verdictToFailureInput — the ACL translation', () => {
  it('translates a parsed delivery into the native command input', () => {
    const input = verdictToFailureInput(externalVerdictDeliverySchema.parse(minimal));
    expect(input).toEqual({
      acquisitionId: 'acq-1',
      candidate: { username: 'peer1', path: 'peer1/Album [FLAC]' },
      reasons: [],
    });
  });

  it('carries the sender’s reasons through', () => {
    const input = verdictToFailureInput(
      externalVerdictDeliverySchema.parse({
        data: { ...minimal.data, reasons: ['corrupt stub', 'wrong release'] },
      }),
    );
    expect(input.reasons).toEqual(['corrupt stub', 'wrong release']);
  });
});
