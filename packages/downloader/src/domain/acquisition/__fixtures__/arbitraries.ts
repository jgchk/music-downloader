import fc from 'fast-check';
import type { Candidate, CandidateIdentity } from '../../candidate/candidate.js';
import type { AcquisitionPolicies } from '../../policy/policies.js';
import {
  DEFAULT_DOWNLOAD_POLICY,
  createMatchPolicy,
  createRetryPolicy,
} from '../../policy/policies.js';
import { DEFAULT_QUALITY_POLICY } from '../../policy/quality-policy.js';
import { rankCandidates } from '../../ranking/ranking.js';
import { asCandidateIdentity } from '../../shared/__fixtures__/candidate-identity.js';
import { asMbid } from '../../shared/__fixtures__/mbid.js';
import { asUnit } from '../../shared/__fixtures__/unit.js';
import { createTarget } from '../../target/target.js';
import type { Target } from '../../target/target.js';
import type { ValidationReason, ValidationVerdict } from '../../validation/verdict.js';
import type { AcquisitionCommand, AcquisitionCommandType } from '../commands.js';
import type {
  AcquisitionEvent,
  AcquisitionEventType,
  AcquisitionRequest,
  DownloadFailureReason,
  DownloadedFile,
  EditionCandidate,
} from '../events.js';
import type { AcquisitionState } from '../state.js';

/**
 * Generators for the acquisition decider's property suites (decider-properties D1).
 *
 * Two deliberately different registers live here, and the difference is the whole design:
 *
 * - **Blind** arbitraries ({@link arbEvent}, {@link arbBlindCommandStep}) draw uniformly from the
 *   closed command/event unions with no regard for the state they land on. They are the adversary
 *   for the totality properties — `evolve` must fold *any* event onto *any* state, and `decide`
 *   must answer *any* command with a `Result`, including the out-of-protocol pairings a corrupt or
 *   externally-edited history can produce.
 * - **Advancing** arbitraries ({@link arbAdvancingStep}) read the state they are applied to and
 *   choose a command that is lawful there. Without them a uniform draw would spend almost every
 *   run bouncing off `IllegalTransition` in `Pending`, and the reachable-state invariants would
 *   hold *vacuously* — the classic way a property suite becomes decorative. `phasesTouched` exists
 *   to prove that did not happen: the invariant suite asserts every phase was actually visited.
 *
 * Both unions are covered by exhaustive `Record<…Type, …>` maps, so adding a command or event
 * variant without a generator is a compile error here (design "generator drift" risk) rather than
 * a silent hole in the sweep.
 *
 * Test support: under `__fixtures__`, so outside the build and outside the coverage denominator.
 */

// --- Ground values ----------------------------------------------------------------------------

/**
 * The album every generated candidate is scored against. One fixed target (rather than a generated
 * one) is what lets candidates be built to *match* it — ranking is a gate, so a generated target no
 * candidate could match would leave the working set permanently empty and the ladder unreachable.
 */
export const arbitraryTarget: Target = createTarget({
  type: 'album',
  artist: 'Fugazi',
  title: 'Repeater',
  year: 1990,
  tracks: [
    { position: 1, title: 'Turnover', durationMs: 279_000 },
    { position: 2, title: 'Repeater', durationMs: 182_000 },
  ],
})._unsafeUnwrap();

/** A second, unrelated target: resolving to it strands the candidates matched to the first. */
export const otherTarget: Target = createTarget({
  type: 'track',
  artist: 'Slint',
  title: 'Good Morning, Captain',
  tracks: [{ position: 1, title: 'Good Morning, Captain', durationMs: 461_000 }],
})._unsafeUnwrap();

export const arbTarget: fc.Arbitrary<Target> = fc.constantFrom(arbitraryTarget, otherTarget);

/**
 * A small identity pool (3 peers x 2 paths x 2 sizes = 12 identities). Deliberately small: the
 * rejected-set, the dedupe, and the late-report guards are all keyed on identity, so collisions
 * across a generated sequence are the interesting case, and a wide-open string generator would
 * make them vanishingly rare.
 */
export const arbCandidateIdentity: fc.Arbitrary<CandidateIdentity> = fc
  .record({
    username: fc.constantFrom('peer-a', 'peer-b', 'peer-c'),
    path: fc.constantFrom('Repeater (1990) [FLAC]', 'repeater-v0'),
    sizeBytes: fc.constantFrom(1000, 2000),
  })
  .map((input) => asCandidateIdentity(input));

