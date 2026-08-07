import { describe, expect, it } from 'vitest';
import {
  APPLIED,
  AUTO_APPLIED,
  DELIVERED_CANDIDATE,
  DIRECTORY,
  FAILURE,
  HINTS,
  INCUMBENT,
  MANUAL_TAGS,
  MATCH_REVIEW,
  POLICY,
  SOURCE,
  appliedHistory,
  awaitingMatchReview,
  awaitingReviewWithCandidate,
  candidate,
  legacyIntakeReview,
  proposed,
  remediationHistory,
  requested,
  resolved,
} from './__fixtures__/import-fixtures.js';
import { asDistance } from '../shared/__fixtures__/distance.js';
import { toAcquisitionId } from '../shared/acquisition-id.js';
import type { ImportCommand } from './commands.js';
import type { CandidateReference, ImportEvent, Resolution, ResolutionKind } from './events.js';
import { Import } from './import.js';

const SUBMIT: ImportCommand = { type: 'SubmitImport', directory: DIRECTORY, policy: POLICY };
const REJECTED: ImportEvent = { type: 'ImportRejected', reason: 'gone', filesDeleted: false };

function given(events: readonly ImportEvent[]): Import {
  return Import.fromHistory(events);
}

describe('submission', () => {
  it('accepts a submission on an empty stream', () => {
    const events = given([]).execute(SUBMIT)._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ImportRequested', directory: DIRECTORY, hints: undefined, policy: POLICY },
    ]);
  });

  it('stamps hints onto the request', () => {
    const events = given([])
      .execute({ ...SUBMIT, hints: HINTS })
      ._unsafeUnwrap();
    expect(events[0]).toMatchObject({ type: 'ImportRequested', hints: HINTS });
  });

  it('stamps the acquisition source onto an event-driven request', () => {
    const events = given([])
      .execute({ ...SUBMIT, source: { acquisitionId: toAcquisitionId('acq-1') } })
      ._unsafeUnwrap();
    expect(events[0]).toMatchObject({
      type: 'ImportRequested',
      source: { acquisitionId: 'acq-1' },
    });
  });

  it('stamps the delivered candidate onto the source when the sender carried one', () => {
    const events = given([])
      .execute({ ...SUBMIT, source: SOURCE })
      ._unsafeUnwrap();
    expect(events[0]).toMatchObject({ type: 'ImportRequested', source: SOURCE });
  });

  it('converges on a duplicate submission while the import is live', () => {
    expect(given(awaitingMatchReview()).execute(SUBMIT)._unsafeUnwrap()).toEqual([]);
  });

  it('starts a fresh cycle when the prior import is terminal', () => {
    const events = given(appliedHistory()).execute(SUBMIT)._unsafeUnwrap();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ImportRequested' });
  });

  it('converges a resubmission at or before the stream watermark, even on a settled terminal', () => {
    // The seam's redelivery guarantee lives in the domain: no caller — a consumer, a redrive —
    // can duplicate a cycle for a delivery this stream already imported.
    const history = [requested({ source: { ...SOURCE, feedPosition: 7 } }), REJECTED];
    const stale = { ...SUBMIT, source: { ...SOURCE, feedPosition: 7 } };
    expect(given(history).execute(stale)._unsafeUnwrap()).toEqual([]);
  });

  it('converges a strictly earlier position too — a full feed replay is a no-op', () => {
    const history = [requested({ source: { ...SOURCE, feedPosition: 7 } }), REJECTED];
    const replayed = { ...SUBMIT, source: { ...SOURCE, feedPosition: 3 } };
    expect(given(history).execute(replayed)._unsafeUnwrap()).toEqual([]);
  });

  it('starts a fresh cycle for a later-position delivery on a settled terminal', () => {
    const history = [requested({ source: { ...SOURCE, feedPosition: 7 } }), REJECTED];
    const newer = { ...SUBMIT, source: { ...SOURCE, feedPosition: 9 } };
    const events = given(history).execute(newer)._unsafeUnwrap();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ImportRequested', source: { feedPosition: 9 } });
  });

  it('the watermark survives a manual resubmission — a later replacement still lands', () => {
    // A manual cycle carries no source; if it erased the watermark, every later delivery for
    // the acquisition would read as pre-watermark and converge — the drop this fix removes.
    const manualCycle = [
      requested({ source: { ...SOURCE, feedPosition: 5 } }),
      REJECTED,
      { type: 'ImportRequested', directory: DIRECTORY, policy: POLICY } as const,
      REJECTED,
    ];
    const stale = { ...SUBMIT, source: { ...SOURCE, feedPosition: 5 } };
    expect(given(manualCycle).execute(stale)._unsafeUnwrap()).toEqual([]);
    const newer = { ...SUBMIT, source: { ...SOURCE, feedPosition: 6 } };
    const landed = given(manualCycle).execute(newer)._unsafeUnwrap();
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ type: 'ImportRequested', source: { feedPosition: 6 } });
  });

  it('advances the watermark as a cycle carries a later position', () => {
    // Only a case where the watermark must actually MOVE says it moves. Every scenario above
    // settles at one position and probes around it, which a fold that simply kept the earlier
    // value would satisfy exactly as well — and that fold re-imports a delivery this stream has
    // already run, the duplicate the seam guarantee exists to prevent.
    const settledAtNine = [
      requested({ source: { ...SOURCE, feedPosition: 7 } }),
      REJECTED,
      requested({ source: { ...SOURCE, feedPosition: 9 } }),
      REJECTED,
    ];

    const between = { ...SUBMIT, source: { ...SOURCE, feedPosition: 8 } };

    expect(given(settledAtNine).execute(between)._unsafeUnwrap()).toEqual([]);
  });

  it('keeps the highest position a cycle carried, not the last one — the fold is a max', () => {
    // A DESCENDING history is what separates `Math.max(previous, incoming)` from a plain
    // "latest wins"; an ascending one cannot, because there the two agree. Position 7 arriving
    // after 9 must not walk the watermark backwards, or everything above 7 becomes importable a
    // second time.
    const nineThenSeven = [
      requested({ source: { ...SOURCE, feedPosition: 9 } }),
      REJECTED,
      requested({ source: { ...SOURCE, feedPosition: 7 } }),
      REJECTED,
    ];

    const between = { ...SUBMIT, source: { ...SOURCE, feedPosition: 8 } };

    expect(given(nineThenSeven).execute(between)._unsafeUnwrap()).toEqual([]);
  });

  it('still accepts a manual resubmission onto a settled sourced cycle', () => {
    // A source-less resubmission is a human asking for the directory again; the watermark guard is
    // about feed redelivery and must not swallow it. The guard reads `incoming !== undefined`
    // precisely so a manual resubmit is never compared against a watermark it has no position for.
    const settled = [requested({ source: { ...SOURCE, feedPosition: 7 } }), REJECTED];

    const events = given(settled).execute(SUBMIT)._unsafeUnwrap();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ImportRequested' });
  });

  it('refuses a NEW delivery while a cycle is in flight — the caller holds, nothing is dropped', () => {
    const live = [requested({ source: { ...SOURCE, feedPosition: 5 } })];
    const newer = { ...SUBMIT, source: { ...SOURCE, feedPosition: 8 } };
    expect(given(live).execute(newer)._unsafeUnwrapErr()).toEqual({ kind: 'CycleInFlight' });
  });

  it('refuses a sourced delivery on a live watermark-less cycle — settling decides its fate', () => {
    const live = [requested()];
    const sourced = { ...SUBMIT, source: { ...SOURCE, feedPosition: 8 } };
    expect(given(live).execute(sourced)._unsafeUnwrapErr()).toEqual({ kind: 'CycleInFlight' });
  });

  it('still converges a stale-position submission on a live cycle', () => {
    const live = [requested({ source: { ...SOURCE, feedPosition: 5 } })];
    const stale = { ...SUBMIT, source: { ...SOURCE, feedPosition: 5 } };
    expect(given(live).execute(stale)._unsafeUnwrap()).toEqual([]);
    const earlier = { ...SUBMIT, source: { ...SOURCE, feedPosition: 3 } };
    expect(given(live).execute(earlier)._unsafeUnwrap()).toEqual([]);
  });
});

