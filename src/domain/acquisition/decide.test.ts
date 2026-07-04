import { describe, expect, it } from 'vitest';
import { decide } from './decide.js';
import type { AcquisitionCommand } from './commands.js';
import type { AcquisitionEvent } from './events.js';
import { foldEvents, initialState } from './state.js';
import type { AcquisitionState } from './state.js';
import {
  defaultPolicies,
  matchingCandidate,
  resolvedHistory,
  sampleRequest,
  sampleTarget,
  selectedHistory,
  validatingHistory,
  importingHistory,
} from './__fixtures__/acquisition-fixtures.js';

const policies = defaultPolicies();

function types(events: readonly AcquisitionEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('decide — submission', () => {
  it('accepts a new submission and starts the acquisition', () => {
    const result = decide(
      { type: 'SubmitAcquisition', request: sampleRequest, policies },
      initialState,
    );
    expect(types(result._unsafeUnwrap())).toEqual(['AcquisitionRequested']);
  });

  it('rejects submitting onto an existing acquisition', () => {
    const existing = foldEvents(resolvedHistory());
    const result = decide(
      { type: 'SubmitAcquisition', request: sampleRequest, policies },
      existing,
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'AlreadyExists' });
  });
});

describe('decide — happy path', () => {
  it('resolves metadata into a target', () => {
    const state = foldEvents([{ type: 'AcquisitionRequested', request: sampleRequest, policies }]);
    const result = decide({ type: 'RecordTarget', target: sampleTarget }, state);
    expect(types(result._unsafeUnwrap())).toEqual(['TargetResolved']);
  });

  it('fails metadata resolution cleanly', () => {
    const state = foldEvents([{ type: 'AcquisitionRequested', request: sampleRequest, policies }]);
    const result = decide({ type: 'RecordMetadataFailed' }, state);
    expect(types(result._unsafeUnwrap())).toEqual(['MetadataResolutionFailed']);
  });

  it('ranks search results and selects the best candidate', () => {
    const state = foldEvents(resolvedHistory());
    const candidates = [matchingCandidate('b'), matchingCandidate('a')];
    const events = decide({ type: 'RecordSearchResults', candidates }, state)._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'CandidateSelected']);
    const selected = events[2] as Extract<AcquisitionEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('a');
  });

  it('exhausts when a search yields nothing usable', () => {
    const state = foldEvents(resolvedHistory());
    const events = decide({ type: 'RecordSearchResults', candidates: [] }, state)._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'AcquisitionExhausted']);
  });

  it('completes a download, passes validation, and imports to fulfilment', () => {
    const downloading = foldEvents(selectedHistory([matchingCandidate('a')]));
    expect(
      types(decide({ type: 'RecordDownloadCompleted', files: [] }, downloading)._unsafeUnwrap()),
    ).toEqual(['DownloadCompleted']);

    const validating = foldEvents(validatingHistory([matchingCandidate('a')]));
    expect(
      types(
        decide(
          { type: 'RecordValidationPassed', verdict: { confidence: 1, reasons: [] } },
          validating,
        )._unsafeUnwrap(),
      ),
    ).toEqual(['ValidationPassed']);

    const importing = foldEvents(importingHistory([matchingCandidate('a')]));
    expect(
      types(decide({ type: 'RecordImported', location: '/library/x' }, importing)._unsafeUnwrap()),
    ).toEqual(['Imported', 'AcquisitionFulfilled']);
  });

  it('reports an import conflict as a terminal outcome', () => {
    const importing = foldEvents(importingHistory([matchingCandidate('a')]));
    const events = decide(
      { type: 'RecordImportConflict', location: '/library/x' },
      importing,
    )._unsafeUnwrap();
    expect(types(events)).toEqual(['ImportConflicted']);
  });
});

