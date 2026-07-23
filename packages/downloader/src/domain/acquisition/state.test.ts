import { describe, expect, it } from 'vitest';
import type { AcquisitionEvent } from './events.js';
import { evolve, foldEvents } from './state.js';
import { asMbid } from '../shared/__fixtures__/mbid.js';
import { asUnit } from '../shared/__fixtures__/unit.js';
import type { AcquisitionPhase, AcquisitionState } from './state.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  fulfilledHistory,
  importingHistory,
  matchingCandidate,
  rankedOf,
  requestedHistory,
  resolvedHistory,
  sampleEditionCandidates,
  sampleGroupRequest,
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
  AwaitingManualSelection: foldEvents(awaitingSelectionHistory()),
  Searching: foldEvents(resolvedHistory()),
  Selecting: foldEvents(selectingHistory),
  Downloading: foldEvents(selectedHistory([a])),
  Validating: foldEvents(validatingHistory([a])),
  Importing: foldEvents(importingHistory([a])),
  MetadataFailed: foldEvents([...requestedHistory(), { type: 'MetadataResolutionFailed' }]),
  Fulfilled: foldEvents(fulfilledHistory([a])),
  Conflicted: foldEvents([...importingHistory([a]), { type: 'ImportConflicted', location: '/x' }]),
  Exhausted: foldEvents([...selectingHistory, { type: 'AcquisitionExhausted' }]),
  Cancelled: foldEvents([...selectedHistory([a]), { type: 'AcquisitionCancelled' }]),
};

