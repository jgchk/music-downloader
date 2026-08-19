import { describe, expect, it } from 'vitest';
import { Download } from './download.js';
import type { Effect } from './download.js';
import type { DownloadCommand } from './commands.js';
import type { DownloadEvent, DownloadRequest } from './events.js';
import { createRetryPolicy } from '../policy/policies.js';
import { asMbid } from '../shared/__fixtures__/mbid.js';
import { asUnit } from '../shared/__fixtures__/unit.js';
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
  startedHistory,
  validatingHistory,
} from './__fixtures__/download-fixtures.js';

const policies = defaultPolicies();

function types(events: readonly DownloadEvent[]): string[] {
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
// folded state retains no resume context and the download cannot be revived.
const legacyFulfilledHistory: DownloadEvent[] = [
  ...importingHistory([a]),
  { type: 'Imported', candidate: a.identity, location: '/library/x' },
  { type: 'DownloadFulfilled', location: '/library/x' },
];
const conflictedHistory: DownloadEvent[] = [
  ...importingHistory([a]),
  { type: 'ImportConflicted', location: '/library/x' },
];
// Cancelled mid-download: the folded Cancelled state retains `a` as `in-flight` staging (abort-then-settle).
const cancelledHistory: DownloadEvent[] = [
  ...selectedHistory([a]),
  { type: 'DownloadCancelled' },
];
// Cancelled with no candidate in flight — a plainly terminal state with nothing left to settle.
const cancelledNoPending: DownloadEvent[] = [
  ...resolvedHistory(),
  { type: 'DownloadCancelled' },
];
const metadataFailedHistory: DownloadEvent[] = [
  ...requestedHistory(),
  { type: 'MetadataResolutionFailed' },
];
// Downloading 'a' with 'b' still untried, then 'a' fails and is rejected — lands back in Selecting.
const rejectedThenSelecting: DownloadEvent[] = [
  ...selectedHistory([a, matchingCandidate('b')]),
  { type: 'TryFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
];
const validationFailedThenSelecting: DownloadEvent[] = [
  ...validatingHistory([a, matchingCandidate('b')]),
  {
    type: 'ValidationFailed',
    candidate: a.identity,
    verdict: { confidence: asUnit(0), reasons: [] },
  },
  { type: 'CandidateRejected', candidate: a.identity },
];

describe('Download.execute — submission', () => {
  it('accepts a new submission and starts the download', () => {
    const result = Download.fromHistory([]).execute({
      type: 'SubmitAcquisition',
      request: sampleRequest,
      policies,
    });
    expect(types(result._unsafeUnwrap())).toEqual(['DownloadRequested']);
  });

  it('rejects submitting onto an existing download', () => {
    const result = Download.fromHistory(resolvedHistory()).execute({
      type: 'SubmitAcquisition',
      request: sampleRequest,
      policies,
    });
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'AlreadyExists' });
  });
});

