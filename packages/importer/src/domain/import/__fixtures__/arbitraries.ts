import fc from 'fast-check';
import { asDistance } from '../../shared/__fixtures__/distance.js';
import { toAcquisitionId } from '../../shared/acquisition-id.js';
import { assertNonEmpty } from '../../shared/non-empty-array.js';
import type { NonEmptyReadonlyArray } from '../../shared/non-empty-array.js';
import { toPositiveInt } from '../../shared/positive-int.js';
import type { ImportCommand, ImportCommandType } from '../commands.js';
import type {
  ApplyFailure,
  CandidateReference,
  DuplicateIncumbent,
  ImportEvent,
  ImportEventType,
  ImportHints,
  ImportPolicy,
  ImportSource,
  ManualTags,
  ProposedCandidate,
  Resolution,
  ResolutionKind,
  ReviewCause,
} from '../events.js';
import type { ImportState } from '../state.js';

/**
 * Generators for the import decider's property suites (decider-properties D1, task 3.1).
 *
 * The shape mirrors the acquisition suite in the other context deliberately — blind arbitraries
 * over the closed unions for the totality properties, state-directed advancing steps so the deep
 * phases are reachable, and exhaustive `Record` maps so a new command, event, or resolution verb is
 * a compile error here rather than a silent gap. Where this aggregate genuinely differs, the
 * difference is called out in a comment rather than smoothed over: `applied` and `rejected` are
 * terminal for the *files* but not absorbing for the *stream* (a re-deposited directory starts a
 * fresh cycle), and the review carries a settled-but-owed state the acquisition ladder has no
 * analogue for.
 *
 * Test support: under `__fixtures__`, so outside the build and outside the coverage denominator.
 */

// --- Ground values ----------------------------------------------------------------------------

export const arbDirectory: fc.Arbitrary<string> = fc.constantFrom(
  '/intake/Fugazi - Repeater',
  '/intake/Slint - Spiderland',
);

/** A tiny reference pool: identity collisions are what the known-candidate guard turns on. */
export const arbCandidateReference: fc.Arbitrary<CandidateReference> = fc.record({
  dataSource: fc.constantFrom('MusicBrainz', 'Discogs'),
  albumId: fc.constantFrom('album-1', 'album-2', 'album-3'),
});

/**
 * Distances spread across the auto-apply threshold, exactly on it included: `>` is the routing
 * comparison, so the boundary value is the one that decides between auto-apply and review.
 */
export const arbDistance = fc.constantFrom(0, 0.05, 0.1, 0.4, 1).map((value) => asDistance(value));

export const arbCandidate: fc.Arbitrary<ProposedCandidate> = fc.record({
  ref: arbCandidateReference,
  artist: fc.constantFrom('Fugazi', 'Slint'),
  album: fc.constantFrom('Repeater', 'Spiderland'),
  distance: arbDistance,
  penalties: fc.array(fc.record({ name: fc.constantFrom('tracks', 'year'), amount: arbDistance }), {
    maxLength: 2,
  }),
  tracks: fc.array(
    fc.record({
      path: fc.constantFrom('/intake/01.flac', '/intake/02.flac'),
      title: fc.constantFrom('Turnover', 'Repeater'),
      index: fc.constantFrom(1, 2),
    }),
    { maxLength: 2 },
  ),
});

/** Proposals including the empty one — an empty candidate list is the `no-match` route. */
export const arbCandidates: fc.Arbitrary<readonly ProposedCandidate[]> = fc.array(arbCandidate, {
  maxLength: 3,
});

export const arbIncumbent: fc.Arbitrary<DuplicateIncumbent> = fc.record({
  artist: fc.constantFrom('Fugazi'),
  album: fc.constantFrom('Repeater'),
  path: fc.constantFrom('/library/Fugazi/Repeater'),
});

export const arbIncumbents: fc.Arbitrary<readonly DuplicateIncumbent[]> = fc.array(arbIncumbent, {
  maxLength: 2,
});

export const arbFailure: fc.Arbitrary<ApplyFailure> = fc.record({
  stage: fc.constantFrom('import-pipeline', 'fetchart'),
  message: fc.constantFrom('timed out', 'no cover found'),
});

export const arbFailures: fc.Arbitrary<readonly ApplyFailure[]> = fc.array(arbFailure, {
  maxLength: 2,
});

const arbNonEmptyFailures: fc.Arbitrary<NonEmptyReadonlyArray<ApplyFailure>> = fc
  .array(arbFailure, { minLength: 1, maxLength: 2 })
  .map((failures) => assertNonEmpty(failures));