/** Files mirroring {@link arbitraryTarget}: lossless and structurally aligned, so they clear the gate. */
const matchingFiles = arbitraryTarget.tracks.map((track) => ({
  name: `${String(track.position).padStart(2, '0')} ${track.title}.flac`,
  sizeBytes: 1,
  codec: 'flac',
  durationMs: track.durationMs,
}));

/** A lossy, structurally wrong fileset: it exists to be gated *out* by ranking. */
const mismatchedFiles = [{ name: 'unknown.mp3', sizeBytes: 1, codec: 'mp3', bitrate: 128_000 }];

export const arbCandidate: fc.Arbitrary<Candidate> = fc.record({
  identity: arbCandidateIdentity,
  files: fc.oneof(
    { weight: 4, arbitrary: fc.constant(matchingFiles) },
    { weight: 1, arbitrary: fc.constant(mismatchedFiles) },
    { weight: 1, arbitrary: fc.constant([]) },
  ),
  source: fc.record({
    speedBytesPerSec: fc.constantFrom(10, 100),
    freeSlots: fc.constantFrom(0, 1),
    queueLength: fc.constantFrom(0, 5),
  }),
});

/** A search round's haul, empty rounds included — an empty round is a real, budget-spending outcome. */
export const arbCandidates: fc.Arbitrary<readonly Candidate[]> = fc.array(arbCandidate, {
  maxLength: 3,
});

export const arbDownloadedFiles: fc.Arbitrary<readonly DownloadedFile[]> = fc.array(
  fc
    .constantFrom('01.flac', '02.flac')
    .map((name) => ({ path: `/staging/repeater/${name}`, name })),
  { maxLength: 2 },
);

const arbDownloadFailureReason: fc.Arbitrary<DownloadFailureReason> = fc.constantFrom(
  'PeerUnavailable',
  'Stalled',
  'QueueTimeout',
  'TransferError',
  'FileUnavailable',
  'Cancelled',
);

const arbValidationReason: fc.Arbitrary<ValidationReason> = fc.constantFrom(
  'Unplayable',
  'WrongTrackCount',
  'DurationMismatch',
  'RecordingMismatch',
  'QualityNotAuthentic',
);

export const arbVerdict: fc.Arbitrary<ValidationVerdict> = fc.record({
  confidence: fc.constantFrom(0, 0.5, 1).map((value) => asUnit(value)),
  reasons: fc.array(arbValidationReason, { maxLength: 2 }),
});

/** Edition menus, empty included: an empty menu is the guard `decide` degrades to a failure. */
export const arbEditionCandidates: fc.Arbitrary<readonly EditionCandidate[]> = fc.array(
  fc.record(
    {
      releaseMbid: fc.constantFrom('edition-1', 'edition-2', 'edition-3').map((id) => asMbid(id)),
      title: fc.constantFrom('Repeater', 'Repeater + 3 Songs'),
      trackCount: fc.constantFrom(0, 12),
    },
    { requiredKeys: ['releaseMbid'] },
  ),
  { maxLength: 3 },
);

export const arbRequest: fc.Arbitrary<AcquisitionRequest> = fc.oneof(
  fc.record({
    kind: fc.constant('musicbrainz' as const),
    mbid: fc.constantFrom('release-1', 'release-2').map((id) => asMbid(id)),
    targetType: fc.constantFrom('album' as const, 'track' as const),
  }),
  fc.record({
    kind: fc.constant('release-group' as const),
    mbid: fc.constantFrom('group-1', 'group-2').map((id) => asMbid(id)),
    targetType: fc.constant('album' as const),
  }),
  fc.record(
    {
      kind: fc.constant('descriptor' as const),
      targetType: fc.constantFrom('album' as const, 'track' as const),
      artist: fc.constantFrom('Fugazi', 'Slint'),
      title: fc.constantFrom('Repeater', 'Spiderland'),
      album: fc.constantFrom('Repeater'),
    },
    { requiredKeys: ['kind', 'targetType', 'artist', 'title'] },
  ),
);

/**
 * Policies with *small* retry budgets. The budgets are the termination guarantee, so generating
 * realistic (15-attempt) ones would push every run past the sequence length and leave the exhaustion
 * edge untested; 1-3 attempts reaches it inside a handful of steps.
 */
export const arbPolicies: fc.Arbitrary<AcquisitionPolicies> = fc
  .record({
    maxSearchRounds: fc.integer({ min: 1, max: 3 }),
    maxTotalAttempts: fc.integer({ min: 1, max: 3 }),
    threshold: fc.constantFrom(0, 0.5, 0.9),
  })
  .map(({ maxSearchRounds, maxTotalAttempts, threshold }) => ({
    quality: DEFAULT_QUALITY_POLICY,
    match: createMatchPolicy(threshold)._unsafeUnwrap(),
    retry: createRetryPolicy({ maxSearchRounds, maxTotalAttempts })._unsafeUnwrap(),
    download: DEFAULT_DOWNLOAD_POLICY,
  }));

