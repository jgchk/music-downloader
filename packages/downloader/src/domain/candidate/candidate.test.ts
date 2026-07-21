import { describe, expect, it } from 'vitest';
import { candidateKey, fileCount, refersTo, sameCandidate } from './candidate.js';
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

describe('refersTo', () => {
  it('matches on username, path, and size when all are given', () => {
    expect(refersTo({ ...identity }, identity)).toBe(true);
    expect(refersTo({ ...identity, sizeBytes: 1 }, identity)).toBe(false);
  });

  it('matches on username and path alone when the reference omits size', () => {
    expect(refersTo({ username: 'peer1', path: '/music/album' }, identity)).toBe(true);
  });

  it('rejects a reference naming a different username or path', () => {
    expect(refersTo({ username: 'peer2', path: '/music/album' }, identity)).toBe(false);
    expect(refersTo({ username: 'peer1', path: '/other' }, identity)).toBe(false);
  });
});

describe('fileCount', () => {
  it('counts the files in a candidate', () => {
    expect(fileCount(candidate())).toBe(2);
  });
});
