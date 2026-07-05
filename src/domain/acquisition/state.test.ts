import { describe, expect, it } from 'vitest';
import type { AcquisitionEvent } from './events.js';
import { evolve, foldEvents } from './state.js';
import type { AcquisitionPhase, AcquisitionState } from './state.js';
import {
  defaultPolicies,
  importingHistory,
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleRequest,
  sampleTarget,
  selectedHistory,
  validatingHistory,
} from './__fixtures__/acquisition-fixtures.js';

const a = matchingCandidate('a');
const b = matchingCandidate('b');

// A history landing in Selecting: a is tried and rejected, leaving b untried in the working set.
const selectingHistory: AcquisitionEvent[] = [
  ...selectedHistory([a, b]),
  { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
];

/** One representative, reachable state per phase, built by folding a real history. */
const stateByPhase: Record<AcquisitionPhase, AcquisitionState> = {
  Empty: foldEvents([]),
  Pending: foldEvents(requestedHistory()),
  Searching: foldEvents(resolvedHistory()),
  Selecting: foldEvents(selectingHistory),
  Downloading: foldEvents(selectedHistory([a])),
  Validating: foldEvents(validatingHistory([a])),
  Importing: foldEvents(importingHistory([a])),
  MetadataFailed: foldEvents([...requestedHistory(), { type: 'MetadataResolutionFailed' }]),
  Fulfilled: foldEvents([
    ...importingHistory([a]),
    { type: 'Imported', candidate: a.identity, location: '/library/x' },
    { type: 'AcquisitionFulfilled', location: '/library/x' },
  ]),
  Conflicted: foldEvents([...importingHistory([a]), { type: 'ImportConflicted', location: '/x' }]),
  Exhausted: foldEvents([...selectingHistory, { type: 'AcquisitionExhausted' }]),
  Cancelled: foldEvents([...selectedHistory([a]), { type: 'AcquisitionCancelled' }]),
};

/** One representative instance of every event type. */
const allEvents: AcquisitionEvent[] = [
  { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
  { type: 'TargetResolved', target: sampleTarget },
  { type: 'MetadataResolutionFailed' },
  { type: 'SearchRequested', round: 2 },
  { type: 'SearchCompleted', round: 1, candidates: [] },
  { type: 'CandidatesRanked', ranked: [] },
  { type: 'CandidateSelected', candidate: a },
  { type: 'DownloadCompleted', candidate: a.identity, files: [] },
  { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
  { type: 'ValidationPassed', candidate: a.identity, verdict: { confidence: 1, reasons: [] } },
  { type: 'ValidationFailed', candidate: a.identity, verdict: { confidence: 0, reasons: [] } },
  { type: 'Imported', candidate: a.identity, location: '/x' },
  { type: 'AcquisitionFulfilled', location: '/x' },
  { type: 'AcquisitionExhausted' },
  { type: 'ImportConflicted', location: '/x' },
  { type: 'AcquisitionCancelled' },
];

// The phases each event legally transitions FROM (where `evolve` changes state). Any other pairing
// is out-of-protocol and MUST be ignored. Kept in lockstep with `evolve`.
const NON_TERMINAL: readonly AcquisitionPhase[] = [
  'Empty',
  'Pending',
  'Searching',
  'Selecting',
  'Downloading',
  'Validating',
  'Importing',
];
const legalSources: Record<AcquisitionEvent['type'], readonly AcquisitionPhase[]> = {
  AcquisitionRequested: ['Empty'],
  TargetResolved: ['Pending'],
  MetadataResolutionFailed: ['Pending'],
  SearchRequested: ['Selecting'],
  SearchCompleted: ['Searching'],
  CandidatesRanked: ['Searching'],
  CandidateSelected: ['Selecting'],
  DownloadCompleted: ['Downloading'],
  DownloadFailed: [],
  CandidateRejected: ['Downloading', 'Validating', 'Cancelled'],
  ValidationPassed: ['Validating'],
  ValidationFailed: [],
  Imported: [],
  AcquisitionFulfilled: ['Importing'],
  AcquisitionExhausted: ['Selecting'],
  ImportConflicted: ['Importing'],
  AcquisitionCancelled: NON_TERMINAL,
};

const ALL_PHASES = Object.keys(stateByPhase) as AcquisitionPhase[];

describe('evolve — totality: out-of-protocol events are ignored', () => {
  for (const event of allEvents) {
    const legal = legalSources[event.type];
    for (const phase of ALL_PHASES) {
      if (legal.includes(phase)) continue;
      it(`ignores ${event.type} in phase ${phase}`, () => {
        const state = stateByPhase[phase];
        expect(evolve(state, event)).toBe(state); // unchanged, same reference
      });
    }
  }
});

describe('evolve — cancellation edge cases', () => {
  it('cancels an empty acquisition into a terminal cancelled state with zeroed progress', () => {
    const cancelled = foldEvents([{ type: 'AcquisitionCancelled' }]);
    expect(cancelled.phase).toBe('Cancelled');
    expect(cancelled).toMatchObject({ rejected: [], searchRounds: 0, attempts: 0 });
    expect('current' in cancelled).toBe(false);
    expect('pending' in cancelled).toBe(false);
  });
});

describe('evolve — cancellation retains and settles the mid-download candidate', () => {
  const cancelledInFlight = foldEvents([
    ...selectedHistory([a]),
    { type: 'AcquisitionCancelled' },
  ]) as Extract<AcquisitionState, { phase: 'Cancelled' }>;

  it('retains the in-flight candidate as `pending`, not `current`', () => {
    expect(cancelledInFlight.phase).toBe('Cancelled');
    expect(cancelledInFlight.pending).toEqual(a);
    expect(cancelledInFlight.current).toBeUndefined();
  });

  it('retains a settled candidate as `current`, not `pending`', () => {
    const cancelledSettled = foldEvents([
      ...validatingHistory([a]),
      { type: 'AcquisitionCancelled' },
    ]) as Extract<AcquisitionState, { phase: 'Cancelled' }>;
    expect(cancelledSettled.current).toEqual(a);
    expect(cancelledSettled.pending).toBeUndefined();
  });

  it('clears `pending` when the aborted candidate settles and is rejected, staying Cancelled', () => {
    const settled = evolve(cancelledInFlight, { type: 'CandidateRejected', candidate: a.identity });
    expect(settled.phase).toBe('Cancelled');
    expect('pending' in settled).toBe(false);
  });

  it('ignores a further rejection once `pending` is already cleared', () => {
    const cleared = evolve(cancelledInFlight, { type: 'CandidateRejected', candidate: a.identity });
    expect(evolve(cleared, { type: 'CandidateRejected', candidate: a.identity })).toBe(cleared);
  });
});