describe('Download.execute — happy path', () => {
  it('resolves metadata into a target', () => {
    const result = Download.fromHistory(requestedHistory()).execute({
      type: 'RecordTarget',
      target: sampleTarget,
    });
    expect(types(result._unsafeUnwrap())).toEqual(['TargetResolved']);
  });

  it('fails metadata resolution cleanly', () => {
    const result = Download.fromHistory(requestedHistory()).execute({
      type: 'RecordMetadataFailed',
    });
    expect(types(result._unsafeUnwrap())).toEqual(['MetadataResolutionFailed']);
  });

  it('ranks search results and selects the best candidate', () => {
    const candidates = [matchingCandidate('b'), matchingCandidate('a')];
    const events = Download.fromHistory(resolvedHistory())
      .execute({ type: 'RecordSearchResults', candidates })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'CandidateSelected']);
    const selected = events[2] as Extract<DownloadEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('a');
  });

  it('re-searches when a round yields nothing usable and rounds remain', () => {
    const events = Download.fromHistory(resolvedHistory())
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'SearchRequested']);
    // The completion numbers the round just spent, and the request the one about to start — the
    // accounting the round budget is measured against.
    expect(events[0]).toMatchObject({ type: 'SearchCompleted', round: 1 });
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 2 });
  });

  it('exhausts only once the search-round budget is spent on empty rounds', () => {
    // Two prior empty rounds + this one spend the whole (explicitly pinned) three-round budget.
    const threeRounds = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 3, maxTotalAttempts: 15 })._unsafeUnwrap(),
    });
    const emptyRound = (round: number): DownloadEvent[] => [
      { type: 'SearchCompleted', round, candidates: [] },
      { type: 'CandidatesRanked', ranked: [] },
      { type: 'SearchRequested', round: round + 1 },
    ];
    const events = Download.fromHistory([
      ...resolvedHistory(threeRounds),
      ...emptyRound(1),
      ...emptyRound(2),
    ])
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'DownloadExhausted']);
  });

  it('re-searches when a round returns only previously-rejected candidates', () => {
    const rejected = matchingCandidate('x');
    const history: DownloadEvent[] = [
      ...selectedHistory([rejected]),
      { type: 'TryFailed', candidate: rejected.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: rejected.identity },
      { type: 'SearchRequested', round: 2 },
    ];
    const events = Download.fromHistory(history)
      .execute({ type: 'RecordSearchResults', candidates: [rejected] })
      ._unsafeUnwrap();
    // The round arrived non-empty, but the ranked working set is empty — the ladder still re-searches.
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'SearchRequested']);
    // The second round's results complete round 2 — the round the history's SearchRequested asked
    // for — and the ladder then asks for round 3.
    expect(events[0]).toMatchObject({ type: 'SearchCompleted', round: 2 });
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 3 });
  });

  it('exhausts on an empty round when the policy allows a single round', () => {
    const oneRound = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 1, maxTotalAttempts: 15 })._unsafeUnwrap(),
    });
    const events = Download.fromHistory(resolvedHistory(oneRound))
      .execute({ type: 'RecordSearchResults', candidates: [] })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['SearchCompleted', 'CandidatesRanked', 'DownloadExhausted']);
  });

  it('records a completed download', () => {
    expect(
      types(
        Download.fromHistory(selectedHistory([a]))
          .execute({ type: 'RecordDownloadCompleted', files: [], candidate: a.identity })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['TryCompleted']);
  });

  it('records a passed validation', () => {
    expect(
      types(
        Download.fromHistory(validatingHistory([a]))
          .execute({
            type: 'RecordValidationPassed',
            verdict: { confidence: asUnit(1), reasons: [] },
          })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['ValidationPassed']);
  });

  it('records an import as fulfilment', () => {
    expect(
      types(
        Download.fromHistory(importingHistory([a]))
          .execute({ type: 'RecordImported', location: '/library/x' })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['Imported', 'DownloadFulfilled']);
  });

  it('reports an import conflict as a terminal outcome', () => {
    const events = Download.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImportConflict', location: '/library/x' })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['ImportConflicted']);
  });
});

describe('Download.execute — retry loop', () => {
  it('rejects a failed download and advances to the next-best candidate', () => {
    const events = Download.fromHistory(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b'), matchingCandidate('c')]),
    )
      .execute({ type: 'RecordDownloadFailed', reason: 'PeerUnavailable', candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TryFailed', 'CandidateRejected', 'CandidateSelected']);
    const selected = events[2] as Extract<DownloadEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('b');
  });

  it('rejects a failed validation and advances the walk', () => {
    const events = Download.fromHistory(
      validatingHistory([matchingCandidate('a'), matchingCandidate('b')]),
    )
      .execute({
        type: 'RecordValidationFailed',
        verdict: { confidence: asUnit(0), reasons: ['DurationMismatch'] },
      })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['ValidationFailed', 'CandidateRejected', 'CandidateSelected']);
  });

  it('requests a bounded re-search when the working set empties', () => {
    const events = Download.fromHistory(selectedHistory([matchingCandidate('a')]))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TryFailed', 'CandidateRejected', 'SearchRequested']);
  });

  it('exhausts when the working set empties and no search rounds remain', () => {
    const oneRound = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 1, maxTotalAttempts: 15 })._unsafeUnwrap(),
    });
    const events = Download.fromHistory(selectedHistory([matchingCandidate('a')], oneRound))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TryFailed', 'CandidateRejected', 'DownloadExhausted']);
  });

  it('exhausts when the total-attempts budget is spent even with candidates left', () => {
    const oneAttempt = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 3, maxTotalAttempts: 1 })._unsafeUnwrap(),
    });
    const events = Download.fromHistory(
      selectedHistory([matchingCandidate('a'), matchingCandidate('b')], oneAttempt),
    )
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TryFailed', 'CandidateRejected', 'DownloadExhausted']);
  });

  it('re-search merges fresh candidates and excludes previously-rejected ones', () => {
    const rejected = matchingCandidate('x');
    const history: DownloadEvent[] = [
      ...selectedHistory([rejected]),
      { type: 'TryFailed', candidate: rejected.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: rejected.identity },
      { type: 'SearchRequested', round: 2 },
    ];
    const events = Download.fromHistory(history)
      .execute({ type: 'RecordSearchResults', candidates: [rejected, matchingCandidate('y')] })
      ._unsafeUnwrap();
    const rankedEvent = events[1] as Extract<DownloadEvent, { type: 'CandidatesRanked' }>;
    expect(rankedEvent.ranked.map((r) => r.candidate.identity.username)).toEqual(['y']);
  });
});

