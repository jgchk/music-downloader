import { describe, expect, it } from 'vitest';
import { Acquisition } from './acquisition.js';
import type { Effect } from './acquisition.js';
import type { AcquisitionCommand } from './commands.js';
import type { AcquisitionEvent } from './events.js';
import {
  defaultPolicies,
  importingHistory,
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleFiles,
  sampleRequest,
  sampleTarget,
  selectedHistory,
  validatingHistory,
} from './__fixtures__/acquisition-fixtures.js';

const policies = defaultPolicies();

function types(events: readonly AcquisitionEvent[]): string[] {
  return events.map((event) => event.type);
}

function effectTypes(effects: readonly Effect[]): string[] {
  return effects.map((effect) => effect.type);
}

// Terminal / lifecycle histories, folded through `fromHistory`, exercise every `evolve` branch and
// give the read snapshot something to project. Assertions on phase/isTerminal/snapshot stand in for
// the old direct `evolve` observations — state itself is now private to the aggregate.
const a = matchingCandidate('a');
const fulfilledHistory: AcquisitionEvent[] = [
  ...importingHistory([a]),
  { type: 'Imported', candidate: a.identity, location: '/library/x' },
  { type: 'AcquisitionFulfilled', location: '/library/x' },
];
const conflictedHistory: AcquisitionEvent[] = [
  ...importingHistory([a]),
  { type: 'ImportConflicted', location: '/library/x' },
];
const cancelledHistory: AcquisitionEvent[] = [
  ...selectedHistory([a]),
  { type: 'AcquisitionCancelled' },
];
const metadataFailedHistory: AcquisitionEvent[] = [
  ...requestedHistory(),
  { type: 'MetadataResolutionFailed' },
];
// Downloading 'a' with 'b' still untried, then 'a' fails and is rejected — lands back in Selecting.
const rejectedThenSelecting: AcquisitionEvent[] = [
  ...selectedHistory([a, matchingCandidate('b')]),
  { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
];
const validationFailedThenSelecting: AcquisitionEvent[] = [
  ...validatingHistory([a, matchingCandidate('b')]),
  { type: 'ValidationFailed', candidate: a.identity, verdict: { confidence: 0, reasons: [] } },
  { type: 'CandidateRejected', candidate: a.identity },
];

describe('Acquisition.execute — submission', () => {
  it('accepts a new submission and starts the acquisition', () => {
    const result = Acquisition.fromHistory([]).execute({
      type: 'SubmitAcquisition',
      request: sampleRequest,
      policies,
    });
    expect(types(result._unsafeUnwrap())).toEqual(['AcquisitionRequested']);
  });

  it('rejects submitting onto an existing acquisition', () => {
    const result = Acquisition.fromHistory(resolvedHistory()).execute({
      type: 'SubmitAcquisition',
      request: sampleRequest,
      policies,
    });
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'AlreadyExists' });
  });
});