describe('decide — retry loop', () => {
  it('rejects a failed download and advances to the next-best candidate', () => {
    const downloading = foldEvents(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b'), matchingCandidate('c')]),
    );
    const events = decide(
      { type: 'RecordDownloadFailed', reason: 'PeerUnavailable' },
      downloading,
    )._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'CandidateSelected']);
    const selected = events[2] as Extract<AcquisitionEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('b');
  });

  it('rejects a failed validation and advances the walk', () => {
    const validating = foldEvents(
      validatingHistory([matchingCandidate('a'), matchingCandidate('b')]),
    );
    const events = decide(
      { type: 'RecordValidationFailed', verdict: { confidence: 0, reasons: ['DurationMismatch'] } },
      validating,
    )._unsafeUnwrap();
    expect(types(events)).toEqual(['ValidationFailed', 'CandidateRejected', 'CandidateSelected']);
  });

  it('requests a bounded re-search when the working set empties', () => {
    const downloading = foldEvents(selectedHistory([matchingCandidate('a')]));
    const events = decide(
      { type: 'RecordDownloadFailed', reason: 'Stalled' },
      downloading,
    )._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'SearchRequested']);
  });

  it('exhausts when the working set empties and no search rounds remain', () => {
    const oneRound = defaultPolicies({ retry: { maxSearchRounds: 1, maxTotalAttempts: 15 } });
    const downloading = foldEvents(selectedHistory([matchingCandidate('a')], oneRound));
    const events = decide(
      { type: 'RecordDownloadFailed', reason: 'Stalled' },
      downloading,
    )._unsafeUnwrap();
    expect(types(events)).toEqual(['DownloadFailed', 'CandidateRejected', 'AcquisitionExhausted']);
  });

  it('exhausts when the total-attempts budget is spent even with candidates left', () => {
    const oneAttempt = defaultPolicies({ retry: { maxSearchRounds: 3, maxTotalAttempts: 1 } });
    const downloading = foldEvents(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b')], oneAttempt),
    );
    const events = decide(
      { type: 'RecordDownloadFailed', reason: 'Stalled' },
      downloading,
    )._unsafeUnwrap();
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
    const state = foldEvents(history);
    const events = decide(
      { type: 'RecordSearchResults', candidates: [rejected, matchingCandidate('y')] },
      state,
    )._unsafeUnwrap();
    const rankedEvent = events[1] as Extract<AcquisitionEvent, { type: 'CandidatesRanked' }>;
    expect(rankedEvent.ranked.map((r) => r.candidate.identity.username)).toEqual(['y']);
  });
});

describe('decide — cancellation and guards', () => {
  it('cancels a non-terminal acquisition', () => {
    const downloading = foldEvents(selectedHistory([matchingCandidate('a')]));
    expect(types(decide({ type: 'CancelAcquisition' }, downloading)._unsafeUnwrap())).toEqual([
      'AcquisitionCancelled',
    ]);
  });

  const terminal = foldEvents([
    ...selectedHistory([matchingCandidate('a')]),
    { type: 'AcquisitionCancelled' },
  ]);

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
    expect(decide(command, terminal)._unsafeUnwrap()).toEqual([]);
  });

  // A non-terminal state whose phase matches none of the effect-result expectations.
  const pending = foldEvents([{ type: 'AcquisitionRequested', request: sampleRequest, policies }]);
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
    expect(decide(command, pending)._unsafeUnwrapErr().kind).toBe('IllegalTransition');
  });

  it('rejects RecordTarget / RecordMetadataFailed outside the Pending phase', () => {
    const downloading: AcquisitionState = foldEvents(selectedHistory([matchingCandidate('a')]));
    expect(
      decide({ type: 'RecordTarget', target: sampleTarget }, downloading)._unsafeUnwrapErr().kind,
    ).toBe('IllegalTransition');
    expect(decide({ type: 'RecordMetadataFailed' }, downloading)._unsafeUnwrapErr().kind).toBe(
      'IllegalTransition',
    );
  });
});