describe('Download.execute — an external validation failure revives fulfilment', () => {
  const b = matchingCandidate('b');
  const verdict = (
    candidate: { username: string; path: string; sizeBytes?: number },
    reasons: readonly string[] = [],
  ): DownloadCommand => ({ type: 'RecordExternalValidationFailed', candidate, reasons });

  it('rejects the fulfilled candidate and advances to the next-best candidate', () => {
    const events = Download.fromHistory(fulfilledHistory([a, b]))
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
    const selected = events[2] as Extract<DownloadEvent, { type: 'CandidateSelected' }>;
    expect(selected.candidate.identity.username).toBe('b');
  });

  it('re-searches within bounds when the retained working set is empty', () => {
    const events = Download.fromHistory(fulfilledHistory([a]))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['FulfillmentRejected', 'CandidateRejected', 'SearchRequested']);
    expect(events[2]).toEqual({ type: 'SearchRequested', round: 2 });
  });

  it('exhausts when no candidate remains and the search budget is spent', () => {
    const oneRound = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 1, maxTotalAttempts: 15 })._unsafeUnwrap(),
    });
    const events = Download.fromHistory(fulfilledHistory([a], oneRound))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'DownloadExhausted',
    ]);
  });

  it('exhausts when the attempts budget is spent even with candidates left', () => {
    const oneAttempt = defaultPolicies({
      retry: createRetryPolicy({ maxSearchRounds: 3, maxTotalAttempts: 1 })._unsafeUnwrap(),
    });
    const events = Download.fromHistory(fulfilledHistory([a, b], oneAttempt))
      .execute(verdict(a.identity))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'DownloadExhausted',
    ]);
  });

  it('matches on username and path alone when the report omits sizeBytes', () => {
    const events = Download.fromHistory(fulfilledHistory([a, b]))
      .execute(verdict({ username: a.identity.username, path: a.identity.path }))
      ._unsafeUnwrap();
    expect(types(events)).toEqual([
      'FulfillmentRejected',
      'CandidateRejected',
      'CandidateSelected',
    ]);
  });

  it('ignores a verdict naming a candidate other than the fulfilled one', () => {
    const acq = Download.fromHistory(fulfilledHistory([a, b]));
    expect(acq.execute(verdict(b.identity))._unsafeUnwrap()).toEqual([]);
    expect(
      acq.execute(verdict({ ...a.identity, sizeBytes: a.identity.sizeBytes + 1 }))._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('ignores a verdict on a legacy fulfilment with no retained candidate', () => {
    expect(
      Download.fromHistory(legacyFulfilledHistory).execute(verdict(a.identity))._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('ignores a verdict on absorbing terminal states', () => {
    const absorbing: DownloadEvent[][] = [
      [
        ...selectedHistory([a]),
        { type: 'TryFailed', candidate: a.identity, reason: 'Stalled' },
        { type: 'CandidateRejected', candidate: a.identity },
        { type: 'DownloadExhausted' },
      ],
      cancelledHistory,
      metadataFailedHistory,
      conflictedHistory,
    ];
    for (const history of absorbing) {
      expect(Download.fromHistory(history).execute(verdict(a.identity))._unsafeUnwrap()).toEqual(
        [],
      );
    }
  });

  it('ignores a redelivered verdict once the revival has occurred', () => {
    const revived = Download.fromHistory([
      ...fulfilledHistory([a, b]),
      { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
      { type: 'CandidateRejected', candidate: a.identity, files: [] },
      { type: 'CandidateSelected', candidate: b },
    ]);
    expect(revived.phase).toBe('Downloading');
    expect(revived.execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
  });

  it('ignores a verdict on an download that never fulfilled', () => {
    expect(Download.fromHistory([]).execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
    expect(
      Download.fromHistory(selectedHistory([a]))
        .execute(verdict(a.identity))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('a verdict against a re-fulfilled download revives again; the old candidate stays stale', () => {
    const refulfilled = Download.fromHistory([
      ...fulfilledHistory([a, b]),
      { type: 'FulfillmentRejected', candidate: a.identity, reasons: [] },
      { type: 'CandidateRejected', candidate: a.identity, files: [] },
      { type: 'CandidateSelected', candidate: b },
      { type: 'TryCompleted', candidate: b.identity, files: sampleFiles },
      {
        type: 'ValidationPassed',
        candidate: b.identity,
        verdict: { confidence: asUnit(1), reasons: [] },
      },
      { type: 'Imported', candidate: b.identity, location: '/library/x' },
      { type: 'DownloadFulfilled', location: '/library/x', candidate: b.identity },
    ]);
    expect(refulfilled.phase).toBe('Fulfilled');
    // A slow verdict against the first candidate is stale — ignored.
    expect(refulfilled.execute(verdict(a.identity))._unsafeUnwrap()).toEqual([]);
    // A verdict against the newly fulfilled candidate is a legitimate new judgment.
    const events = refulfilled.execute(verdict(b.identity))._unsafeUnwrap();
    expect(types(events)).toEqual(['FulfillmentRejected', 'CandidateRejected', 'SearchRequested']);
  });
});

describe('Download.execute — cancellation and guards', () => {
  it('cancels a non-terminal download', () => {
    expect(
      types(
        Download.fromHistory(selectedHistory([a]))
          .execute({ type: 'CancelAcquisition' })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['DownloadCancelled']);
  });

  const terminal = Download.fromHistory(cancelledNoPending);

  const effectResults: DownloadCommand[] = [
    { type: 'RecordTarget', target: sampleTarget },
    { type: 'RecordMetadataFailed' },
    { type: 'RecordSearchResults', candidates: [] },
    { type: 'RecordDownloadCompleted', files: [], candidate: a.identity },
    { type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity },
    { type: 'RecordValidationPassed', verdict: { confidence: asUnit(1), reasons: [] } },
    { type: 'RecordValidationFailed', verdict: { confidence: asUnit(0), reasons: [] } },
    { type: 'RecordImported', location: '/x' },
    { type: 'RecordImportConflict', location: '/x' },
    { type: 'CancelAcquisition' },
  ];

  it.each(effectResults)('ignores a stale $type on a terminal download', (command) => {
    expect(terminal.execute(command)._unsafeUnwrap()).toEqual([]);
  });

  const pending = Download.fromHistory(requestedHistory());
  const illegalOnPending: DownloadCommand[] = [
    { type: 'RecordSearchResults', candidates: [] },
    { type: 'RecordDownloadCompleted', files: [], candidate: a.identity },
    { type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity },
    { type: 'RecordValidationPassed', verdict: { confidence: asUnit(1), reasons: [] } },
    { type: 'RecordValidationFailed', verdict: { confidence: asUnit(0), reasons: [] } },
    { type: 'RecordImported', location: '/x' },
    { type: 'RecordImportConflict', location: '/x' },
  ];

  it.each(illegalOnPending)('rejects an illegal $type while Pending', (command) => {
    expect(pending.execute(command)._unsafeUnwrapErr().kind).toBe('IllegalTransition');
  });

  it('rejects RecordTarget / RecordMetadataFailed outside the Pending phase', () => {
    const downloading = Download.fromHistory(selectedHistory([a]));
    expect(
      downloading.execute({ type: 'RecordTarget', target: sampleTarget })._unsafeUnwrapErr().kind,
    ).toBe('IllegalTransition');
    expect(downloading.execute({ type: 'RecordMetadataFailed' })._unsafeUnwrapErr().kind).toBe(
      'IllegalTransition',
    );
  });

  it('rejects the pending candidate when a cancelled download settles (completed)', () => {
    const events = Download.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadCompleted', files: sampleFiles, candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['CandidateRejected']);
    const rejected = events[0] as Extract<DownloadEvent, { type: 'CandidateRejected' }>;
    expect(rejected.candidate).toEqual(a.identity);
  });

  it('rejects the pending candidate when a cancelled download settles (failed)', () => {
    const events = Download.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadFailed', reason: 'Cancelled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['CandidateRejected']);
  });

  it('ignores a duplicate settlement once the pending candidate has been rejected', () => {
    const settled = Download.fromHistory([
      ...cancelledHistory,
      { type: 'CandidateRejected', candidate: a.identity },
    ]);
    expect(settled.phase).toBe('Cancelled');
    expect(
      settled
        .execute({ type: 'RecordDownloadFailed', reason: 'Cancelled', candidate: a.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });
});

describe('Download.execute — cleanup events carry the staged files (D3)', () => {
  function eventOf<T extends DownloadEvent['type']>(
    events: readonly DownloadEvent[],
    type: T,
  ): Extract<DownloadEvent, { type: T }> {
    const found = events.find((event) => event.type === type);
    if (found === undefined) throw new Error(`no ${type} event`);
    return found as Extract<DownloadEvent, { type: T }>;
  }

  it('stamps the validating candidate’s staged files onto its rejection', () => {
    const events = Download.fromHistory(validatingHistory([a, matchingCandidate('b')]))
      .execute({ type: 'RecordValidationFailed', verdict: { confidence: asUnit(0), reasons: [] } })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('carries no staged files on a rejection from a download that never staged anything', () => {
    const events = Download.fromHistory(selectedHistory([a, matchingCandidate('b')]))
      .execute({ type: 'RecordDownloadFailed', reason: 'Stalled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual([]);
  });

  it('stamps an abandoned download’s already-completed files onto its rejection', () => {
    // The domain never saw a completion for the abandoned candidate; the adapter reports the partial
    // subset on the failed command, and `decide` stamps it onto the rejection for cleanup (D2).
    const events = Download.fromHistory(selectedHistory([a, matchingCandidate('b')]))
      .execute({
        type: 'RecordDownloadFailed',
        reason: 'Stalled',
        files: sampleFiles,
        candidate: a.identity,
      })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('stamps an aborted candidate’s completed files onto the cancelled-settlement rejection', () => {
    const events = Download.fromHistory(cancelledHistory)
      .execute({
        type: 'RecordDownloadFailed',
        reason: 'Cancelled',
        files: sampleFiles,
        candidate: a.identity,
      })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual(sampleFiles);
  });

  it('carries no staged files when an aborted download reports none', () => {
    // The abort landed before any file completed, so the settlement's rejection names nothing to
    // clean up — an absent report is no files, never an unknown list.
    const events = Download.fromHistory(cancelledHistory)
      .execute({ type: 'RecordDownloadFailed', reason: 'Cancelled', candidate: a.identity })
      ._unsafeUnwrap();
    expect(eventOf(events, 'CandidateRejected').files).toEqual([]);
  });

  it('stamps the imported candidate’s staged files onto the Imported event', () => {
    const events = Download.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImported', location: '/library/x' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'Imported').files).toEqual(sampleFiles);
  });

  it('stamps the staged files onto an import conflict', () => {
    const events = Download.fromHistory(importingHistory([a]))
      .execute({ type: 'RecordImportConflict', location: '/library/x' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'ImportConflicted').files).toEqual(sampleFiles);
  });

  it('stamps the staged files onto a cancellation after the transfer settled', () => {
    const events = Download.fromHistory(validatingHistory([a]))
      .execute({ type: 'CancelAcquisition' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'DownloadCancelled').files).toEqual(sampleFiles);
  });

  it('carries no files on an in-flight cancellation', () => {
    const events = Download.fromHistory(selectedHistory([a]))
      .execute({ type: 'CancelAcquisition' })
      ._unsafeUnwrap();
    expect(eventOf(events, 'DownloadCancelled').files).toEqual([]);
  });
});

describe('Download.reactTo — the event → effect table', () => {
  it('resolves metadata after a request', () => {
    const acq = Download.fromHistory(requestedHistory());
    const effects = acq.reactTo({
      type: 'DownloadRequested',
      request: sampleRequest,
      policies,
    });
    expect(effects).toEqual([{ type: 'ResolveMetadata', request: sampleRequest }]);
  });

  it('resolves metadata for a release-group request, carrying it verbatim to the effect', () => {
    const request: DownloadRequest = {
      kind: 'release-group',
      mbid: asMbid('rg-1'),
      targetType: 'album',
    };
    const effects = Download.fromHistory([
      { type: 'DownloadRequested', request, policies },
    ]).reactTo({ type: 'DownloadRequested', request, policies });
    expect(effects).toEqual([{ type: 'ResolveMetadata', request }]);
  });

  it('searches after a target resolves', () => {
    const effects = Download.fromHistory(resolvedHistory()).reactTo({
      type: 'TargetResolved',
      target: sampleTarget,
    });
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 1 }]);
  });

  it('searches again on a re-search request, carrying the round', () => {
    const effects = Download.fromHistory([
      ...resolvedHistory(),
      { type: 'SearchRequested', round: 3 },
    ]).reactTo({ type: 'SearchRequested', round: 3 });
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 3 }]);
  });

  it('downloads the selected candidate with the download policy', () => {
    const candidate = matchingCandidate('a');
    const effects = Download.fromHistory(selectedHistory([candidate])).reactTo({
      type: 'CandidateSelected',
      candidate,
    });
    expect(effectTypes(effects)).toEqual(['Download']);
    expect((effects[0] as Extract<Effect, { type: 'Download' }>).candidate).toEqual(candidate);
  });

  it('validates a completed download against the target', () => {
    const effects = Download.fromHistory(validatingHistory([a])).reactTo({
      type: 'TryCompleted',
      candidate: a.identity,
      files: sampleFiles,
    });
    expect(effectTypes(effects)).toEqual(['Validate']);
  });

  it('imports validated files', () => {
    const effects = Download.fromHistory(importingHistory([a])).reactTo({
      type: 'ValidationPassed',
      candidate: a.identity,
      verdict: { confidence: asUnit(1), reasons: [] },
    });
    expect(effectTypes(effects)).toEqual(['Import']);
  });

  // Each inert event folded onto the state it legitimately occurs in — inertness against the
  // Empty state alone was vacuous, because the fold ignores out-of-phase events, so ANY event
  // reacts to nothing from Empty (S3 review sweep). The expected post-phase pins that the
  // seeded history genuinely reached the event's honest post-state before inertness is judged.
  const inertReactions: {
    event: DownloadEvent;
    history: readonly DownloadEvent[];
    postPhase: string;
  }[] = [
    {
      event: { type: 'MetadataResolutionFailed' },
      history: requestedHistory(),
      postPhase: 'MetadataFailed',
    },
    {
      event: { type: 'SearchCompleted', round: 1, candidates: [] },
      history: resolvedHistory(),
      postPhase: 'Searching',
    },
    {
      event: { type: 'CandidatesRanked', ranked: [] },
      history: [...resolvedHistory(), { type: 'SearchCompleted', round: 1, candidates: [a] }],
      postPhase: 'Selecting',
    },
    {
      event: { type: 'TryFailed', candidate: a.identity, reason: 'Stalled' },
      history: startedHistory([a]),
      postPhase: 'Downloading',
    },
    {
      event: {
        type: 'ValidationFailed',
        candidate: a.identity,
        verdict: { confidence: asUnit(0), reasons: [] },
      },
      history: validatingHistory([a]),
      postPhase: 'Validating',
    },
    {
      event: { type: 'DownloadFulfilled', location: '/x' },
      history: [
        ...importingHistory([a]),
        { type: 'Imported', candidate: a.identity, location: '/x', files: sampleFiles },
      ],
      postPhase: 'Fulfilled',
    },
    // A revival needs no effect of its own: the co-emitted CandidateRejected drives cleanup, and
    // CandidateSelected/SearchRequested drive the revival's work.
    {
      event: { type: 'FulfillmentRejected', candidate: a.identity, reasons: ['corrupt stub'] },
      history: fulfilledHistory([a, matchingCandidate('b')]),
      postPhase: 'Validating',
    },
    {
      event: { type: 'DownloadExhausted' },
      history: [
        ...resolvedHistory(),
        { type: 'SearchCompleted', round: 1, candidates: [] },
        { type: 'CandidatesRanked', ranked: [] },
      ],
      postPhase: 'Exhausted',
    },
  ];

  it.each(inertReactions)(
    'emits no effect for $event.type folded onto its reachable post-state',
    ({ event, history, postPhase }) => {
      const download = Download.fromHistory([...history, event]);
      expect(download.phase).toBe(postPhase);
      expect(download.reactTo(event)).toEqual([]);
    },
  );

  it('cleans up a rejected candidate’s staged files, carried on the event (D3)', () => {
    expect(
      Download.fromHistory([]).reactTo({
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
      Download.fromHistory(legacyFulfilledHistory).reactTo({
        type: 'Imported',
        candidate: a.identity,
        location: '/library/x',
      }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('cleans up the conflicted candidate’s staged files on an import conflict', () => {
    expect(
      Download.fromHistory(conflictedHistory).reactTo({
        type: 'ImportConflicted',
        location: '/library/x',
        files: sampleFiles,
      }),
    ).toEqual([{ type: 'Cleanup', files: sampleFiles }]);
  });

  it('cleans up staged files when cancelling after the transfer has settled', () => {
    const cancelledFromValidating: DownloadEvent[] = [
      ...validatingHistory([a]),
      { type: 'DownloadCancelled', files: sampleFiles },
    ];
    expect(
      Download.fromHistory(cancelledFromValidating).reactTo({
        type: 'DownloadCancelled',
        files: sampleFiles,
      }),
    ).toEqual([{ type: 'Cleanup', files: sampleFiles }]);
  });

  it('aborts the transfer instead of cleaning up when cancelling an in-flight download', () => {
    // cancelledHistory cancels from Downloading: the transfer must first be aborted at the source;
    // staging cleanup is deferred until the resulting settlement rejects the candidate.
    expect(
      Download.fromHistory(cancelledHistory).reactTo({ type: 'DownloadCancelled' }),
    ).toEqual([{ type: 'AbortDownload', candidate: a }]);
  });

  it('emits no effect when cancelling with no candidate in flight', () => {
    // Cancelled from Searching: staging is `none` — neither a settled nor a mid-download candidate is kept.
    expect(
      Download.fromHistory(cancelledNoPending).reactTo({ type: 'DownloadCancelled' }),
    ).toEqual([]);
  });

  it('re-reacting a cancellation after the pending candidate settled emits nothing', () => {
    // Redelivery guard: once the settlement's CandidateRejected clears `pending`, the folded state
    // no longer carries a candidate, so a replayed DownloadCancelled produces no effect.
    const settled = Download.fromHistory([
      ...cancelledHistory,
      { type: 'CandidateRejected', candidate: a.identity },
    ]);
    expect(settled.reactTo({ type: 'DownloadCancelled' })).toEqual([]);
  });

  it('upcasts a legacy rejection with no carried files to an empty cleanup', () => {
    expect(
      Download.fromHistory([]).reactTo({ type: 'CandidateRejected', candidate: a.identity }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('upcasts a legacy import conflict with no carried files to an empty cleanup', () => {
    expect(
      Download.fromHistory(conflictedHistory).reactTo({
        type: 'ImportConflicted',
        location: '/library/x',
      }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('upcasts a legacy settled cancellation with no carried files to an empty cleanup', () => {
    const cancelledFromValidating: DownloadEvent[] = [
      ...validatingHistory([a]),
      { type: 'DownloadCancelled' },
    ];
    expect(
      Download.fromHistory(cancelledFromValidating).reactTo({ type: 'DownloadCancelled' }),
    ).toEqual([{ type: 'Cleanup', files: [] }]);
  });

  it('emits no effect when a state-dependent event lands on a mismatched phase', () => {
    // Out-of-protocol pairings (post-state does not match the event) react to nothing.
    const empty = Download.fromHistory([]);
    expect(empty.reactTo({ type: 'SearchRequested', round: 2 })).toEqual([]);
    expect(empty.reactTo({ type: 'CandidateSelected', candidate: a })).toEqual([]);
    expect(empty.reactTo({ type: 'TryCompleted', candidate: a.identity, files: [] })).toEqual(
      [],
    );
    expect(
      empty.reactTo({
        type: 'ValidationPassed',
        candidate: a.identity,
        verdict: { confidence: asUnit(1), reasons: [] },
      }),
    ).toEqual([]);
    expect(empty.reactTo({ type: 'ImportConflicted', location: '/x' })).toEqual([]);
    expect(empty.reactTo({ type: 'DownloadCancelled' })).toEqual([]);
  });
});

describe('Download.fromHistory — phase, isTerminal, and the read snapshot', () => {
  it('folds each lifecycle history into the expected phase', () => {
    expect(Download.fromHistory([]).phase).toBe('Empty');
    expect(Download.fromHistory(requestedHistory()).phase).toBe('Pending');
    expect(Download.fromHistory(resolvedHistory()).phase).toBe('Searching');
    expect(Download.fromHistory(rejectedThenSelecting).phase).toBe('Selecting');
    expect(Download.fromHistory(selectedHistory([a])).phase).toBe('Downloading');
    expect(Download.fromHistory(validatingHistory([a])).phase).toBe('Validating');
    expect(Download.fromHistory(importingHistory([a])).phase).toBe('Importing');
    expect(Download.fromHistory(legacyFulfilledHistory).phase).toBe('Fulfilled');
    expect(Download.fromHistory(metadataFailedHistory).phase).toBe('MetadataFailed');
    expect(Download.fromHistory(conflictedHistory).phase).toBe('Conflicted');
    expect(Download.fromHistory(cancelledHistory).phase).toBe('Cancelled');
    expect(Download.fromHistory(validationFailedThenSelecting).phase).toBe('Selecting');
  });

  it('reports terminal and non-terminal phases', () => {
    expect(Download.fromHistory(legacyFulfilledHistory).isTerminal).toBe(true);
    expect(Download.fromHistory(conflictedHistory).isTerminal).toBe(true);
    expect(Download.fromHistory(cancelledHistory).isTerminal).toBe(true);
    expect(Download.fromHistory(metadataFailedHistory).isTerminal).toBe(true);
    expect(Download.fromHistory(selectedHistory([a])).isTerminal).toBe(false);
  });

  it('projects a read snapshot of the folded state', () => {
    const downloading = Download.fromHistory(selectedHistory([a])).snapshot;
    expect(downloading.phase).toBe('Downloading');
    expect(downloading.currentCandidate).toEqual(a.identity);
    expect(downloading.attempts).toBe(1);
    expect(downloading.rejectedCount).toBe(0);
    expect(downloading.location).toBeUndefined();

    const afterRejection = Download.fromHistory(rejectedThenSelecting).snapshot;
    expect(afterRejection.phase).toBe('Selecting');
    expect(afterRejection.currentCandidate).toBeUndefined();
    expect(afterRejection.rejectedCount).toBe(1);

    const fulfilled = Download.fromHistory(legacyFulfilledHistory).snapshot;
    expect(fulfilled.location).toBe('/library/x');
  });

  it('projects an empty download with zeroed counters and no candidate or location', () => {
    const empty = Download.fromHistory([]).snapshot;
    expect(empty).toEqual({
      phase: 'Empty',
      transferStarted: false,
      currentCandidate: undefined,
      attempts: 0,
      rejectedCount: 0,
      location: undefined,
      candidates: undefined,
    });
  });

  it('does not leak an in-flight candidate into a terminal snapshot', () => {
    // Cancelled from Downloading: the transfer was in flight, so the snapshot reports no candidate.
    const cancelledInFlight = Download.fromHistory(cancelledHistory).snapshot;
    expect(cancelledInFlight.phase).toBe('Cancelled');
    expect(cancelledInFlight.currentCandidate).toBeUndefined();
  });

  it('retains the settled candidate and location on terminal snapshots that keep them', () => {
    const cancelledFromValidating = Download.fromHistory([
      ...validatingHistory([a]),
      { type: 'DownloadCancelled' },
    ]).snapshot;
    expect(cancelledFromValidating.currentCandidate).toEqual(a.identity);

    const conflicted = Download.fromHistory(conflictedHistory).snapshot;
    expect(conflicted.currentCandidate).toEqual(a.identity);
    expect(conflicted.location).toBe('/library/x');
  });
});

describe('Download — immutability', () => {
  it('does not mutate on execute; repeated calls agree', () => {
    const acq = Download.fromHistory(selectedHistory([matchingCandidate('a')]));
    const first = acq.execute({
      type: 'RecordDownloadFailed',
      reason: 'Stalled',
      candidate: a.identity,
    });
    const second = acq.execute({
      type: 'RecordDownloadFailed',
      reason: 'Stalled',
      candidate: a.identity,
    });
    expect(types(second._unsafeUnwrap())).toEqual(types(first._unsafeUnwrap()));
    expect(acq.phase).toBe('Downloading');
    expect(acq.isTerminal).toBe(false);
  });
});

describe('Download.execute — manual edition selection', () => {
  it('pauses for a human choice when resolution reports the candidates', () => {
    const groupRequested: DownloadEvent[] = [
      { type: 'DownloadRequested', request: sampleGroupRequest, policies },
    ];
    const events = Download.fromHistory(groupRequested)
      .execute({ type: 'RecordManualSelectionRequested', candidates: sampleEditionCandidates })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ManualSelectionRequested', candidates: sampleEditionCandidates },
    ]);
  });

  it('degrades an empty candidate menu to a metadata failure instead of a dead-end pause', () => {
    const groupRequested: DownloadEvent[] = [
      { type: 'DownloadRequested', request: sampleGroupRequest, policies },
    ];
    const events = Download.fromHistory(groupRequested)
      .execute({ type: 'RecordManualSelectionRequested', candidates: [] })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'MetadataResolutionFailed' }]);
  });

  it('degrades a manual-selection report for a non-release-group request to a metadata failure', () => {
    // sampleRequest is a direct musicbrainz request: no resolver should pause it for selection,
    // and the domain — not the adapter — enforces that the pause is release-group-only.
    const events = Download.fromHistory(requestedHistory())
      .execute({ type: 'RecordManualSelectionRequested', candidates: sampleEditionCandidates })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'MetadataResolutionFailed' }]);
  });

  it('absorbs a manual-selection report arriving on a terminal download', () => {
    const cancelled = [...requestedHistory(), { type: 'DownloadCancelled' } as const];
    const result = Download.fromHistory(cancelled).execute({
      type: 'RecordManualSelectionRequested',
      candidates: sampleEditionCandidates,
    });
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('rejects a manual-selection report outside the Pending phase', () => {
    const result = Download.fromHistory(resolvedHistory()).execute({
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
    const acq = Download.fromHistory(awaitingSelectionHistory());
    expect(acq.phase).toBe('AwaitingManualSelection');
    expect(acq.isTerminal).toBe(false);
  });

  it('selecting a retained candidate records the choice', () => {
    const events = Download.fromHistory(awaitingSelectionHistory())
      .execute({ type: 'SelectEdition', releaseMbid: asMbid('boot-1') })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'EditionSelected', releaseMbid: 'boot-1' }]);
  });

  it('rejects selecting an edition that is not among the retained candidates', () => {
    const acq = Download.fromHistory(awaitingSelectionHistory());
    const result = acq.execute({ type: 'SelectEdition', releaseMbid: asMbid('not-a-candidate') });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'UnknownEdition',
      releaseMbid: 'not-a-candidate',
    });
  });

  it('rejects a selection on an download that is not awaiting one', () => {
    const result = Download.fromHistory(resolvedHistory()).execute({
      type: 'SelectEdition',
      releaseMbid: asMbid('boot-1'),
    });
    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'IllegalTransition',
      command: 'SelectEdition',
      phase: 'Searching',
    });
  });

  it('rejects a selection on a terminal download', () => {
    const cancelled = [...awaitingSelectionHistory(), { type: 'DownloadCancelled' } as const];
    const result = Download.fromHistory(cancelled).execute({
      type: 'SelectEdition',
      releaseMbid: asMbid('boot-1'),
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
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') } as const,
    ];
    const events = Download.fromHistory(resumed)
      .execute({ type: 'RecordTarget', target: sampleTarget })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TargetResolved']);
  });

  it('cancelling while awaiting selection follows the existing cancel path', () => {
    const acq = Download.fromHistory(awaitingSelectionHistory());
    const events = acq.execute({ type: 'CancelAcquisition' })._unsafeUnwrap();
    expect(events).toEqual([{ type: 'DownloadCancelled', files: [] }]);
  });

  it('emits no effects while awaiting selection: the download pauses', () => {
    const effects = Download.fromHistory(awaitingSelectionHistory()).reactTo({
      type: 'ManualSelectionRequested',
      candidates: sampleEditionCandidates,
    });
    expect(effects).toEqual([]);
  });

  it('a recorded selection resolves the chosen release directly (the resume effect)', () => {
    const resumed = [
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') } as const,
    ];
    const effects = Download.fromHistory(resumed).reactTo({
      type: 'EditionSelected',
      releaseMbid: asMbid('boot-1'),
    });
    expect(effects).toEqual([
      {
        type: 'ResolveMetadata',
        request: { kind: 'musicbrainz', mbid: 'boot-1', targetType: 'album' },
      },
    ]);
  });
});

describe('Download.execute — the downloading phase is a recorded fact', () => {
  const candidate = matchingCandidate('a');

  it('records the start once the source accepts the enqueue', () => {
    const events = Download.fromHistory(selectedHistory([candidate]))
      .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'TryStarted', candidate: candidate.identity }]);
  });

  it('absorbs a duplicate start report without appending twice', () => {
    expect(
      Download.fromHistory(startedHistory([candidate]))
        .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('absorbs a stale start report naming a candidate no longer in flight', () => {
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(selectedHistory([candidate]))
        .execute({ type: 'RecordDownloadStarted', candidate: other.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('absorbs a start report on a terminal download (the cancel won the race)', () => {
    expect(
      Download.fromHistory([...selectedHistory([candidate]), { type: 'DownloadCancelled' }])
        .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('absorbs a start report that the outcome outran (re-attach settled first)', () => {
    // The watch re-attached to already-settled transfers and its outcome landed before the
    // reactor's own start report — lawful ordering, absorbed without an event or an error.
    expect(
      Download.fromHistory(validatingHistory([candidate]))
        .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
    // The same lawful ordering one phase further on: validation has already passed and the import
    // is under way when the start report finally lands.
    expect(
      Download.fromHistory(importingHistory([candidate]))
        .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
        ._unsafeUnwrap(),
    ).toEqual([]);
    // A start report naming some OTHER candidate in that state stays a protocol violation.
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(validatingHistory([candidate]))
        .execute({ type: 'RecordDownloadStarted', candidate: other.identity })
        ._unsafeUnwrapErr(),
    ).toMatchObject({ kind: 'IllegalTransition' });
  });

  it('rejects a start report outside the downloading phase as a protocol violation', () => {
    const error = Download.fromHistory(resolvedHistory())
      .execute({ type: 'RecordDownloadStarted', candidate: candidate.identity })
      ._unsafeUnwrapErr();
    expect(error).toEqual({
      kind: 'IllegalTransition',
      command: 'RecordDownloadStarted',
      phase: 'Searching',
    });
  });
});

describe('Download.execute — asynchronous outcomes carry their candidate as the stale-guard', () => {
  const candidate = matchingCandidate('a');

  it('accepts a completion naming the candidate in flight', () => {
    const events = Download.fromHistory(startedHistory([candidate]))
      .execute({
        type: 'RecordDownloadCompleted',
        candidate: candidate.identity,
        files: sampleFiles,
      })
      ._unsafeUnwrap();
    expect(types(events)).toEqual(['TryCompleted']);
  });

  it('absorbs a completion naming a candidate no longer in flight', () => {
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(startedHistory([candidate]))
        .execute({ type: 'RecordDownloadCompleted', candidate: other.identity, files: sampleFiles })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('absorbs a failure naming a candidate no longer in flight', () => {
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(startedHistory([candidate]))
        .execute({ type: 'RecordDownloadFailed', candidate: other.identity, reason: 'Stalled' })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('a completion settles a cancelled in-flight candidate only when it names the pending one', () => {
    const cancelled = [...startedHistory([candidate]), { type: 'DownloadCancelled' } as const];
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(cancelled)
        .execute({ type: 'RecordDownloadCompleted', candidate: other.identity, files: sampleFiles })
        ._unsafeUnwrap(),
    ).toEqual([]);
    expect(
      types(
        Download.fromHistory(cancelled)
          .execute({
            type: 'RecordDownloadCompleted',
            candidate: candidate.identity,
            files: sampleFiles,
          })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['CandidateRejected']);
  });

  it('a failure settles a cancelled in-flight candidate only when it names the pending one', () => {
    const cancelled = [...startedHistory([candidate]), { type: 'DownloadCancelled' } as const];
    const other = matchingCandidate('z');
    expect(
      Download.fromHistory(cancelled)
        .execute({ type: 'RecordDownloadFailed', candidate: other.identity, reason: 'Cancelled' })
        ._unsafeUnwrap(),
    ).toEqual([]);
    expect(
      types(
        Download.fromHistory(cancelled)
          .execute({
            type: 'RecordDownloadFailed',
            candidate: candidate.identity,
            reason: 'Cancelled',
          })
          ._unsafeUnwrap(),
      ),
    ).toEqual(['CandidateRejected']);
  });
});

describe('Download.snapshot — the transfer-started decided flag', () => {
  const candidate = matchingCandidate('a');

  it('reports a live transfer once the start is recorded, and not before', () => {
    expect(Download.fromHistory(selectedHistory([candidate])).snapshot.transferStarted).toBe(
      false,
    );
    expect(Download.fromHistory(startedHistory([candidate])).snapshot.transferStarted).toBe(
      true,
    );
  });

  it('resets on a re-attempt: a later selection is a new not-yet-started transfer', () => {
    const reattempt = Download.fromHistory([
      ...startedHistory([candidate, matchingCandidate('b')]),
      { type: 'TryFailed', candidate: candidate.identity, reason: 'Stalled' },
      { type: 'CandidateRejected', candidate: candidate.identity },
      { type: 'CandidateSelected', candidate: matchingCandidate('b') },
    ]);
    expect(reattempt.snapshot.transferStarted).toBe(false);
  });

  it('reports no live transfer outside the downloading phase', () => {
    expect(Download.fromHistory(validatingHistory([candidate])).snapshot.transferStarted).toBe(
      false,
    );
  });
});

describe('Download.reactTo — TryStarted ensures the watch (level-triggered)', () => {
  const candidate = matchingCandidate('a');

  it('re-derives the download effect so a restarted process resumes the watch', () => {
    const effects = Download.fromHistory(startedHistory([candidate])).reactTo({
      type: 'TryStarted',
      candidate: candidate.identity,
    });
    expect(effectTypes(effects)).toEqual(['Download']);
    expect((effects[0] as Extract<Effect, { type: 'Download' }>).candidate).toEqual(candidate);
  });

  it('derives nothing once the download has moved past downloading', () => {
    expect(
      Download.fromHistory(validatingHistory([candidate])).reactTo({
        type: 'TryStarted',
        candidate: candidate.identity,
      }),
    ).toEqual([]);
  });
});