describe('Acquisition.execute — happy path', () => {
  it('resolves metadata into a target', () => {
    const result = Acquisition.fromHistory(requestedHistory()).execute({
      type: 'RecordTarget',
      target: sampleTarget,
    });
    expect(types(result._unsafeUnwrap())).toEqual(['TargetResolved']);
  });

  it('fails metadata resolution cleanly', () => {
    const result = Acquisition.fromHistory(requestedHistory()).execute({
      type: 'RecordMetadataFailed',
    });
    expect(types(result._unsafeUnwrap())).toEqual(['MetadataResolutionFailed']);
  });

  it('ranks search results and selects the best candidate', () => {
    const candidates = [matchingCandidate('b'), matchingCandidate('a')];
    const events = Acquisition.fromHistory(resolvedHistory())
      .execute({ type: 'RecordSearchResults', candidates })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'CandidateSelected']);
    const selected = events[2] as Extract<AcquisitionEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('a');
  });

  it('exhausts when a search yields nothing usable', () => {
    const events = Acquisition.fromHistory(resolvedHistory())
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'AcquisitionExhausted']);
  });

  it('completes a download, passes validation, and imports to fulfilment', () => {
    expect(
      types(
        Acquisition.fromHistory(selectedHistory([a]))
          .execute({ type: 'RecordDownloadCompleted', files: [] })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['DownloadCompleted']);

    expect(
      types(
        Acquisition.fromHistory(validatingHistory([a]))
          .execute({ type: 'RecordValidationPassed', verdict: { confidence: 1, reasons: [] } })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['ValidationPassed']);

    expect(
      types(
        Acquisition.fromHistory(importingHistory([a]))
          .execute({ type: 'RecordImported', location: '/library/x' })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['Imported', 'AcquisitionFulfilled']);
  });

  it('reports an import conflict as a terminal outcome', () => {
    const events = Acquisition.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImportConflict', location: '/library/x' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['ImportConflicted']);
  });
});

describe('Acquisition.execute — retry loop', () => {
  it('rejects a failed download and advances to the next-best candidate', () => {
    const events = Acquisition.fromHistory(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b'), matchingCandidate('c')]),
    )
      .execute({ type: 'RecordDownloadFailed', reason: 'PeerUnavailable' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'CandidateSelected']);
    const selected = events[2] as Extract<AcquisitionEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('b');
  });

  it('rejects a failed validation and advances the walk', () => {
    const events = Acquisition.fromHistory(
      validatingHistory([matchingCandidate('a'), matchingCandidate('b')]),
    )
      .execute({
        type: 'RecordValidationFailed',
        verdict: { confidence: 0, reasons: ['DurationMismatch'] },
      })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['ValidationFailed', 'CandidateRejected', 'CandidateSelected']);
  });

  it('requests a bounded re-search when the working set empties', () => {
    const events = Acquisition.fromHistory(selectedHistory([matchingCandidate('a')]))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'SearchRequested']);
  });

  it('exhausts when the working set empties and no search rounds remain', () => {
    const oneRound = defaultPolicies({ retry: { maxSearchRounds: 1, maxTotalAttempts: 15 } });
    const events = Acquisition.fromHistory(selectedHistory([matchingCandidate('a')], oneRound))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'AcquisitionExhausted']);
  });

  it('exhausts when the total-attempts budget is spent even with candidates left', () => {
    const oneAttempt = defaultPolicies({ retry: { maxSearchRounds: 3, maxTotalAttempts: 1 } });
    const events = Acquisition.fromHistory(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b')], oneAttempt),
    )
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'AcquisitionExhausted']);
  });

  it('re-search merges fresh candidates and excludes previously-rejected ones', () => {
    const rejected = matchingCandidate('x');
    const history: AcquisitionEvent[] = [
      ...selectedHistory([rejected]),
      { type: 'DownloadFailed', candidate: rejected.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: rejected.identity },
      { type: 'SearchRequested', round: 2 },
    ];
    const events = Acquisition.fromHistory(history)
      .execute({ type: 'RecordSearchResults', candidates: [rejected, matchingCandidate('y')] })
      ._unsafeUnwrap();
    const rankedEvent = events[1] as Extract<AcquisitionEvent, { type: 'CandidatesRanked' }>;
    expect(rankedEvent.ranked.map((r) => r.candidate.identity.username)).toEqual(['y']);
  });
});