describe('recording a proposal', () => {
  const record = (
    candidates: Parameters<typeof proposed>[0],
    duplicates: Parameters<typeof proposed>[1] = [],
    pinnedId?: string,
  ): ImportCommand => ({ type: 'RecordProposal', candidates, duplicates, pinnedId });

  it('auto-applies the best candidate at or under the threshold', () => {
    const strong = candidate({ distance: asDistance(0.02) });
    const weaker = candidate({
      ref: { dataSource: 'MusicBrainz', albumId: 'album-2' },
      distance: asDistance(0.4),
    });
    const events = given([requested()])
      .execute(record([weaker, strong]))
      ._unsafeUnwrap();
    expect(events).toEqual([
      {
        type: 'CandidatesProposed',
        candidates: [weaker, strong],
        duplicates: [],
        pinnedId: undefined,
      },
      { type: 'AutoApplySelected', ref: strong.ref, distance: asDistance(0.02) },
    ]);
    // Order-independent: the best candidate wins from either position.
    const reversed = given([requested()])
      .execute(record([strong, weaker]))
      ._unsafeUnwrap();
    expect(reversed[1]).toMatchObject({ type: 'AutoApplySelected', ref: strong.ref });
  });

  it('keeps the earliest of two equally-distant candidates — ties do not reorder', () => {
    // `bestOf` re-derives the winner rather than trusting input order, and on a tie it must keep
    // the one beets ranked first. A strictly-better comparison says that; an at-least-as-good one
    // silently promotes the LAST tied candidate, which makes the chosen match depend on the order
    // a proposal happened to arrive in.
    const first = candidate({ distance: asDistance(0.05) });
    const tied = candidate({
      ref: { dataSource: 'MusicBrainz', albumId: 'album-tied' },
      distance: asDistance(0.05),
    });

    const events = given([requested()])
      .execute(record([first, tied]))
      ._unsafeUnwrap();

    expect(events[1]).toMatchObject({ type: 'AutoApplySelected', ref: first.ref });
  });

  it('auto-applies a candidate exactly at the threshold — the boundary is inclusive', () => {
    // POLICY.autoApplyThreshold is 0.1; distance == threshold is NOT `> threshold`, so it auto-applies.
    const atThreshold = candidate({ distance: asDistance(0.1) });
    const events = given([requested()])
      .execute(record([atThreshold]))
      ._unsafeUnwrap();
    expect(events[1]).toEqual({
      type: 'AutoApplySelected',
      ref: atThreshold.ref,
      distance: asDistance(0.1),
    });
  });

  it('routes a weak match to review with the best candidate named', () => {
    const weak = candidate({ distance: asDistance(0.6) });
    const events = given([requested()])
      .execute(record([weak]))
      ._unsafeUnwrap();
    expect(events[1]).toEqual({
      type: 'ReviewRequired',
      cause: { kind: 'match-review', hinted: false, best: weak.ref },
    });
  });

  it('marks a hint-contradicted weak match as hinted, carrying the hinted release id (D4)', () => {
    const weak = candidate({ distance: asDistance(0.6) });
    const events = given([requested({ hints: HINTS })])
      .execute(record([weak]))
      ._unsafeUnwrap();
    expect(events[1]).toMatchObject({
      cause: { kind: 'match-review', hinted: true, hintedReleaseId: HINTS.mbReleaseId },
    });
  });

  it('marks a pinned re-proposal as hinted via the supplied id', () => {
    const history = [
      ...awaitingMatchReview(),
      resolved({ kind: 'supply-id', mbReleaseId: 'mb-2' }),
    ];
    const events = given(history)
      .execute(record([candidate({ distance: asDistance(0.6) })]))
      ._unsafeUnwrap();
    expect(events[1]).toMatchObject({
      cause: { kind: 'match-review', hinted: true, hintedReleaseId: 'mb-2' },
    });
  });

  it('marks the proposal hinted when the interpreter reports the pinned id', () => {
    const events = given([requested()])
      .execute(record([candidate({ distance: asDistance(0.6) })], [], 'mb-9'))
      ._unsafeUnwrap();
    expect(events[0]).toMatchObject({ type: 'CandidatesProposed', pinnedId: 'mb-9' });
    expect(events[1]).toMatchObject({ cause: { hinted: true, hintedReleaseId: 'mb-9' } });
  });

  it('routes no candidates to a no-match review, distinct from low confidence', () => {
    const events = given([requested()]).execute(record([]))._unsafeUnwrap();
    expect(events[1]).toEqual({ type: 'ReviewRequired', cause: { kind: 'no-match' } });
  });

  it('routes a strong match with an incumbent to duplicate review, never auto-replace', () => {
    const events = given([requested()])
      .execute(record([candidate({ distance: asDistance(0.01) })], [INCUMBENT]))
      ._unsafeUnwrap();
    expect(events[1]).toEqual({
      type: 'ReviewRequired',
      cause: { kind: 'duplicate-review', incumbents: [INCUMBENT] },
    });
  });

  it('drops a stale proposal after the stream moved on', () => {
    expect(
      given(appliedHistory())
        .execute(record([candidate()]))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });
});

describe('recording an apply outcome', () => {
  it('lands applied cleanly when nothing failed', () => {
    const history = [requested(), proposed([candidate()]), AUTO_APPLIED];
    const events = given(history)
      .execute({ type: 'RecordApplied', location: '/library/A', failures: [] })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'ImportApplied', location: '/library/A' }]);
  });

  it('lands applied with a remediation review when enrichment failed (D7)', () => {
    const history = [requested(), proposed([candidate()]), AUTO_APPLIED];
    const events = given(history)
      .execute({ type: 'RecordApplied', location: '/library/A', failures: [FAILURE] })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ImportApplied', location: '/library/A' },
      { type: 'RemediationRequired', failures: [FAILURE] },
    ]);
  });

  it('accepts the outcome of an enrichment retry', () => {
    const history = [...remediationHistory(), resolved({ kind: 'retry-enrichment' })];
    const events = given(history)
      .execute({ type: 'RecordApplied', location: '/library/A', failures: [] })
      ._unsafeUnwrap();
    expect(events).toEqual([{ type: 'ImportApplied', location: '/library/A' }]);
  });

  it('re-opens remediation when a human-requested enrichment retry fails enrichment again', () => {
    // remediation was open, the human asked for retry-enrichment (status → retrying), and the
    // re-apply still reports failures: re-record the apply and re-open the remediation review.
    const history = [...remediationHistory(), resolved({ kind: 'retry-enrichment' })];
    const events = given(history)
      .execute({ type: 'RecordApplied', location: '/library/A', failures: [FAILURE] })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ImportApplied', location: '/library/A' },
      { type: 'RemediationRequired', failures: [FAILURE] },
    ]);
  });

  it('drops a stale apply outcome', () => {
    expect(
      given([requested()])
        .execute({ type: 'RecordApplied', location: '/library/A', failures: [] })
        ._unsafeUnwrap(),
    ).toEqual([]);
    expect(
      given(appliedHistory())
        .execute({ type: 'RecordApplied', location: '/library/A', failures: [] })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('routes an apply-time duplicate skip to duplicate review', () => {
    const history = [requested(), proposed([candidate()]), AUTO_APPLIED];
    const events = given(history)
      .execute({ type: 'RecordApplySkippedDuplicate', incumbents: [INCUMBENT] })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ReviewRequired', cause: { kind: 'duplicate-review', incumbents: [INCUMBENT] } },
    ]);
  });

  it('drops a stale duplicate-skip outcome', () => {
    expect(
      given(appliedHistory())
        .execute({ type: 'RecordApplySkippedDuplicate', incumbents: [] })
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('dooms an apply-time duplicate skip that names no incumbent (nothing to review)', () => {
    // A skipped-duplicate with an empty incumbents list is contradictory: it must not become an
    // empty, meaningless duplicate review, and must not strand the import in `applying`.
    const history = [requested(), proposed([candidate()]), AUTO_APPLIED];
    const events = given(history)
      .execute({ type: 'RecordApplySkippedDuplicate', incumbents: [] })
      ._unsafeUnwrap();
    expect(events).toEqual([
      {
        type: 'ImportRejected',
        reason: 'beets skipped the apply as a duplicate but reported no incumbent',
        filesDeleted: false,
      },
    ]);
  });
});

describe('resolving a review', () => {
  const resolve = (resolution: Parameters<typeof resolved>[0]): ImportCommand => ({
    type: 'ResolveReview',
    resolution: (resolved(resolution) as Extract<ImportEvent, { type: 'ReviewResolved' }>)
      .resolution,
  });

  it('rejects a resolution for an unknown import', () => {
    expect(
      given([])
        .execute(resolve({ kind: 'import-as-is' }))
        ._unsafeUnwrapErr(),
    ).toEqual({
      kind: 'UnknownImport',
    });
  });

  it('rejects a resolution before any review exists', () => {
    expect(
      given([requested()])
        .execute(resolve({ kind: 'import-as-is' }))
        ._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NoOpenReview' });
  });

  it.each([
    { kind: 'apply-candidate', ref: candidate({ distance: asDistance(0.5) }).ref },
    { kind: 'supply-id', mbReleaseId: 'mb-2' },
    { kind: 'refresh-candidates' },
    { kind: 'manual-tags', tags: MANUAL_TAGS },
    { kind: 'import-as-is' },
    { kind: 'reject', reason: 'not this album' },
  ] as const)('accepts $kind against an open match review', (resolution) => {
    const events = given(awaitingMatchReview()).execute(resolve(resolution))._unsafeUnwrap();
    expect(events).toEqual([{ type: 'ReviewResolved', resolution }]);
  });

  it('refuses to apply a candidate that was never proposed', () => {
    const error = given(awaitingMatchReview())
      .execute(
        resolve({ kind: 'apply-candidate', ref: { dataSource: 'Discogs', albumId: 'nope' } }),
      )
      ._unsafeUnwrapErr();
    expect(error).toEqual({ kind: 'UnknownCandidate', candidate: 'Discogs:nope' });
  });

  it('refuses to apply any candidate at all on a review that listed none', () => {
    // A no-match review has an empty list, so every reference is unknown to it — there is nothing
    // for `apply-candidate` to name.
    const noMatchReview: ImportEvent[] = [
      requested(),
      proposed([]),
      { type: 'ReviewRequired', cause: { kind: 'no-match' } },
    ];

    const error = given(noMatchReview)
      .execute(
        resolve({
          kind: 'apply-candidate',
          ref: { dataSource: 'MusicBrainz', albumId: 'album-1' },
        }),
      )
      ._unsafeUnwrapErr();

    expect(error).toEqual({ kind: 'UnknownCandidate', candidate: 'MusicBrainz:album-1' });
  });

  it('applies the candidate a human picked out of several listed ones', () => {
    // The ordinary shape of a match review: beets offers a shortlist and the human names one of
    // them. Recognising a reference must mean "this list contains it", not "this list is all it".
    const runnerUp = candidate({
      ref: { dataSource: 'MusicBrainz', albumId: 'album-2' },
      distance: asDistance(0.6),
    });
    const shortlist: ImportEvent[] = [
      requested(),
      proposed([candidate({ distance: asDistance(0.5) }), runnerUp]),
      MATCH_REVIEW,
    ];
    const resolution = { kind: 'apply-candidate', ref: runnerUp.ref } as const;

    const events = given(shortlist).execute(resolve(resolution))._unsafeUnwrap();

    expect(events).toEqual([{ type: 'ReviewResolved', resolution }]);
  });

  // Both remediation verbs, not just the first: they are refused by one condition, and a row per
  // verb is what says the condition covers the pair rather than only the one that got written down.
  it.each(['accept', 'retry-enrichment'] as const)(
    'refuses %s on a non-remediation review, naming the verb and the review it belongs to',
    (kind) => {
      const error = given(awaitingMatchReview()).execute(resolve({ kind }))._unsafeUnwrapErr();

      expect(error.kind).toBe('InvalidResolution');
      // The detail is the only thing separating this refusal from its mirror image below, so it
      // has to identify both sides: what was asked, and the review that cannot take it.
      const detail = 'detail' in error ? error.detail : '';
      expect(detail).toContain(kind);
      expect(detail).toContain('match-review');
    },
  );

  it('mints the release verdict beside the rejection on reject-unusable-delivery', () => {
    const resolution = {
      kind: 'reject-unusable-delivery',
      reasons: ['corrupt rip', 'transcode'],
    } as const;
    const events = given(awaitingReviewWithCandidate())
      .execute(resolve(resolution))
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ReviewResolved', resolution },
      {
        type: 'ReleaseVerdictRecorded',
        acquisitionId: SOURCE.acquisitionId,
        candidate: DELIVERED_CANDIDATE,
        reasons: ['corrupt rip', 'transcode'],
      },
    ]);
  });

  it('defaults the verdict reasons to an empty list when none are given', () => {
    const events = given(awaitingReviewWithCandidate())
      .execute(resolve({ kind: 'reject-unusable-delivery' }))
      ._unsafeUnwrap();
    expect(events[1]).toMatchObject({ type: 'ReleaseVerdictRecorded', reasons: [] });
  });

  it('refuses reject-unusable-delivery without a retained candidate', () => {
    // A manual import has no source at all; a legacy intake import has a source but no candidate.
    expect(
      given(awaitingMatchReview())
        .execute(resolve({ kind: 'reject-unusable-delivery' }))
        ._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NoRetainedCandidate' });
    expect(
      given(legacyIntakeReview())
        .execute(resolve({ kind: 'reject-unusable-delivery' }))
        ._unsafeUnwrapErr(),
    ).toEqual({ kind: 'NoRetainedCandidate' });
  });

  it('resolves a plain reject on a legacy intake review normally', () => {
    // The candidate-less refusal above is verb-specific: the same review still takes the plain
    // reject, so a legacy import is never wedged behind the verb it cannot honour.
    expect(
      given(legacyIntakeReview())
        .execute(resolve({ kind: 'reject' }))
        ._unsafeUnwrap(),
    ).toEqual([{ type: 'ReviewResolved', resolution: { kind: 'reject' } }]);
  });

  it('no-ops a redelivered reject-unusable-delivery of a settled review', () => {
    const history = [
      ...awaitingReviewWithCandidate(),
      resolved({ kind: 'reject-unusable-delivery' }),
    ];
    expect(
      given(history)
        .execute(resolve({ kind: 'reject-unusable-delivery' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('no-ops a redelivered resolution of a settled review', () => {
    const history = [...awaitingMatchReview(), resolved({ kind: 'reject' })];
    expect(
      given(history)
        .execute(resolve({ kind: 'reject' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('no-ops while a prior resolution is still in motion', () => {
    const reProposing = [...awaitingMatchReview(), resolved({ kind: 'refresh-candidates' })];
    expect(
      given(reProposing)
        .execute(resolve({ kind: 'import-as-is' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
    const applying = [requested(), proposed([candidate()]), AUTO_APPLIED];
    expect(
      given(applying)
        .execute(resolve({ kind: 'import-as-is' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
    const rejectedHistory = [...awaitingMatchReview(), resolved({ kind: 'reject' }), REJECTED];
    expect(
      given(rejectedHistory)
        .execute(resolve({ kind: 'import-as-is' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });

  it('resolves an open remediation with accept or retry-enrichment only', () => {
    expect(
      given(remediationHistory())
        .execute(resolve({ kind: 'accept' }))
        ._unsafeUnwrap(),
    ).toEqual([{ type: 'ReviewResolved', resolution: { kind: 'accept' } }]);
    expect(
      given(remediationHistory())
        .execute(resolve({ kind: 'retry-enrichment' }))
        ._unsafeUnwrap(),
    ).toEqual([{ type: 'ReviewResolved', resolution: { kind: 'retry-enrichment' } }]);

    const error = given(remediationHistory())
      .execute(resolve({ kind: 'import-as-is' }))
      ._unsafeUnwrapErr();

    expect(error.kind).toBe('InvalidResolution');
    // The mirror of the refusal above, and told apart from it only by this detail: it names the
    // verb that was offered and the two this review does take.
    const detail = 'detail' in error ? error.detail : '';
    expect(detail).toContain('import-as-is');
    expect(detail).toContain('accept');
    expect(detail).toContain('retry-enrichment');
  });

  it('no-ops a resolution on an applied import without an open remediation', () => {
    expect(
      given(appliedHistory())
        .execute(resolve({ kind: 'accept' }))
        ._unsafeUnwrap(),
    ).toEqual([]);
  });
});

describe('recording rejection outcomes', () => {
  it('records the rejection with the deletion marker after intake was cleaned', () => {
    const history = [...awaitingMatchReview(), resolved({ kind: 'reject', reason: 'wrong rip' })];
    const events = given(history).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap();
    expect(events).toEqual([{ type: 'ImportRejected', reason: 'wrong rip', filesDeleted: true }]);
  });

  it('defaults the rejection reason when none was given', () => {
    const history = [...awaitingMatchReview(), resolved({ kind: 'reject' })];
    const events = given(history).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap();
    expect(events[0]).toMatchObject({ reason: 'rejected by review' });
  });

  it('records the rejection with joined reasons after a reject-unusable-delivery', () => {
    const history = [
      ...awaitingReviewWithCandidate(),
      resolved({ kind: 'reject-unusable-delivery', reasons: ['corrupt rip', 'transcode'] }),
    ];
    const events = given(history).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ImportRejected', reason: 'corrupt rip; transcode', filesDeleted: true },
    ]);
  });

  it('defaults the rejection reason when the unusable-delivery verb carried no reasons', () => {
    const history = [
      ...awaitingReviewWithCandidate(),
      resolved({ kind: 'reject-unusable-delivery' }),
    ];
    const events = given(history).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap();
    expect(events[0]).toMatchObject({ reason: 'rejected by review' });
  });

  it('drops an intake-deletion report when the review settled on a non-rejecting verb', () => {
    const history = [...awaitingMatchReview(), resolved({ kind: 'accept' })];
    expect(given(history).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap()).toEqual([]);
  });

  it('drops a stale intake-deletion report', () => {
    expect(
      given(awaitingMatchReview()).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap(),
    ).toEqual([]);
    expect(given([requested()]).execute({ type: 'RecordIntakeDeleted' })._unsafeUnwrap()).toEqual(
      [],
    );
  });

  it('dooms a live import with its reason, files untouched', () => {
    const events = given([requested()])
      .execute({ type: 'RecordDoomed', reason: 'intake directory vanished' })
      ._unsafeUnwrap();
    expect(events).toEqual([
      { type: 'ImportRejected', reason: 'intake directory vanished', filesDeleted: false },
    ]);
  });

  it('drops a doom report on empty or terminal streams', () => {
    expect(given([]).execute({ type: 'RecordDoomed', reason: 'x' })._unsafeUnwrap()).toEqual([]);
    expect(
      given(appliedHistory()).execute({ type: 'RecordDoomed', reason: 'x' })._unsafeUnwrap(),
    ).toEqual([]);
  });
});

describe('react — the reflex', () => {
  it('fires Propose with the hints on ImportRequested', () => {
    const request = requested({ hints: HINTS });
    expect(given([request]).reactTo(request)).toEqual([
      {
        type: 'Propose',
        directory: DIRECTORY,
        searchId: HINTS.mbReleaseId,
        searchArtist: HINTS.artist,
        searchAlbum: HINTS.album,
      },
    ]);
  });

  it('fires Propose without pins on an unhinted request', () => {
    expect(given([requested()]).reactTo(requested())).toEqual([
      {
        type: 'Propose',
        directory: DIRECTORY,
        searchId: undefined,
        searchArtist: undefined,
        searchAlbum: undefined,
      },
    ]);
  });

  it('fires Apply on AutoApplySelected', () => {
    const history = [requested(), proposed([candidate()]), AUTO_APPLIED];
    expect(given(history).reactTo(AUTO_APPLIED)).toEqual([
      {
        type: 'Apply',
        directory: DIRECTORY,
        mode: { kind: 'candidate', ref: candidate().ref },
      },
    ]);
  });

  it('fires nothing for AutoApplySelected against a mismatched state', () => {
    expect(given([]).reactTo(AUTO_APPLIED)).toEqual([]);
  });

  it('fires Apply for each apply verb once resolved', () => {
    for (const resolution of [
      resolved({ kind: 'import-as-is' }),
      resolved({ kind: 'apply-candidate', ref: candidate().ref }),
      resolved({ kind: 'manual-tags', tags: MANUAL_TAGS }),
    ]) {
      const history = [...awaitingMatchReview(), resolution];
      const effects = given(history).reactTo(resolution);
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ type: 'Apply', directory: DIRECTORY });
    }
  });

  it('fires nothing for an apply verb against a mismatched state', () => {
    expect(given([]).reactTo(resolved({ kind: 'import-as-is' }))).toEqual([]);
  });

  it('fires a pinned Propose on supply-id', () => {
    const resolution = resolved({ kind: 'supply-id', mbReleaseId: 'mb-2' });
    const history = [...awaitingMatchReview(), resolution];
    expect(given(history).reactTo(resolution)).toEqual([
      { type: 'Propose', directory: DIRECTORY, searchId: 'mb-2' },
    ]);
  });

  it('fires nothing for supply-id against a mismatched state', () => {
    expect(given([]).reactTo(resolved({ kind: 'supply-id', mbReleaseId: 'mb-2' }))).toEqual([]);
  });

  it('fires a fresh Propose on refresh-candidates', () => {
    const resolution = resolved({ kind: 'refresh-candidates' });
    const history = [...awaitingMatchReview(), resolution];
    expect(given(history).reactTo(resolution)).toEqual([{ type: 'Propose', directory: DIRECTORY }]);
  });

  it('fires nothing for refresh-candidates against a mismatched state', () => {
    expect(given([]).reactTo(resolved({ kind: 'refresh-candidates' }))).toEqual([]);
  });

  it('fires DeleteIntake on reject — the queue owns intake hygiene', () => {
    const resolution = resolved({ kind: 'reject' });
    const history = [...awaitingMatchReview(), resolution];
    expect(given(history).reactTo(resolution)).toEqual([
      { type: 'DeleteIntake', directory: DIRECTORY },
    ]);
  });

  it('fires nothing for reject against a mismatched state', () => {
    expect(given([]).reactTo(resolved({ kind: 'reject' }))).toEqual([]);
  });

  it('fires DeleteIntake on reject-unusable-delivery — same hygiene as reject', () => {
    const resolution = resolved({ kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] });
    const history = [...awaitingReviewWithCandidate(), resolution];
    expect(given(history).reactTo(resolution)).toEqual([
      { type: 'DeleteIntake', directory: DIRECTORY },
    ]);
    expect(given([]).reactTo(resolution)).toEqual([]);
  });

  it('fires nothing on ReleaseVerdictRecorded — the publisher consumes it, not the reactor', () => {
    const verdict = {
      type: 'ReleaseVerdictRecorded',
      acquisitionId: SOURCE.acquisitionId,
      candidate: DELIVERED_CANDIDATE,
      reasons: [],
    } as const;
    const history = [
      ...awaitingReviewWithCandidate(),
      resolved({ kind: 'reject-unusable-delivery' }),
      verdict,
    ];
    expect(given(history).reactTo(verdict)).toEqual([]);
  });

  it('fires an in-place Apply at the library location on retry-enrichment', () => {
    const resolution = resolved({ kind: 'retry-enrichment' });
    const history = [...remediationHistory(), resolution];
    expect(given(history).reactTo(resolution)).toEqual([
      {
        type: 'Apply',
        directory: '/library/Artist/Album',
        mode: { kind: 'candidate', ref: candidate().ref },
      },
    ]);
  });

  it('fires nothing for retry-enrichment against a mismatched state', () => {
    expect(given([]).reactTo(resolved({ kind: 'retry-enrichment' }))).toEqual([]);
  });

  it('fires nothing for a retry-enrichment no retry is actually in flight for', () => {
    // The in-place apply re-runs beets over files already in the library, so it may only fire while
    // a retry is genuinely in flight. A redelivered resolution landing on an applied import with no
    // open remediation — or on one whose remediation is still open, nobody having asked for the
    // retry — must not re-import the library location behind the operator's back.
    const resolution = resolved({ kind: 'retry-enrichment' });

    expect(given(appliedHistory()).reactTo(resolution)).toEqual([]);
    expect(given(remediationHistory()).reactTo(resolution)).toEqual([]);
  });

  it('fires nothing on accept', () => {
    const resolution = resolved({ kind: 'accept' });
    expect(given([...remediationHistory(), resolution]).reactTo(resolution)).toEqual([]);
  });

  it('fires nothing for record-only events', () => {
    const agg = given(appliedHistory());
    expect(agg.reactTo(proposed([]))).toEqual([]);
    expect(agg.reactTo(MATCH_REVIEW)).toEqual([]);
    expect(agg.reactTo(APPLIED)).toEqual([]);
    expect(agg.reactTo({ type: 'RemediationRequired', failures: [FAILURE] })).toEqual([]);
    expect(agg.reactTo(REJECTED)).toEqual([]);
  });
});

describe('the snapshot projection', () => {
  it('exposes nothing but the phase for an empty stream', () => {
    expect(given([]).snapshot).toEqual({
      phase: 'empty',
      directory: undefined,
      location: undefined,
      openReview: undefined,
      rejection: undefined,
    });
  });

  it('exposes the open review with its carried candidates', () => {
    const snapshot = given(awaitingMatchReview()).snapshot;
    expect(snapshot.openReview).toEqual({
      cause: { kind: 'match-review', hinted: false, best: candidate().ref },
      candidates: [candidate({ distance: asDistance(0.5) })],
      // A match review with candidates but no retained delivered candidate: every verb but the
      // retry (no candidate to re-verdict).
      availableActions: [
        'apply-candidate',
        'supply-id',
        'refresh-candidates',
        'manual-tags',
        'import-as-is',
        'reject',
      ],
    });
  });

  it('carries a candidate’s field-level diff evidence through the fold', () => {
    const enriched = candidate({
      distance: asDistance(0.5),
      tracks: [
        {
          path: `${DIRECTORY}/01 Track.flac`,
          title: 'Track',
          index: 1,
          current: { title: 'Trakk', artist: 'Artist', track: 1, length: 200 },
          distance: asDistance(0.2),
        },
      ],
      extraItems: [{ path: `${DIRECTORY}/99 Extra.flac`, title: 'Extra', track: 9 }],
      missingTracks: [{ title: 'Absent', index: 2 }],
      albumFields: {
        year: 2020,
        media: 'CD',
        label: 'Label',
        catalognum: 'CAT1',
        country: 'US',
        albumDisambig: 'deluxe',
      },
    });
    const snapshot = given([requested(), proposed([enriched]), MATCH_REVIEW]).snapshot;
    expect(snapshot.openReview?.candidates).toEqual([enriched]);
  });

  it('hides the review once settled', () => {
    const snapshot = given([...awaitingMatchReview(), resolved({ kind: 'reject' })]).snapshot;
    expect(snapshot.openReview).toBeUndefined();
  });

  it('exposes an open remediation as a remediation review, with nothing to choose between', () => {
    const snapshot = given(remediationHistory()).snapshot;
    expect(snapshot.phase).toBe('applied');
    // A remediation review is about what failed after the files landed, so it carries the failures
    // and an empty candidate list — a queue that showed candidates here would be offering a choice
    // this review does not have.
    expect(snapshot.openReview).toEqual({
      cause: { kind: 'remediation-review', failures: [FAILURE] },
      candidates: [],
      availableActions: ['accept', 'retry-enrichment'],
    });
  });

  it('hides a remediation while its retry is in flight', () => {
    const snapshot = given([
      ...remediationHistory(),
      resolved({ kind: 'retry-enrichment' }),
    ]).snapshot;
    expect(snapshot.openReview).toBeUndefined();
  });

  it('exposes the library location once applied', () => {
    const snapshot = given(appliedHistory()).snapshot;
    expect(snapshot.location).toBe('/library/Artist/Album');
    expect(snapshot.openReview).toBeUndefined();
  });

  it('exposes the rejection outcome', () => {
    const snapshot = given([
      ...awaitingMatchReview(),
      resolved({ kind: 'reject' }),
      REJECTED,
    ]).snapshot;
    expect(snapshot.rejection).toEqual({ reason: 'gone', filesDeleted: false });
  });

  it('reports phase and terminality', () => {
    const agg = given(appliedHistory());
    expect(agg.phase).toBe('applied');
    expect(agg.isTerminal).toBe(true);
  });
});

describe('the open review’s available actions', () => {
  const noMatchReview: ImportEvent[] = [
    requested(),
    proposed([]),
    { type: 'ReviewRequired', cause: { kind: 'no-match' } },
  ];
  const duplicateReview: ImportEvent[] = [
    requested(),
    proposed([candidate({ distance: asDistance(0.01) })], [INCUMBENT]),
    { type: 'ReviewRequired', cause: { kind: 'duplicate-review', incumbents: [INCUMBENT] } },
  ];

  // Each review kind's curated verb set, one row per kind so a broken curation names its own kind.
  it.each([
    // match-review, candidates present, no retained delivered candidate: no reject-and-retry.
    [
      'match-review without a retained candidate',
      awaitingMatchReview(),
      [
        'apply-candidate',
        'supply-id',
        'refresh-candidates',
        'manual-tags',
        'import-as-is',
        'reject',
      ],
    ],
    // no-match has no candidates, so apply-candidate is withheld.
    [
      'no-match',
      noMatchReview,
      ['supply-id', 'refresh-candidates', 'manual-tags', 'import-as-is', 'reject'],
    ],
    // duplicate-review offers a narrow, curated set (apply present — candidates exist).
    ['duplicate-review', duplicateReview, ['apply-candidate', 'reject']],
    // a remediation review permits exactly its own two verbs.
    ['remediation-review', remediationHistory(), ['accept', 'retry-enrichment']],
  ] as const)('curates %s to exactly its permitted verbs', (_label, history, expected) => {
    expect(given(history).snapshot.openReview?.availableActions).toEqual(expected);
  });

  it('joins reject-unusable-delivery when a delivered candidate is retained', () => {
    expect(given(awaitingReviewWithCandidate()).snapshot.openReview?.availableActions).toContain(
      'reject-unusable-delivery',
    );
  });

  // A minimal valid resolution for a verb, so the cross-check exercises the real `decide` path.
  const resolutionFor = (kind: ResolutionKind, reference: CandidateReference): Resolution => {
    switch (kind) {
      case 'apply-candidate': {
        return { kind, ref: reference };
      }
      case 'supply-id': {
        return { kind, mbReleaseId: 'mb-2' };
      }
      case 'manual-tags': {
        return { kind, tags: MANUAL_TAGS };
      }
      case 'reject': {
        return { kind, reason: 'no' };
      }
      case 'reject-unusable-delivery': {
        return { kind, reasons: ['bad rip'] };
      }
      case 'refresh-candidates':
      case 'import-as-is':
      case 'accept':
      case 'retry-enrichment': {
        return { kind };
      }
    }
  };

  it('never lists a verb `decide` would refuse (cross-checked against the decider)', () => {
    const reviews: readonly ImportEvent[][] = [
      awaitingMatchReview(),
      awaitingReviewWithCandidate(),
      noMatchReview,
      duplicateReview,
      remediationHistory(),
    ];
    for (const history of reviews) {
      const aggregate = given(history);
      const review = aggregate.snapshot.openReview;
      expect(review).toBeDefined();
      const listedReference = review?.candidates[0]?.ref ?? {
        dataSource: 'MusicBrainz',
        albumId: 'x',
      };
      const actions = review?.availableActions ?? [];
      for (const verb of actions) {
        const outcome = aggregate.execute({
          type: 'ResolveReview',
          resolution: resolutionFor(verb, listedReference),
        });
        // `decide` accepts every listed verb — a refusal (any Err) would be a lie in the set.
        expect(outcome.isOk(), `decide refused a listed verb: ${verb}`).toBe(true);
      }
    }
  });
});