// --- Blind event arbitraries (the `evolve` adversary) ------------------------------------------

/**
 * One arbitrary per event variant. The `Record` key set is the compile-time drift guard (a new
 * variant without a generator does not typecheck); that each generator actually produces its own
 * key's variant is pinned at runtime by the completeness property in the suite.
 */
export const eventArbitraryByType: {
  readonly [K in AcquisitionEventType]: fc.Arbitrary<AcquisitionEvent>;
} = {
  AcquisitionRequested: fc.record({
    type: fc.constant('AcquisitionRequested' as const),
    request: arbRequest,
    policies: arbPolicies,
  }),
  TargetResolved: fc.record({ type: fc.constant('TargetResolved' as const), target: arbTarget }),
  MetadataResolutionFailed: fc.constant({ type: 'MetadataResolutionFailed' as const }),
  ManualSelectionRequested: fc.record({
    type: fc.constant('ManualSelectionRequested' as const),
    candidates: arbEditionCandidates,
  }),
  EditionSelected: fc.record({
    type: fc.constant('EditionSelected' as const),
    releaseMbid: fc.constantFrom('edition-1', 'edition-9').map((id) => asMbid(id)),
  }),
  SearchRequested: fc.record({
    type: fc.constant('SearchRequested' as const),
    round: fc.integer({ min: 1, max: 4 }),
  }),
  SearchCompleted: fc.record({
    type: fc.constant('SearchCompleted' as const),
    round: fc.integer({ min: 1, max: 4 }),
    candidates: arbCandidates,
  }),
  CandidatesRanked: fc.record({
    type: fc.constant('CandidatesRanked' as const),
    ranked: arbCandidates.map((candidates) =>
      rankCandidates(
        candidates,
        arbitraryTarget,
        DEFAULT_QUALITY_POLICY,
        createMatchPolicy(0.5)._unsafeUnwrap(),
      ),
    ),
  }),
  CandidateSelected: fc.record({
    type: fc.constant('CandidateSelected' as const),
    candidate: arbCandidate,
  }),
  DownloadStarted: fc.record({
    type: fc.constant('DownloadStarted' as const),
    candidate: arbCandidateIdentity,
  }),
  DownloadCompleted: fc.record({
    type: fc.constant('DownloadCompleted' as const),
    candidate: arbCandidateIdentity,
    files: arbDownloadedFiles,
  }),
  DownloadFailed: fc.record({
    type: fc.constant('DownloadFailed' as const),
    candidate: arbCandidateIdentity,
    reason: arbDownloadFailureReason,
  }),
  CandidateRejected: fc.record(
    {
      type: fc.constant('CandidateRejected' as const),
      candidate: arbCandidateIdentity,
      files: arbDownloadedFiles,
    },
    { requiredKeys: ['type', 'candidate'] },
  ),
  ValidationPassed: fc.record({
    type: fc.constant('ValidationPassed' as const),
    candidate: arbCandidateIdentity,
    verdict: arbVerdict,
  }),
  ValidationFailed: fc.record({
    type: fc.constant('ValidationFailed' as const),
    candidate: arbCandidateIdentity,
    verdict: arbVerdict,
  }),
  Imported: fc.record(
    {
      type: fc.constant('Imported' as const),
      candidate: arbCandidateIdentity,
      location: fc.constantFrom('/library/a', '/library/b'),
      files: arbDownloadedFiles,
    },
    { requiredKeys: ['type', 'candidate', 'location'] },
  ),
  AcquisitionFulfilled: fc.record(
    {
      type: fc.constant('AcquisitionFulfilled' as const),
      location: fc.constantFrom('/library/a', '/library/b'),
      candidate: arbCandidateIdentity,
    },
    // The optional candidate is what separates a revivable fulfilment from a legacy one, so the
    // generator must produce both.
    { requiredKeys: ['type', 'location'] },
  ),
  FulfillmentRejected: fc.record({
    type: fc.constant('FulfillmentRejected' as const),
    candidate: arbCandidateIdentity,
    reasons: fc.array(fc.constantFrom('transcode', 'wrong-album'), { maxLength: 2 }),
  }),
  AcquisitionExhausted: fc.constant({ type: 'AcquisitionExhausted' as const }),
  ImportConflicted: fc.record(
    {
      type: fc.constant('ImportConflicted' as const),
      location: fc.constantFrom('/library/a'),
      files: arbDownloadedFiles,
    },
    { requiredKeys: ['type', 'location'] },
  ),
  AcquisitionCancelled: fc.record(
    { type: fc.constant('AcquisitionCancelled' as const), files: arbDownloadedFiles },
    { requiredKeys: ['type'] },
  ),
};

