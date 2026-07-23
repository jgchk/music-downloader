import { describe, expect, it } from 'vitest';
import { Acquisition } from './acquisition.js';
import type { Effect } from './acquisition.js';
import type { AcquisitionCommand } from './commands.js';
import type { AcquisitionEvent, AcquisitionRequest } from './events.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  fulfilledHistory,
  importingHistory,
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleEditionCandidates,
  sampleFiles,
  sampleGroupRequest,
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
// Fulfilled before the external-verdict capability existed: the event names no candidate, so the
// folded state retains no resume context and the acquisition cannot be revived.
const legacyFulfilledHistory: AcquisitionEvent[] = [
  ...importingHistory([a]),
  { type: 'Imported', candidate: a.identity, location: '/library/x' },
  { type: 'AcquisitionFulfilled', location: '/library/x' },
];
const conflictedHistory: AcquisitionEvent[] = [
  ...importingHistory([a]),
  { type: 'ImportConflicted', location: '/library/x' },
];
// Cancelled mid-download: the folded Cancelled state retains `a` as `pending` (abort-then-settle).
const cancelledHistory: AcquisitionEvent[] = [
  ...selectedHistory([a]),
  { type: 'AcquisitionCancelled' },
];
// Cancelled with no candidate in flight — a plainly terminal state with nothing left to settle.
const cancelledNoPending: AcquisitionEvent[] = [
  ...resolvedHistory(),
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

  it('re-searches when a round yields nothing usable and rounds remain', () => {
    const events = Acquisition.fromHistory(resolvedHistory())
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'SearchRequested']);
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 2 });
  });

  it('exhausts only once the search-round budget is spent on empty rounds', () => {
    // Two prior empty rounds + this one spend the whole (explicitly pinned) three-round budget.
    const threeRounds = defaultPolicies({ retry: { maxSearchRounds: 3, maxTotalAttempts: 15 } });
    const emptyRound = (round: number): AcquisitionEvent[] => [
      { type: 'SearchCompleted', round, candidates: [] },
      { type: 'CandidatesRanked', ranked: [] },
      { type: 'SearchRequested', round: round + 1 },
    ];
    const events = Acquisition.fromHistory([
      ...resolvedHistory(threeRounds),
      ...emptyRound(1),
      ...emptyRound(2),
    ])
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'AcquisitionExhausted']);
  });

  it('re-searches when a round returns only previously-rejected candidates', () => {
    const rejected = matchingCandidate('x');
    const history: AcquisitionEvent[] = [
      ...selectedHistory([rejected]),
      { type: 'DownloadFailed', candidate: rejected.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: rejected.identity },
      { type: 'SearchRequested', round: 2 },
    ];
    const events = Acquisition.fromHistory(history)
      .execute({ type: 'RecordSearchResults', candidates: [rejected] })
      ._unsafeUnwrap();
    // The round arrived non-empty, but the ranked working set is empty — the ladder still re-searches.
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'SearchRequested']);
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 3 });
  });

  it('exhausts on an empty round when the policy allows a single round', () => {
    const oneRound = defaultPolicies({ retry: { maxSearchRounds: 1, maxTotalAttempts: 15 } });
    const events = Acquisition.fromHistory(resolvedHistory(oneRound))
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

describe('Acquisition.execute — an external validation failure revives fulfilment', () => {
  const b = matchingCandidate('b');
  const verdict = (
    candidate: { username: string; path: string; sizeBytes?: number },
    reasons: readonly string[] = [],
  ): AcquisitionCommand => ({ type: 'RecordExternalValidationFailed', candidate, reasons });

  it('rejects the fulfilled candidate and advances to the next-best candidate', () => {
    const events = Acquisition.fromHistory(fulfilledHistory([a, b]))
      .execute(verdict(a.identity, ['corrupt stub']))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'CandidateSelected',
    ]);
    expect(events[0]).toEqual({
      type: 'FulfillmentRejected',
      candidate: a.identity,
      reasons: ['corrupt stub'],
    });
    // Nothing is staged any more (the files were imported) — the rejection carries no files.
    expect(events[1]).toEqual({ type: 'CandidateRejected', candidate: a.identity, files: [] });
    const selected = events[2] as Extract<AcquisitionEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('b');
  });

  it('re-searches within bounds when the retained working set is empty', () => {
    const events = Acquisition.fromHistory(fulfilledHistory([a]))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['FulfillmentRejected', 'CandidateRejected', 'SearchRequested']);
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 2 });
  });

  it('exhausts when no candidate remains and the search budget is spent', () => {
    const oneRound = defaultPolicies({ retry: { maxSearchRounds: 1, maxTotalAttempts: 15 } });
    const events = Acquisition.fromHistory(fulfilledHistory([a], oneRound))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'AcquisitionExhausted',
    ]);
  });

  it('exhausts when the attempts budget is spent even with candidates left', () => {
    const oneAttempt = defaultPolicies({ retry: { maxSearchRounds: 3, maxTotalAttempts: 1 } });
    const events = Acquisition.fromHistory(fulfilledHistory([a, b], oneAttempt))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'AcquisitionExhausted',
    ]);
  });

  it('matches on username and path alone when the report omits sizeBytes', () => {
    const events = Acquisition.fromHistory(fulfilledHistory([a, b]))
      .execute(verdict({ username: a.identity.username, path: a.identity.path }))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'CandidateSelected',
    ]);
  });

  it('ignores a verdict naming a candidate other than the fulfilled one', () => {
    const acq = Acquisition.fromHistory(fulfilledHistory([a, b]));
    expect(acq.execute(verdict(b.identity))._unsafeUnwrap()).toEqual([]);
    expect(
      acq.execute(verdict({ ...a.identity, sizeBytes: a.identity.sizeBytes + 1 }))._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('ignores a verdict on a legacy fulfilment with no retained candidate', () => {
    expect(
      Acquisition.fromHistory(legacyFulfilledHistory).execute(verdict(a.identity))._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('ignores a verdict on absorbing terminal states', () => {
    const absorbing: AcquisitionEvent[][] = [
      [
        ...selectedHistory([a]),
        { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
        { type: 'CandidateRejected', candidate: a.identity },
        { type: 'AcquisitionExhausted' },
      ],
      cancelledHistory,
      metadataFailedHistory,
      conflictedHistory,
    ];
    for (const history of absorbing) {
      expect(Acquisition.fromHistory(history).execute(verdict(a.identity))._unsafeUnwrap()).toEqual(
        [],
      );
    }
  });

  it('ignores a redelivered verdict once the revival has occurred', () => {
    const revived = Acquisition.fromHistory([
      ...fulfilledHistory([a, b]),
      { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
      { type: 'CandidateRejected', candidate: a.identity, files: [] },
      { type: 'CandidateSelected', candidate: b },
    ]);
    expect(revived.phase).toBe('Downloading');
    expect(revived.execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
  });

  it('ignores a verdict on an acquisition that never fulfilled', () => {
    expect(Acquisition.fromHistory([]).execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
    expect(
      Acquisition.fromHistory(selectedHistory([a]))
        .execute(verdict(a.identity))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('a verdict against a re-fulfilled acquisition revives again; the old candidate stays stale', () => {
    const refulfilled = Acquisition.fromHistory([
      ...fulfilledHistory([a, b]),
      { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
      { type: 'CandidateRejected', candidate: a.identity, files: [] },
      { type: 'CandidateSelected', candidate: b },
      { type: 'DownloadCompleted', candidate: b.identity, files: sampleFiles },
      { type: 'ValidationPassed', candidate: b.identity, verdict: { confidence: 1, reasons: [] } },
      { type: 'Imported', candidate: b.identity, location: '/library/x' },
      { type: 'AcquisitionFulfilled', location: '/library/x', candidate: b.identity },
    ]);
    expect(refulfilled.phase).toBe('Fulfilled');
    // A slow verdict against the first candidate is stale — ignored.
    expect(refulfilled.execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
    // A verdict against the newly fulfilled candidate is a legitimate new judgment.
    const events = refulfilled.execute(verdict(b.identity))._unsafeUnwrap();
    expect(types(events)).toEqual(['FulfillmentRejected', 'CandidateRejected', 'SearchRequested']);
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

  const terminal = Acquisition.fromHistory(cancelledNoPending);

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

  it('rejects the pending candidate when a cancelled download settles (completed)', () => {
    const events = Acquisition.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadCompleted', files: sampleFiles })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['CandidateRejected']);
    const rejected = events[0] as Extract<AcquisitionEvent, { type: 'CandidateRejected' }>;
    expect(rejected.candidate).toEqual(a.identity);
  });

  it('rejects the pending candidate when a cancelled download settles (failed)', () => {
    const events = Acquisition.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadFailed', reason: 'Cancelled' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['CandidateRejected']);
  });

  it('ignores a duplicate settlement once the pending candidate has been rejected', () => {
    const settled = Acquisition.fromHistory([
      ...cancelledHistory,
      { type: 'CandidateRejected', candidate: a.identity },
    ]);
    expect(settled.phase).toBe('Cancelled');
    expect(
      settled.execute({ type: 'RecordDownloadFailed', reason: 'Cancelled' })._unsafeUnwrap(),
    ).toEqual([]);
  });
});

describe('Acquisition.execute — cleanup events carry the staged files (D3)', () => {
  function eventOf<T extends AcquisitionEvent['type']>(
    events: readonly AcquisitionEvent[],
    type: T,
  ): Extract<AcquisitionEvent, { type: T }> {
    const found = events.find((event) => event.type === type);
    if (found === undefined) throw new Error(`no ${type} event`);
    return found as Extract<AcquisitionEvent, { type: T }>;
  }

  it('stamps the validating candidate’s staged files onto its rejection', () => {
    const events = Acquisition.fromHistory(validatingHistory([a, matchingCandidate('b')]))
      .execute({ type: 'RecordValidationFailed', verdict: { confidence: 0, reasons: [] } })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('carries no staged files on a rejection from a download that never staged anything', () => {
    const events = Acquisition.fromHistory(selectedHistory([a, matchingCandidate('b')]))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual([]);
  });

  it('stamps an abandoned download’s already-completed files onto its rejection', () => {
    // The domain never saw a completion for the abandoned candidate; the adapter reports the partial
    // subset on the failed command, and `decide` stamps it onto the rejection for cleanup (D2).
    const events = Acquisition.fromHistory(selectedHistory([a, matchingCandidate('b')]))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled', files: sampleFiles })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('stamps an aborted candidate’s completed files onto the cancelled-settlement rejection', () => {
    const events = Acquisition.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadFailed', reason: 'Cancelled', files: sampleFiles })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('stamps the imported candidate’s staged files onto the Imported event', () => {
    const events = Acquisition.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImported', location: '/library/x' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'Imported').files).toEqual(sampleFiles);
  });

  it('stamps the staged files onto an import conflict', () => {
    const events = Acquisition.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImportConflict', location: '/library/x' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'ImportConflicted').files).toEqual(sampleFiles);
  });

  it('stamps the staged files onto a cancellation after the transfer settled', () => {
    const events = Acquisition.fromHistory(validatingHistory([a]))
      .execute({ type: 'CancelAcquisition' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'AcquisitionCancelled').files).toEqual(sampleFiles);
  });

  it('carries no files on an in-flight cancellation', () => {
    const events = Acquisition.fromHistory(selectedHistory([a]))
      .execute({ type: 'CancelAcquisition' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'AcquisitionCancelled').files).toEqual([]);
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

  it('resolves metadata for a release-group request, carrying it verbatim to the effect', () => {
    const request: AcquisitionRequest = {
      kind: 'release-group',
      mbid: 'rg-1',
      targetType: 'album',
    };
    const effects = Acquisition.fromHistory([
      { type: 'AcquisitionRequested', request, policies },
    ]).reactTo({ type: 'AcquisitionRequested', request, policies });
    expect(effects).toEqual([{ type: 'ResolveMetadata', request }]);
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
    { type: 'AcquisitionFulfilled', location: '/x' },
    // A revival needs no effect of its own: the co-emitted CandidateRejected drives cleanup, and
    // CandidateSelected/SearchRequested drive the revival's work.
    { type: 'FulfillmentRejected', candidate: a.identity, reasons: ['corrupt stub'] },
    { type: 'AcquisitionExhausted' },
  ];

  it.each(inertEvents)('emits no effect for $type', (event) => {
    expect(Acquisition.fromHistory([]).reactTo(event)).toEqual([]);
  });

  it('emits no effect for a FulfillmentRejected folded onto its revivable state', () => {
    expect(
      Acquisition.fromHistory([
        ...fulfilledHistory([a, matchingCandidate('b')]),
        { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
      ]).reactTo({ type: 'FulfillmentRejected', candidate: a.identity, reasons: [] }),
    ).toEqual([]);
  });

  it('cleans up a rejected candidate’s staged files, carried on the event (D3)', () => {
    expect(
      Acquisition.fromHistory([]).reactTo({
        type: 'CandidateRejected',
        candidate: a.identity,
        files: sampleFiles,
      }),
    ).toEqual([{ type: 'Cleanup', files: sampleFiles }]);
  });

  it('upcasts a legacy cleanup event with no carried files to an empty cleanup', () => {
    // The reactor folds the whole stream, so the post-Imported state is already Fulfilled; the
    // Cleanup keys off the event's own carried files, not folded state. A pre-D3 Imported has none.
    expect(
      Acquisition.fromHistory(legacyFulfilledHistory).reactTo({
        type: 'Imported',
        candidate: a.identity,
        location: '/library/x',
      }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('cleans up the conflicted candidate’s staged files on an import conflict', () => {
    expect(
      Acquisition.fromHistory(conflictedHistory).reactTo({
        type: 'ImportConflicted',
        location: '/library/x',
        files: sampleFiles,
      }),
    ).toEqual([{ type: 'Cleanup', files: sampleFiles }]);
  });

  it('cleans up staged files when cancelling after the transfer has settled', () => {
    const cancelledFromValidating: AcquisitionEvent[] = [
      ...validatingHistory([a]),
      { type: 'AcquisitionCancelled', files: sampleFiles },
    ];
    expect(
      Acquisition.fromHistory(cancelledFromValidating).reactTo({
        type: 'AcquisitionCancelled',
        files: sampleFiles,
      }),
    ).toEqual([{ type: 'Cleanup', files: sampleFiles }]);
  });

  it('aborts the transfer instead of cleaning up when cancelling an in-flight download', () => {
    // cancelledHistory cancels from Downloading: the transfer must first be aborted at the source;
    // staging cleanup is deferred until the resulting settlement rejects the candidate.
    expect(
      Acquisition.fromHistory(cancelledHistory).reactTo({ type: 'AcquisitionCancelled' }),
    ).toEqual([{ type: 'AbortDownload', candidate: a }]);
  });

  it('emits no effect when cancelling with no candidate in flight', () => {
    // Cancelled from Searching: neither a settled `current` nor a mid-download `pending` is kept.
    expect(
      Acquisition.fromHistory(cancelledNoPending).reactTo({ type: 'AcquisitionCancelled' }),
    ).toEqual([]);
  });

  it('re-reacting a cancellation after the pending candidate settled emits nothing', () => {
    // Redelivery guard: once the settlement's CandidateRejected clears `pending`, the folded state
    // no longer carries a candidate, so a replayed AcquisitionCancelled produces no effect.
    const settled = Acquisition.fromHistory([
      ...cancelledHistory,
      { type: 'CandidateRejected', candidate: a.identity },
    ]);
    expect(settled.reactTo({ type: 'AcquisitionCancelled' })).toEqual([]);
  });

  it('upcasts a legacy rejection with no carried files to an empty cleanup', () => {
    expect(
      Acquisition.fromHistory([]).reactTo({ type: 'CandidateRejected', candidate: a.identity }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('upcasts a legacy import conflict with no carried files to an empty cleanup', () => {
    expect(
      Acquisition.fromHistory(conflictedHistory).reactTo({
        type: 'ImportConflicted',
        location: '/library/x',
      }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('upcasts a legacy settled cancellation with no carried files to an empty cleanup', () => {
    const cancelledFromValidating: AcquisitionEvent[] = [
      ...validatingHistory([a]),
      { type: 'AcquisitionCancelled' },
    ];
    expect(
      Acquisition.fromHistory(cancelledFromValidating).reactTo({ type: 'AcquisitionCancelled' }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('emits no effect when a state-dependent event lands on a mismatched phase', () => {
    // Out-of-protocol pairings (post-state does not match the event) react to nothing.
    const empty = Acquisition.fromHistory([]);
    expect(empty.reactTo({ type: 'SearchRequested', round: 2 })).toEqual([]);
    expect(empty.reactTo({ type: 'CandidateSelected', candidate: a })).toEqual([]);
    expect(empty.reactTo({ type: 'DownloadCompleted', candidate: a.identity, files: [] })).toEqual(
      [],
    );
    expect(
      empty.reactTo({
        type: 'ValidationPassed',
        candidate: a.identity,
        verdict: { confidence: 1, reasons: [] },
      }),
    ).toEqual([]);
    expect(empty.reactTo({ type: 'ImportConflicted', location: '/x' })).toEqual([]);
    expect(empty.reactTo({ type: 'AcquisitionCancelled' })).toEqual([]);
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
    expect(Acquisition.fromHistory(legacyFulfilledHistory).phase).toBe('Fulfilled');
    expect(Acquisition.fromHistory(metadataFailedHistory).phase).toBe('MetadataFailed');
    expect(Acquisition.fromHistory(conflictedHistory).phase).toBe('Conflicted');
    expect(Acquisition.fromHistory(cancelledHistory).phase).toBe('Cancelled');
    expect(Acquisition.fromHistory(validationFailedThenSelecting).phase).toBe('Selecting');
  });

  it('reports terminal and non-terminal phases', () => {
    expect(Acquisition.fromHistory(legacyFulfilledHistory).isTerminal).toBe(true);
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

    const fulfilled = Acquisition.fromHistory(legacyFulfilledHistory).snapshot;
    expect(fulfilled.location).toBe('/library/x');
  });

  it('projects an empty acquisition with zeroed counters and no candidate or location', () => {
    const empty = Acquisition.fromHistory([]).snapshot;
    expect(empty).toEqual({
      phase: 'Empty',
      currentCandidate: undefined,
      attempts: 0,
      rejectedCount: 0,
      location: undefined,
    });
  });

  it('does not leak an in-flight candidate into a terminal snapshot', () => {
    // Cancelled from Downloading: the transfer was in flight, so the snapshot reports no candidate.
    const cancelledInFlight = Acquisition.fromHistory(cancelledHistory).snapshot;
    expect(cancelledInFlight.phase).toBe('Cancelled');
    expect(cancelledInFlight.currentCandidate).toBeUndefined();
  });

  it('retains the settled candidate and location on terminal snapshots that keep them', () => {
    const cancelledFromValidating = Acquisition.fromHistory([
      ...validatingHistory([a]),
      { type: 'AcquisitionCancelled' },
    ]).snapshot;
    expect(cancelledFromValidating.currentCandidate).toEqual(a.identity);

    const conflicted = Acquisition.fromHistory(conflictedHistory).snapshot;
    expect(conflicted.currentCandidate).toEqual(a.identity);
    expect(conflicted.location).toBe('/library/x');
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

describe('Acquisition.execute — manual edition selection', () => {
  it('pauses for a human choice when resolution reports the candidates', () => {
    const groupRequested: AcquisitionEvent[] = [
      { type: 'AcquisitionRequested', request: sampleGroupRequest, policies },
    ];
    const events = Acquisition.fromHistory(groupRequested)
      .execute({ type: 'RecordManualSelectionRequested', candidates: sampleEditionCandidates })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ManualSelectionRequested', candidates: sampleEditionCandidates },
    ]);
  });

  it('degrades an empty candidate menu to a metadata failure instead of a dead-end pause', () => {
    const groupRequested: AcquisitionEvent[] = [
      { type: 'AcquisitionRequested', request: sampleGroupRequest, policies },
    ];
    const events = Acquisition.fromHistory(groupRequested)
      .execute({ type: 'RecordManualSelectionRequested', candidates: [] })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'MetadataResolutionFailed' }]);
  });

  it('degrades a manual-selection report for a non-release-group request to a metadata failure', () => {
    // sampleRequest is a direct musicbrainz request: no resolver should pause it for selection,
    // and the domain — not the adapter — enforces that the pause is release-group-only.
    const events = Acquisition.fromHistory(requestedHistory())
      .execute({ type: 'RecordManualSelectionRequested', candidates: sampleEditionCandidates })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'MetadataResolutionFailed' }]);
  });

  it('absorbs a manual-selection report arriving on a terminal acquisition', () => {
    const cancelled = [...requestedHistory(), { type: 'AcquisitionCancelled' } as const];
    const result = Acquisition.fromHistory(cancelled).execute({
      type: 'RecordManualSelectionRequested',
      candidates: sampleEditionCandidates,
    });
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('rejects a manual-selection report outside the Pending phase', () => {
    const result = Acquisition.fromHistory(resolvedHistory()).execute({
      type: 'RecordManualSelectionRequested',
      candidates: sampleEditionCandidates,
    });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'IllegalTransition',
      command: 'RecordManualSelectionRequested',
      phase: 'Searching',
    });
  });

  it('folds the pause as a non-terminal awaiting state', () => {
    const acq = Acquisition.fromHistory(awaitingSelectionHistory());
    expect(acq.phase).toBe('AwaitingManualSelection');
    expect(acq.isTerminal).toBe(false);
  });

  it('selecting a retained candidate records the choice', () => {
    const events = Acquisition.fromHistory(awaitingSelectionHistory())
      .execute({ type: 'SelectEdition', releaseMbid: 'boot-1' })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'EditionSelected', releaseMbid: 'boot-1' }]);
  });

  it('rejects selecting an edition that is not among the retained candidates', () => {
    const acq = Acquisition.fromHistory(awaitingSelectionHistory());
    const result = acq.execute({ type: 'SelectEdition', releaseMbid: 'not-a-candidate' });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'UnknownEdition',
      releaseMbid: 'not-a-candidate',
    });
  });

  it('rejects a selection on an acquisition that is not awaiting one', () => {
    const result = Acquisition.fromHistory(resolvedHistory()).execute({
      type: 'SelectEdition',
      releaseMbid: 'boot-1',
    });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'IllegalTransition',
      command: 'SelectEdition',
      phase: 'Searching',
    });
  });

  it('rejects a selection on a terminal acquisition', () => {
    const cancelled = [...awaitingSelectionHistory(), { type: 'AcquisitionCancelled' } as const];
    const result = Acquisition.fromHistory(cancelled).execute({
      type: 'SelectEdition',
      releaseMbid: 'boot-1',
    });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'IllegalTransition',
      command: 'SelectEdition',
      phase: 'Cancelled',
    });
  });

  it('a resolved target after the selection resumes the normal flow', () => {
    const resumed = [
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: 'boot-1' } as const,
    ];
    const events = Acquisition.fromHistory(resumed)
      .execute({ type: 'RecordTarget', target: sampleTarget })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TargetResolved']);
  });

  it('cancelling while awaiting selection follows the existing cancel path', () => {
    const acq = Acquisition.fromHistory(awaitingSelectionHistory());
    const events = acq.execute({ type: 'CancelAcquisition' })._unsafeUnwrap();
    expect(events).toEqual([{ type: 'AcquisitionCancelled', files: [] }]);
  });

  it('emits no effects while awaiting selection: the acquisition pauses', () => {
    const effects = Acquisition.fromHistory(awaitingSelectionHistory()).reactTo({
      type: 'ManualSelectionRequested',
      candidates: sampleEditionCandidates,
    });
    expect(effects).toEqual([]);
  });

  it('a recorded selection resolves the chosen release directly (the resume effect)', () => {
    const resumed = [
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: 'boot-1' } as const,
    ];
    const effects = Acquisition.fromHistory(resumed).reactTo({
      type: 'EditionSelected',
      releaseMbid: 'boot-1',
    });
    expect(effects).toEqual([
      {
        type: 'ResolveMetadata',
        request: { kind: 'musicbrainz', mbid: 'boot-1', targetType: 'album' },
      },
    ]);
  });
});
