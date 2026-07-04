import { describe, expect, it } from 'vitest';
import { evolve, foldEvents, initialState, isTerminal } from './state.js';
import type { AcquisitionState } from './state.js';
import type { AcquisitionEvent } from './events.js';
import {
  defaultPolicies,
  matchingCandidate,
  rankedOf,
  sampleFiles,
  sampleRequest,
  sampleTarget,
} from './__fixtures__/acquisition-fixtures.js';

const policies = defaultPolicies();

function apply(events: readonly AcquisitionEvent[], from: AcquisitionState = initialState) {
  return events.reduce(evolve, from);
}

describe('evolve', () => {
  it('starts an acquisition as Pending on AcquisitionRequested', () => {
    const state = apply([{ type: 'AcquisitionRequested', request: sampleRequest, policies }]);
    expect(state.phase).toBe('Pending');
    expect(state.request).toEqual(sampleRequest);
    expect(state.policies).toEqual(policies);
  });

  it('moves to Searching with a target on TargetResolved', () => {
    const state = apply([
      { type: 'AcquisitionRequested', request: sampleRequest, policies },
      { type: 'TargetResolved', target: sampleTarget },
    ]);
    expect(state.phase).toBe('Searching');
    expect(state.target).toEqual(sampleTarget);
  });

  it('terminates on MetadataResolutionFailed', () => {
    const state = apply([{ type: 'MetadataResolutionFailed' }], {
      ...initialState,
      phase: 'Pending',
    });
    expect(state.phase).toBe('MetadataFailed');
  });

  it('returns to Searching on SearchRequested and counts rounds on SearchCompleted', () => {
    const searching = apply([{ type: 'SearchRequested', round: 2 }], {
      ...initialState,
      phase: 'Selecting',
    });
    expect(searching.phase).toBe('Searching');
    const counted = apply([{ type: 'SearchCompleted', round: 1, candidates: [] }]);
    expect(counted.searchRounds).toBe(1);
  });

  it('holds the ranked working set on CandidatesRanked', () => {
    const ranked = rankedOf([matchingCandidate('a')]);
    const state = apply([{ type: 'CandidatesRanked', ranked }]);
    expect(state.phase).toBe('Selecting');
    expect(state.working).toEqual(ranked);
  });

  it('selects a candidate, removing it from the working set and counting the attempt', () => {
    const ranked = rankedOf([matchingCandidate('a'), matchingCandidate('b')]);
    const state = apply([
      { type: 'CandidatesRanked', ranked },
      { type: 'CandidateSelected', candidate: ranked[0]!.candidate },
    ]);
    expect(state.phase).toBe('Downloading');
    expect(state.current).toEqual(ranked[0]!.candidate);
    expect(state.working).toHaveLength(1);
    expect(state.attempts).toBe(1);
  });

  it('records downloaded files and moves to Validating on DownloadCompleted', () => {
    const state = apply([
      { type: 'DownloadCompleted', candidate: matchingCandidate('a').identity, files: sampleFiles },
    ]);
    expect(state.phase).toBe('Validating');
    expect(state.downloadedFiles).toEqual(sampleFiles);
  });

  it('leaves state untouched on the informational DownloadFailed / ValidationFailed', () => {
    const base: AcquisitionState = { ...initialState, phase: 'Downloading' };
    expect(
      evolve(base, {
        type: 'DownloadFailed',
        candidate: matchingCandidate('a').identity,
        reason: 'Stalled',
      }),
    ).toBe(base);
    const validating: AcquisitionState = { ...initialState, phase: 'Validating' };
    expect(
      evolve(validating, {
        type: 'ValidationFailed',
        candidate: matchingCandidate('a').identity,
        verdict: { confidence: 0, reasons: [] },
      }),
    ).toBe(validating);
  });

  it('clears the current candidate and remembers the rejection on CandidateRejected', () => {
    const identity = matchingCandidate('a').identity;
    const state = apply([{ type: 'CandidateRejected', candidate: identity }], {
      ...initialState,
      phase: 'Downloading',
      current: matchingCandidate('a'),
    });
    expect(state.phase).toBe('Selecting');
    expect(state.current).toBeUndefined();
    expect(state.rejected).toHaveLength(1);
  });

  it('moves to Importing on ValidationPassed', () => {
    const state = apply([
      {
        type: 'ValidationPassed',
        candidate: matchingCandidate('a').identity,
        verdict: { confidence: 1, reasons: [] },
      },
    ]);
    expect(state.phase).toBe('Importing');
  });

  it('records the library location and fulfils on Imported then AcquisitionFulfilled', () => {
    const state = apply([
      { type: 'Imported', candidate: matchingCandidate('a').identity, location: '/library/x' },
      { type: 'AcquisitionFulfilled', location: '/library/x' },
    ]);
    expect(state.phase).toBe('Fulfilled');
    expect(state.location).toBe('/library/x');
  });

  it('terminates on AcquisitionExhausted, ImportConflicted, and AcquisitionCancelled', () => {
    expect(apply([{ type: 'AcquisitionExhausted' }]).phase).toBe('Exhausted');
    expect(apply([{ type: 'ImportConflicted', location: '/library/x' }]).phase).toBe('Conflicted');
    expect(apply([{ type: 'AcquisitionCancelled' }]).phase).toBe('Cancelled');
  });
});

describe('isTerminal / foldEvents', () => {
  it('recognizes terminal and non-terminal phases', () => {
    expect(isTerminal({ ...initialState, phase: 'Fulfilled' })).toBe(true);
    expect(isTerminal({ ...initialState, phase: 'Downloading' })).toBe(false);
  });

  it('folds a whole history from the initial state', () => {
    const state = foldEvents([{ type: 'AcquisitionRequested', request: sampleRequest, policies }]);
    expect(state.phase).toBe('Pending');
  });
});