/** Every event variant, uniformly — the adversary `evolve` must stay total against. */
export const arbEvent: fc.Arbitrary<AcquisitionEvent> = fc.oneof(
  ...Object.values(eventArbitraryByType),
);

/** An arbitrary (mostly out-of-protocol) history: the fold's worst case. */
export const arbEventHistory: fc.Arbitrary<readonly AcquisitionEvent[]> = fc.array(arbEvent, {
  maxLength: 12,
});

// --- Command steps ------------------------------------------------------------------------------

/**
 * A generated command, shaped against the state it will run on. Generation happens up front (so
 * shrinking works on the plan), but the payload that must reference live state — the candidate in
 * flight, the edition on the menu — is read when the step is applied.
 */
export type CommandStep = (state: AcquisitionState) => AcquisitionCommand;

/** The identity currently in flight, if any — what a lawful outcome report names. */
function inFlightIdentity(state: AcquisitionState): CandidateIdentity | undefined {
  if (state.phase === 'Cancelled') {
    return state.staging.kind === 'none' ? undefined : identityOfStaging(state.staging);
  }
  if (state.phase === 'Fulfilled') return state.resume?.candidate.identity;
  return 'current' in state ? state.current.identity : undefined;
}

function identityOfStaging(
  staging: Extract<
    Extract<AcquisitionState, { phase: 'Cancelled' }>['staging'],
    { kind: 'settled' } | { kind: 'in-flight' }
  >,
): CandidateIdentity {
  return staging.kind === 'settled' ? staging.current.identity : staging.pending.identity;
}

/** A stand-in for "nobody in flight": lets a report still be *generated* against any state. */
const ABSENT_IDENTITY: CandidateIdentity = asCandidateIdentity({
  username: 'nobody',
  path: 'nowhere',
  sizeBytes: 0,
});

/** The identity a lawful outcome report names, falling back to a stale one when nothing is live. */
function reportedIdentity(state: AcquisitionState): CandidateIdentity {
  return inFlightIdentity(state) ?? ABSENT_IDENTITY;
}

/**
 * One arbitrary per command variant, same drift guard as {@link eventArbitraryByType}: the key set
 * is checked by the compiler, the key-to-payload agreement by the completeness property.
 */
export const blindStepArbitraryByCommandType: {
  readonly [K in AcquisitionCommandType]: fc.Arbitrary<CommandStep>;
} = {
  SubmitAcquisition: fc
    .tuple(arbRequest, arbPolicies)
    .map(([request, policies]) => () => ({ type: 'SubmitAcquisition', request, policies })),
  RecordTarget: arbTarget.map((target) => () => ({ type: 'RecordTarget', target })),
  RecordMetadataFailed: fc.constant(() => ({ type: 'RecordMetadataFailed' as const })),
  RecordManualSelectionRequested: arbEditionCandidates.map((candidates) => () => ({
    type: 'RecordManualSelectionRequested',
    candidates,
  })),
  SelectEdition: fc
    .constantFrom('edition-1', 'edition-2', 'edition-9')
    .map((id) => () => ({ type: 'SelectEdition', releaseMbid: asMbid(id) })),
  RecordSearchResults: arbCandidates.map((candidates) => () => ({
    type: 'RecordSearchResults',
    candidates,
  })),
  RecordDownloadStarted: arbCandidateIdentity.map((candidate) => () => ({
    type: 'RecordDownloadStarted',
    candidate,
  })),
  RecordDownloadCompleted: fc
    .tuple(arbCandidateIdentity, arbDownloadedFiles)
    .map(([candidate, files]) => () => ({ type: 'RecordDownloadCompleted', candidate, files })),
  RecordDownloadFailed: fc
    .tuple(arbCandidateIdentity, arbDownloadFailureReason, arbDownloadedFiles)
    .map(([candidate, reason, files]) => () => ({
      type: 'RecordDownloadFailed',
      candidate,
      reason,
      files,
    })),
  RecordValidationPassed: arbVerdict.map((verdict) => () => ({
    type: 'RecordValidationPassed',
    verdict,
  })),
  RecordValidationFailed: arbVerdict.map((verdict) => () => ({
    type: 'RecordValidationFailed',
    verdict,
  })),
  RecordImported: fc
    .constantFrom('/library/a', '/library/b')
    .map((location) => () => ({ type: 'RecordImported', location })),
  RecordImportConflict: fc
    .constantFrom('/library/a', '/library/b')
    .map((location) => () => ({ type: 'RecordImportConflict', location })),
  RecordExternalValidationFailed: fc
    .tuple(arbCandidateIdentity, fc.array(fc.constantFrom('transcode'), { maxLength: 1 }))
    .map(([identity, reasons]) => () => ({
      type: 'RecordExternalValidationFailed',
      candidate: { username: identity.username, path: identity.path },
      reasons,
    })),
  CancelAcquisition: fc.constant(() => ({ type: 'CancelAcquisition' as const })),
};