const arbNonEmptyIncumbents: fc.Arbitrary<NonEmptyReadonlyArray<DuplicateIncumbent>> = fc
  .array(arbIncumbent, { minLength: 1, maxLength: 2 })
  .map((incumbents) => assertNonEmpty(incumbents));

export const arbPolicy: fc.Arbitrary<ImportPolicy> = fc
  .constantFrom(0, 0.1, 0.5)
  .map((threshold) => ({ autoApplyThreshold: asDistance(threshold) }));

export const arbHints: fc.Arbitrary<ImportHints> = fc.record(
  {
    mbReleaseId: fc.constantFrom('mb-release-1', 'mb-release-2'),
    artist: fc.constantFrom('Fugazi'),
    album: fc.constantFrom('Repeater'),
  },
  { requiredKeys: [] },
);

/**
 * Submission provenance. `feedPosition` drives the seam watermark, so the pool is small and
 * overlapping — a redelivery at or before the watermark and a genuinely new delivery past it are
 * the two cases the idempotence guard has to tell apart.
 */
export const arbSource: fc.Arbitrary<ImportSource> = fc.record(
  {
    acquisitionId: fc.constantFrom('acq-1', 'acq-2').map((id) => toAcquisitionId(id)),
    candidate: fc.record(
      {
        username: fc.constantFrom('peer-a', 'peer-b'),
        path: fc.constantFrom('peer-a/Repeater [FLAC]'),
        sizeBytes: fc.constantFrom(1000, 2000),
      },
      { requiredKeys: ['username', 'path'] },
    ),
    feedPosition: fc.integer({ min: 1, max: 4 }),
  },
  { requiredKeys: ['acquisitionId'] },
);

const arbManualTags: fc.Arbitrary<ManualTags> = fc
  .record(
    {
      albumArtist: fc.constantFrom('Fugazi'),
      album: fc.constantFrom('Repeater'),
      year: fc.constantFrom(1990),
      trackTitles: fc.array(fc.constantFrom('Turnover', 'Repeater'), {
        minLength: 1,
        maxLength: 2,
      }),
    },
    { requiredKeys: ['albumArtist', 'album', 'trackTitles'] },
  )
  .map(({ albumArtist, album, year, trackTitles }) => ({
    albumArtist,
    album,
    year,
    tracks: assertNonEmpty(
      trackTitles.map((title, index) => ({
        path: `/intake/0${String(index + 1)}.flac`,
        title,
        trackNumber: toPositiveInt(index + 1),
      })),
    ),
  }));

/**
 * One arbitrary per resolution verb. The verb set is what `decide` routes on — review verbs vs
 * remediation verbs vs the two rejections — so an unhandled new verb must not slip through.
 */
export const resolutionArbitraryByKind: {
  readonly [K in ResolutionKind]: fc.Arbitrary<Extract<Resolution, { kind: K }>>;
} = {
  'apply-candidate': fc.record(
    {
      kind: fc.constant('apply-candidate' as const),
      ref: arbCandidateReference,
      duplicateAction: fc.constantFrom('replace' as const, 'keep-both' as const),
    },
    { requiredKeys: ['kind', 'ref'] },
  ),
  'supply-id': fc.record({
    kind: fc.constant('supply-id' as const),
    mbReleaseId: fc.constantFrom('mb-release-1', 'mb-release-9'),
  }),
  'refresh-candidates': fc.constant({ kind: 'refresh-candidates' as const }),
  'manual-tags': fc.record({ kind: fc.constant('manual-tags' as const), tags: arbManualTags }),
  'import-as-is': fc.constant({ kind: 'import-as-is' as const }),
  reject: fc.record(
    { kind: fc.constant('reject' as const), reason: fc.constantFrom('not the right release') },
    { requiredKeys: ['kind'] },
  ),
  'reject-unusable-delivery': fc.record(
    {
      kind: fc.constant('reject-unusable-delivery' as const),
      reasons: fc.array(fc.constantFrom('transcode', 'wrong album'), { maxLength: 2 }),
    },
    { requiredKeys: ['kind'] },
  ),
  accept: fc.constant({ kind: 'accept' as const }),
  'retry-enrichment': fc.constant({ kind: 'retry-enrichment' as const }),
};

export const arbResolution: fc.Arbitrary<Resolution> = fc.oneof(
  ...Object.values(resolutionArbitraryByKind),
);

