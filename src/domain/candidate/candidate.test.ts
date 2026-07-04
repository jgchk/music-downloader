import { describe, expect, it } from 'vitest';
import { candidateKey, fileCount, sameCandidate } from './candidate.js';
import type { Candidate, CandidateIdentity } from './candidate.js';

const identity: CandidateIdentity = { username: 'peer1', path: '/music/album', sizeBytes: 4200 };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    identity,
    files: [
      { name: '01.flac', sizeBytes: 2100 },
      { name: '02.flac', sizeBytes: 2100 },
    ],
    source: { speedBytesPerSec: 500_000, freeSlots: 2, queueLength: 0 },
    ...overrides,
  };
}

describe('candidateKey', () => {
  it('is stable for the same identity', () => {
    expect(candidateKey(identity)).toBe(candidateKey({ ...identity }));
  });

  it('differs when any of username, path, or size differ', () => {
    expect(candidateKey(identity)).not.toBe(candidateKey({ ...identity, username: 'peer2' }));
    expect(candidateKey(identity)).not.toBe(candidateKey({ ...identity, path: '/other' }));
    expect(candidateKey(identity)).not.toBe(candidateKey({ ...identity, sizeBytes: 9999 }));
  });
});

describe('sameCandidate', () => {
  it('is true for identical identities and false otherwise', () => {
    expect(sameCandidate(identity, { ...identity })).toBe(true);
    expect(sameCandidate(identity, { ...identity, sizeBytes: 1 })).toBe(false);
  });
});

describe('fileCount', () => {
  it('counts the files in a candidate', () => {
    expect(fileCount(candidate())).toBe(2);
  });
});