describe('Acquisition.execute — cancellation and guards', () => {
  it('cancels a non-terminal acquisition', () => {
    expect(
      types(
        Acquisition.fromHistory(selectedHistory([a]))
          .execute({ type: 'CancelAcquisition' })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['AcquisitionCancelled']);
  });

  const terminal = Acquisition.fromHistory(cancelledHistory);

  const effectResults: AcquisitionCommand[] = [
    { type: 'RecordTarget', target: sampleTarget },
    { type: 'RecordMetadataFailed' },
    { type: 'RecordSearchResults', candidates: [] },
    { type: 'RecordDownloadCompleted', files: [] },
    { type: 'RecordDownloadFailed', reason: 'Stalled' },
    { type: 'RecordValidationPassed', verdict: { confidence: 1, reasons: [] } },
    { type: 'RecordValidationFailed', verdict: { confidence: 0, reasons: [] } },
    { type: 'RecordImported', location: '/x' },
    { type: 'RecordImportConflict', location: '/x' },
    { type: 'CancelAcquisition' },
  ];

  it.each(effectResults)('ignores a stale $type on a terminal acquisition', (command) => {
    expect(terminal.execute(command)._unsafeUnwrap()).toEqual([]);
  });

  const pending = Acquisition.fromHistory(requestedHistory());
  const illegalOnPending: AcquisitionCommand[] = [
    { type: 'RecordSearchResults', candidates: [] },
    { type: 'RecordDownloadCompleted', files: [] },
    { type: 'RecordDownloadFailed', reason: 'Stalled' },
    { type: 'RecordValidationPassed', verdict: { confidence: 1, reasons: [] } },
    { type: 'RecordValidationFailed', verdict: { confidence: 0, reasons: [] } },
    { type: 'RecordImported', location: '/x' },
    { type: 'RecordImportConflict', location: '/x' },
  ];

  it.each(illegalOnPending)('rejects an illegal $type while Pending', (command) => {
    expect(pending.execute(command)._unsafeUnwrapErr().kind).toBe('IllegalTransition');
  });

  it('rejects RecordTarget / RecordMetadataFailed outside the Pending phase', () => {
    const downloading = Acquisition.fromHistory(selectedHistory([a]));
    expect(
      downloading.execute({ type: 'RecordTarget', target: sampleTarget })._unsafeUnwrapErr().kind,
    ).toBe('IllegalTransition');
    expect(downloading.execute({ type: 'RecordMetadataFailed' })._unsafeUnwrapErr().kind).toBe(
      'IllegalTransition',
    );
  });
});

describe('Acquisition.reactTo — the event → effect table', () => {
  it('resolves metadata after a request', () => {
    const acq = Acquisition.fromHistory(requestedHistory());
    const effects = acq.reactTo({
      type: 'AcquisitionRequested',
      request: sampleRequest,
      policies,
    });
    expect(effects).toEqual([{ type: 'ResolveMetadata', request: sampleRequest }]);
  });

  it('searches after a target resolves', () => {
    const effects = Acquisition.fromHistory(resolvedHistory()).reactTo({
      type: 'TargetResolved',
      target: sampleTarget,
    });
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 1 }]);
  });

  it('searches again on a re-search request, carrying the round', () => {
    const effects = Acquisition.fromHistory([
      ...resolvedHistory(),
      { type: 'SearchRequested', round: 3 },
    ]).reactTo({ type: 'SearchRequested', round: 3 });
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 3 }]);
  });

  it('downloads the selected candidate with the download policy', () => {
    const candidate = matchingCandidate('a');
    const effects = Acquisition.fromHistory(selectedHistory([candidate])).reactTo({
      type: 'CandidateSelected',
      candidate,
    });
    expect(effectTypes(effects)).toEqual(['Download']);
    expect((effects[0] as Extract<Effect, { type: 'Download' }>).candidate).toEqual(candidate);
  });

  it('validates a completed download against the target', () => {
    const effects = Acquisition.fromHistory(validatingHistory([a])).reactTo({
      type: 'DownloadCompleted',
      candidate: a.identity,
      files: sampleFiles,
    });
    expect(effectTypes(effects)).toEqual(['Validate']);
  });

  it('imports validated files', () => {
    const effects = Acquisition.fromHistory(importingHistory([a])).reactTo({
      type: 'ValidationPassed',
      candidate: a.identity,
      verdict: { confidence: 1, reasons: [] },
    });
    expect(effectTypes(effects)).toEqual(['Import']);
  });

  const inertEvents: AcquisitionEvent[] = [
    { type: 'MetadataResolutionFailed' },
    { type: 'SearchCompleted', round: 1, candidates: [] },
    { type: 'CandidatesRanked', ranked: [] },
    { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
    { type: 'ValidationFailed', candidate: a.identity, verdict: { confidence: 0, reasons: [] } },
    { type: 'Imported', candidate: a.identity, location: '/x' },
    { type: 'AcquisitionFulfilled', location: '/x' },
    { type: 'AcquisitionExhausted' },
    { type: 'ImportConflicted', location: '/x' },
    { type: 'AcquisitionCancelled' },
  ];

  it.each(inertEvents)('emits no effect for $type', (event) => {
    expect(Acquisition.fromHistory([]).reactTo(event)).toEqual([]);
  });

  it('cleans up staging when a candidate is rejected', () => {
    expect(
      Acquisition.fromHistory([]).reactTo({ type: 'CandidateRejected', candidate: a.identity }),
    ).toEqual([{ type: 'Cleanup', candidate: a.identity }]);
  });
});