const arbReviewCause: fc.Arbitrary<ReviewCause> = fc.oneof(
  fc.record(
    {
      kind: fc.constant('match-review' as const),
      hinted: fc.boolean(),
      hintedReleaseId: fc.constantFrom('mb-release-1'),
      best: arbCandidateReference,
    },
    { requiredKeys: ['kind', 'hinted', 'best'] },
  ),
  fc.constant({ kind: 'no-match' as const }),
  fc.record({
    kind: fc.constant('duplicate-review' as const),
    incumbents: arbNonEmptyIncumbents,
  }),
  fc.record({
    kind: fc.constant('remediation-review' as const),
    failures: arbNonEmptyFailures,
  }),
);

// --- Blind event arbitraries (the `evolve` adversary) ------------------------------------------

/**
 * One arbitrary per event variant. Two compile-time guards: the `Record` key set rejects a missing
 * generator, and the `Extract` value type rejects one filed under the wrong key. The completeness
 * property in the suite is the runtime belt to those braces.
 */
export const eventArbitraryByType: {
  readonly [K in ImportEventType]: fc.Arbitrary<Extract<ImportEvent, { type: K }>>;
} = {
  ImportRequested: fc.record(
    {
      type: fc.constant('ImportRequested' as const),
      directory: arbDirectory,
      hints: arbHints,
      policy: arbPolicy,
      source: arbSource,
    },
    { requiredKeys: ['type', 'directory', 'policy'] },
  ),
  CandidatesProposed: fc.record(
    {
      type: fc.constant('CandidatesProposed' as const),
      candidates: arbCandidates,
      duplicates: arbIncumbents,
      pinnedId: fc.constantFrom('mb-release-1'),
    },
    { requiredKeys: ['type', 'candidates', 'duplicates'] },
  ),
  AutoApplySelected: fc.record({
    type: fc.constant('AutoApplySelected' as const),
    ref: arbCandidateReference,
    distance: arbDistance,
  }),
  ReviewRequired: fc.record({
    type: fc.constant('ReviewRequired' as const),
    cause: arbReviewCause,
  }),
  ReviewResolved: fc.record({
    type: fc.constant('ReviewResolved' as const),
    resolution: arbResolution,
  }),
  ImportApplied: fc.record({
    type: fc.constant('ImportApplied' as const),
    location: fc.constantFrom('/library/Fugazi/Repeater', '/library/Slint/Spiderland'),
  }),
  RemediationRequired: fc.record({
    type: fc.constant('RemediationRequired' as const),
    failures: arbNonEmptyFailures,
  }),
  ImportRejected: fc.record({
    type: fc.constant('ImportRejected' as const),
    reason: fc.constantFrom('rejected by review', 'doomed'),
    filesDeleted: fc.boolean(),
  }),
  ReleaseVerdictRecorded: fc.record({
    type: fc.constant('ReleaseVerdictRecorded' as const),
    acquisitionId: fc.constantFrom('acq-1').map((id) => toAcquisitionId(id)),
    candidate: fc.record({
      username: fc.constantFrom('peer-a'),
      path: fc.constantFrom('peer-a/Repeater [FLAC]'),
    }),
    reasons: fc.array(fc.constantFrom('transcode'), { maxLength: 1 }),
  }),
};

/** Every event variant, uniformly — the adversary `evolve` must stay total against. */
export const arbEvent: fc.Arbitrary<ImportEvent> = fc.oneof(...Object.values(eventArbitraryByType));

/** An arbitrary (mostly out-of-protocol) history: the fold's worst case. */
export const arbEventHistory: fc.Arbitrary<readonly ImportEvent[]> = fc.array(arbEvent, {
  maxLength: 12,
});

// --- Command steps ------------------------------------------------------------------------------

/** A generated command, shaped against the state it will run on. */
export type CommandStep = (state: ImportState) => ImportCommand;

/**
 * One arbitrary per command variant, same drift guard as {@link eventArbitraryByType}. None of
 * these reads the state — they are the blind adversary for the totality properties.
 */