/** One representative instance of every event type. */
const allEvents: AcquisitionEvent[] = [
  { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
  { type: 'TargetResolved', target: sampleTarget },
  { type: 'MetadataResolutionFailed' },
  { type: 'ManualSelectionRequested', candidates: sampleEditionCandidates },
  { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
  { type: 'SearchRequested', round: 2 },
  { type: 'SearchCompleted', round: 1, candidates: [] },
  { type: 'CandidatesRanked', ranked: [] },
  { type: 'CandidateSelected', candidate: a },
  { type: 'DownloadCompleted', candidate: a.identity, files: [] },
  { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
  {
    type: 'ValidationPassed',
    candidate: a.identity,
    verdict: { confidence: asUnit(1), reasons: [] },
  },
  {
    type: 'ValidationFailed',
    candidate: a.identity,
    verdict: { confidence: asUnit(0), reasons: [] },
  },
  { type: 'Imported', candidate: a.identity, location: '/x' },
  { type: 'AcquisitionFulfilled', location: '/x' },
  { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
  { type: 'AcquisitionExhausted' },
  { type: 'ImportConflicted', location: '/x' },
  { type: 'AcquisitionCancelled' },
];

// The phases each event legally transitions FROM (where `evolve` changes state). Any other pairing
// is out-of-protocol and MUST be ignored. Kept in lockstep with `evolve`.
const NON_TERMINAL: readonly AcquisitionPhase[] = [
  'Empty',
  'Pending',
  'AwaitingManualSelection',
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
  ManualSelectionRequested: ['Pending'],
  EditionSelected: ['AwaitingManualSelection'],
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
  FulfillmentRejected: ['Fulfilled'],
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

describe('evolve — cleanup events carry inert staged files (D3, additive/optional)', () => {
  it('folds a rejection identically whether or not it carries staged files', () => {
    const base: AcquisitionEvent[] = [
      ...validatingHistory([a, b]),
      {
        type: 'ValidationFailed',
        candidate: a.identity,
        verdict: { confidence: asUnit(0), reasons: [] },
      },
    ];
    const withFiles = foldEvents([
      ...base,
      {
        type: 'CandidateRejected',
        candidate: a.identity,
        files: [{ path: '/staging/Album/01.flac', name: '01.flac' }],
      },
    ]);
    const legacy = foldEvents([...base, { type: 'CandidateRejected', candidate: a.identity }]);

    expect(withFiles).toEqual(legacy); // the carried files never touch the fold
    expect(withFiles.phase).toBe('Selecting');
  });
});

describe('evolve — fulfilment retains the ladder-resume context (defeasible Fulfilled, D3)', () => {
  type Fulfilled = Extract<AcquisitionState, { phase: 'Fulfilled' }>;
  const fulfilled = matchingCandidate('a');
  const runnerUp = matchingCandidate('b');
  // Ranking puts equal candidates in search order: 'a' wins, 'b' remains in the working set.
  const modern = foldEvents(fulfilledHistory([fulfilled, runnerUp])) as Fulfilled;
  const legacy = foldEvents([
    ...importingHistory([fulfilled, runnerUp]),
    { type: 'Imported', candidate: fulfilled.identity, location: '/library/x' },
    { type: 'AcquisitionFulfilled', location: '/library/x' },
  ]) as Fulfilled;

  it('retains the fulfilled candidate and the context needed to resume the ladder', () => {
    expect(modern.phase).toBe('Fulfilled');
    expect(modern.location).toBe('/library/x');
    expect(modern.resume?.candidate).toEqual(fulfilled);
    expect(modern.resume?.target).toEqual(sampleTarget);
    expect(modern.resume?.policies).toEqual(defaultPolicies());
    expect(modern.resume?.request).toEqual(sampleRequest);
    expect(modern.resume?.working.map((r) => r.candidate)).toEqual([runnerUp]);
  });

  it('folds a legacy fulfilment (no candidate on the event) with no retained context', () => {
    expect(legacy.phase).toBe('Fulfilled');
    expect(legacy.location).toBe('/library/x');
    expect(legacy.resume).toBeUndefined();
  });

  it('folds FulfillmentRejected back into the rejection path, resuming the retained context', () => {
    const revived = evolve(modern, {
      type: 'FulfillmentRejected',
      candidate: fulfilled.identity,
      reasons: ['corrupt stub'],
    });
    expect(revived).toMatchObject({
      phase: 'Validating',
      current: fulfilled,
      target: sampleTarget,
      request: sampleRequest,
      downloadedFiles: [],
      attempts: 1,
    });
  });

  it('folds the whole revival batch through the existing rejection/selection cases', () => {
    const ranked = rankedOf([fulfilled, runnerUp]);
    const state = foldEvents([
      ...fulfilledHistory([fulfilled, runnerUp]),
      { type: 'FulfillmentRejected', candidate: fulfilled.identity, reasons: [] },
      { type: 'CandidateRejected', candidate: fulfilled.identity, files: [] },
      { type: 'CandidateSelected', candidate: ranked[1]!.candidate },
    ]);
    expect(state).toMatchObject({ phase: 'Downloading', current: runnerUp, attempts: 2 });
    expect((state as Extract<AcquisitionState, { phase: 'Downloading' }>).rejected).toHaveLength(1);
  });

  it('ignores FulfillmentRejected on a legacy fulfilment with no retained context', () => {
    const event: AcquisitionEvent = {
      type: 'FulfillmentRejected',
      candidate: fulfilled.identity,
      reasons: [],
    };
    expect(evolve(legacy, event)).toBe(legacy); // unchanged, same reference
  });
});

describe('evolve — cancellation edge cases', () => {
  it('cancels an empty acquisition into a terminal cancelled state with zeroed progress', () => {
    const cancelled = foldEvents([{ type: 'AcquisitionCancelled' }]) as Extract<
      AcquisitionState,
      { phase: 'Cancelled' }
    >;
    expect(cancelled.phase).toBe('Cancelled');
    expect(cancelled).toMatchObject({ rejected: [], searchRounds: 0, attempts: 0 });
    expect(cancelled.staging).toEqual({ kind: 'none' });
  });
});

describe('evolve — cancellation retains and settles the mid-download candidate', () => {
  const cancelledInFlight = foldEvents([
    ...selectedHistory([a]),
    { type: 'AcquisitionCancelled' },
  ]) as Extract<AcquisitionState, { phase: 'Cancelled' }>;

  it('retains the in-flight candidate as `in-flight` staging, never `settled`', () => {
    expect(cancelledInFlight.phase).toBe('Cancelled');
    expect(cancelledInFlight.staging).toEqual({ kind: 'in-flight', pending: a });
  });

  it('retains a settled candidate as `settled` staging, never `in-flight`', () => {
    const cancelledSettled = foldEvents([
      ...validatingHistory([a]),
      { type: 'AcquisitionCancelled' },
    ]) as Extract<AcquisitionState, { phase: 'Cancelled' }>;
    expect(cancelledSettled.staging).toEqual({ kind: 'settled', current: a });
  });

  it('clears staging to `none` when the aborted candidate settles and is rejected, staying Cancelled', () => {
    const settled = evolve(cancelledInFlight, {
      type: 'CandidateRejected',
      candidate: a.identity,
    }) as Extract<AcquisitionState, { phase: 'Cancelled' }>;
    expect(settled.phase).toBe('Cancelled');
    expect(settled.staging).toEqual({ kind: 'none' });
  });

  it('ignores a further rejection once staging is already `none`', () => {
    const cleared = evolve(cancelledInFlight, { type: 'CandidateRejected', candidate: a.identity });
    expect(evolve(cleared, { type: 'CandidateRejected', candidate: a.identity })).toBe(cleared);
  });
});

describe('evolve — manual edition selection pauses and resumes', () => {
  it('folds a manual-selection request into AwaitingManualSelection, retaining the candidates', () => {
    const state = foldEvents(awaitingSelectionHistory());
    expect(state).toMatchObject({
      phase: 'AwaitingManualSelection',
      request: sampleGroupRequest,
      candidates: sampleEditionCandidates,
    });
  });

  it('folds an edition selection back to Pending, keeping the original request', () => {
    const state = foldEvents([
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
    ]);
    expect(state).toMatchObject({ phase: 'Pending', request: sampleGroupRequest });
    expect('candidates' in state).toBe(false);
  });

  it('resolves to Searching once the selected edition yields a target (the normal flow)', () => {
    const state = foldEvents([
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
      { type: 'TargetResolved', target: sampleTarget },
    ]);
    expect(state).toMatchObject({ phase: 'Searching', target: sampleTarget });
  });

  it('cancelling while awaiting selection folds through the existing cancel path', () => {
    const state = foldEvents([...awaitingSelectionHistory(), { type: 'AcquisitionCancelled' }]);
    expect(state).toMatchObject({ phase: 'Cancelled', staging: { kind: 'none' } });
  });
});