describe('Acquisition.fromHistory — phase, isTerminal, and the read snapshot', () => {
  it('folds each lifecycle history into the expected phase', () => {
    expect(Acquisition.fromHistory([]).phase).toBe('Empty');
    expect(Acquisition.fromHistory(requestedHistory()).phase).toBe('Pending');
    expect(Acquisition.fromHistory(resolvedHistory()).phase).toBe('Searching');
    expect(Acquisition.fromHistory(rejectedThenSelecting).phase).toBe('Selecting');
    expect(Acquisition.fromHistory(selectedHistory([a])).phase).toBe('Downloading');
    expect(Acquisition.fromHistory(validatingHistory([a])).phase).toBe('Validating');
    expect(Acquisition.fromHistory(importingHistory([a])).phase).toBe('Importing');
    expect(Acquisition.fromHistory(fulfilledHistory).phase).toBe('Fulfilled');
    expect(Acquisition.fromHistory(metadataFailedHistory).phase).toBe('MetadataFailed');
    expect(Acquisition.fromHistory(conflictedHistory).phase).toBe('Conflicted');
    expect(Acquisition.fromHistory(cancelledHistory).phase).toBe('Cancelled');
    expect(Acquisition.fromHistory(validationFailedThenSelecting).phase).toBe('Selecting');
  });

  it('reports terminal and non-terminal phases', () => {
    expect(Acquisition.fromHistory(fulfilledHistory).isTerminal).toBe(true);
    expect(Acquisition.fromHistory(conflictedHistory).isTerminal).toBe(true);
    expect(Acquisition.fromHistory(cancelledHistory).isTerminal).toBe(true);
    expect(Acquisition.fromHistory(metadataFailedHistory).isTerminal).toBe(true);
    expect(Acquisition.fromHistory(selectedHistory([a])).isTerminal).toBe(false);
  });

  it('projects a read snapshot of the folded state', () => {
    const downloading = Acquisition.fromHistory(selectedHistory([a])).snapshot;
    expect(downloading.phase).toBe('Downloading');
    expect(downloading.currentCandidate).toEqual(a.identity);
    expect(downloading.attempts).toBe(1);
    expect(downloading.rejectedCount).toBe(0);
    expect(downloading.location).toBeUndefined();

    const afterRejection = Acquisition.fromHistory(rejectedThenSelecting).snapshot;
    expect(afterRejection.phase).toBe('Selecting');
    expect(afterRejection.currentCandidate).toBeUndefined();
    expect(afterRejection.rejectedCount).toBe(1);

    const fulfilled = Acquisition.fromHistory(fulfilledHistory).snapshot;
    expect(fulfilled.location).toBe('/library/x');
  });
});

describe('Acquisition — immutability', () => {
  it('does not mutate on execute; repeated calls agree', () => {
    const acq = Acquisition.fromHistory(selectedHistory([matchingCandidate('a')]));
    const first = acq.execute({ type: 'RecordDownloadFailed', reason: 'Stalled' });
    const second = acq.execute({ type: 'RecordDownloadFailed', reason: 'Stalled' });
    expect(types(second._unsafeUnwrap())).toEqual(types(first._unsafeUnwrap()));
    expect(acq.phase).toBe('Downloading');
    expect(acq.isTerminal).toBe(false);
  });
});