export const blindStepArbitraryByCommandType: {
  readonly [K in ImportCommandType]: fc.Arbitrary<
    (state: ImportState) => Extract<ImportCommand, { type: K }>
  >;
} = {
  SubmitImport: fc
    .record(
      { directory: arbDirectory, hints: arbHints, policy: arbPolicy, source: arbSource },
      { requiredKeys: ['directory', 'policy'] },
    )
    .map((command) => () => ({ type: 'SubmitImport', ...command })),
  RecordProposal: fc
    .record(
      { candidates: arbCandidates, duplicates: arbIncumbents, pinnedId: fc.constantFrom('mb-1') },
      { requiredKeys: ['candidates', 'duplicates'] },
    )
    .map((command) => () => ({ type: 'RecordProposal', ...command })),
  RecordApplied: fc
    .tuple(fc.constantFrom('/library/Fugazi/Repeater'), arbFailures)
    .map(([location, failures]) => () => ({ type: 'RecordApplied', location, failures })),
  RecordApplySkippedDuplicate: arbIncumbents.map((incumbents) => () => ({
    type: 'RecordApplySkippedDuplicate',
    incumbents,
  })),
  RecordIntakeDeleted: fc.constant(() => ({ type: 'RecordIntakeDeleted' as const })),
  RecordDoomed: fc
    .constantFrom('beets exited non-zero', 'intake vanished')
    .map((reason) => () => ({ type: 'RecordDoomed', reason })),
  ResolveReview: arbResolution.map((resolution) => () => ({ type: 'ResolveReview', resolution })),
};

export const arbBlindCommandStep: fc.Arbitrary<CommandStep> = fc.oneof(
  ...Object.values(blindStepArbitraryByCommandType),
);

/**
 * The lawful next move from whatever phase the import is in — what makes `applying`, `applied`,
 * and the remediation review reachable at all. The `awaiting-review` arm picks a resolution from
 * the *listed* candidates most of the time (so `apply-candidate` is usually known) and from the
 * open pool otherwise (so `UnknownCandidate` still gets exercised).
 */
export const arbAdvancingStep: fc.Arbitrary<CommandStep> = fc
  .record({
    directory: arbDirectory,
    hints: arbHints,
    policy: arbPolicy,
    source: fc.option(arbSource, { nil: undefined }),
    candidates: arbCandidates,
    duplicates: arbIncumbents,
    failures: arbFailures,
    incumbents: arbIncumbents,
    location: fc.constantFrom('/library/Fugazi/Repeater'),
    resolution: arbResolution,
    reason: fc.constantFrom('beets exited non-zero'),
    branch: fc.integer({ min: 0, max: 5 }),
    useListedCandidate: fc.boolean(),
  })
  .map((draw): CommandStep => {
    return (state) => {
      switch (state.phase) {
        case 'empty':
        case 'rejected': {
          return {
            type: 'SubmitImport',
            directory: draw.directory,
            hints: draw.hints,
            policy: draw.policy,
            source: draw.source,
          };
        }
        case 'requested':
        case 'proposing': {
          return {
            type: 'RecordProposal',
            candidates: draw.candidates,
            duplicates: draw.duplicates,
          };
        }
        case 'awaiting-review': {
          // Point `apply-candidate` at a candidate this review actually listed, most of the time.
          const listed = state.candidates[draw.branch % Math.max(state.candidates.length, 1)];
          const resolution: Resolution =
            listed !== undefined && draw.useListedCandidate
              ? { kind: 'apply-candidate', ref: listed.ref }
              : draw.resolution;
          // A settled rejection owes only the intake deletion; anything else converges.
          return state.settled === undefined
            ? { type: 'ResolveReview', resolution }
            : { type: 'RecordIntakeDeleted' };
        }
        case 'applying': {
          if (draw.branch === 0) {
            return { type: 'RecordApplySkippedDuplicate', incumbents: draw.incumbents };
          }
          if (draw.branch === 1) return { type: 'RecordDoomed', reason: draw.reason };
          return { type: 'RecordApplied', location: draw.location, failures: draw.failures };
        }
        case 'applied': {
          // An open remediation resolves through its own two verbs; otherwise the files are done
          // and only a fresh submission can start another cycle.
          if (state.remediation?.status === 'open') {
            return {
              type: 'ResolveReview',
              resolution: draw.branch === 0 ? { kind: 'accept' } : { kind: 'retry-enrichment' },
            };
          }
          if (state.remediation?.status === 'retrying') {
            return { type: 'RecordApplied', location: draw.location, failures: draw.failures };
          }
          return {
            type: 'SubmitImport',
            directory: draw.directory,
            hints: draw.hints,
            policy: draw.policy,
            source: draw.source,
          };
        }
      }
    };
  });

/** Mostly lawful moves so the lifecycle gets deep, salted with blind ones for the guards. */
export const arbCommandSequence: fc.Arbitrary<readonly CommandStep[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbAdvancingStep },
    { weight: 1, arbitrary: arbBlindCommandStep },
  ),
  { minLength: 1, maxLength: 20 },
);