/**
 * A uniform draw over every command variant, referencing nothing in the state. Most land
 * out-of-protocol — which is the point: `decide` owes a `Result` for all of them.
 */
export const arbBlindCommandStep: fc.Arbitrary<CommandStep> = fc.oneof(
  ...Object.values(blindStepArbitraryByCommandType),
);

/**
 * The lawful next move from whatever phase the acquisition is in — the generator that makes the
 * deep phases (`Validating`, `Importing`, `Fulfilled`, `Conflicted`) reachable at all. Every arm
 * still carries generated payloads, and the outcome-report arms deliberately mix exact references
 * with stale ones so the late-report guards stay exercised.
 */
export const arbAdvancingStep: fc.Arbitrary<CommandStep> = fc
  .record({
    request: arbRequest,
    policies: arbPolicies,
    target: arbTarget,
    editions: arbEditionCandidates,
    candidates: arbCandidates,
    files: arbDownloadedFiles,
    verdict: arbVerdict,
    reason: arbDownloadFailureReason,
    location: fc.constantFrom('/library/a', '/library/b'),
    // Which lawful arm to take where a phase offers several, and whether to report exactly.
    branch: fc.integer({ min: 0, max: 5 }),
    exactReference: fc.boolean(),
  })
  .map((draw): CommandStep => {
    return (state) => {
      switch (state.phase) {
        case 'Empty': {
          return { type: 'SubmitAcquisition', request: draw.request, policies: draw.policies };
        }
        case 'Pending': {
          if (draw.branch === 0) return { type: 'RecordMetadataFailed' };
          if (draw.branch === 1) {
            return { type: 'RecordManualSelectionRequested', candidates: draw.editions };
          }
          return { type: 'RecordTarget', target: draw.target };
        }
        case 'AwaitingManualSelection': {
          const chosen = state.candidates[draw.branch % state.candidates.length];
          return {
            type: 'SelectEdition',
            releaseMbid: chosen?.releaseMbid ?? asMbid('edition-9'),
          };
        }
        case 'Searching': {
          return { type: 'RecordSearchResults', candidates: draw.candidates };
        }
        case 'Downloading': {
          if (draw.branch === 0) {
            return { type: 'RecordDownloadStarted', candidate: reportedIdentity(state) };
          }
          if (draw.branch <= 2) {
            return {
              type: 'RecordDownloadFailed',
              candidate: reportedIdentity(state),
              reason: draw.reason,
              files: draw.files,
            };
          }
          return {
            type: 'RecordDownloadCompleted',
            candidate: reportedIdentity(state),
            files: draw.files,
          };
        }
        case 'Validating': {
          return draw.branch <= 1
            ? { type: 'RecordValidationFailed', verdict: draw.verdict }
            : { type: 'RecordValidationPassed', verdict: draw.verdict };
        }
        case 'Importing': {
          return draw.branch === 0
            ? { type: 'RecordImportConflict', location: draw.location }
            : { type: 'RecordImported', location: draw.location };
        }
        case 'Fulfilled': {
          const identity = reportedIdentity(state);
          return {
            type: 'RecordExternalValidationFailed',
            candidate: draw.exactReference
              ? { username: identity.username, path: identity.path }
              : { username: 'a-stranger', path: 'somewhere/else' },
            reasons: ['judged unacceptable downstream'],
          };
        }
        // `Selecting` is only ever a mid-batch fold state, and the absorbing terminals have no
        // lawful move left — a cancellation is the honest thing to try in both.
        case 'Selecting':
        case 'Exhausted':
        case 'Cancelled':
        case 'MetadataFailed':
        case 'Conflicted': {
          return { type: 'CancelAcquisition' };
        }
      }
    };
  });

/**
 * A generated command sequence: mostly lawful moves so the ladder gets deep, salted with blind
 * ones so protocol violations and stale reports are exercised on every phase they can reach.
 */
export const arbCommandSequence: fc.Arbitrary<readonly CommandStep[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbAdvancingStep },
    { weight: 1, arbitrary: arbBlindCommandStep },
  ),
  { minLength: 1, maxLength: 20 },
);
