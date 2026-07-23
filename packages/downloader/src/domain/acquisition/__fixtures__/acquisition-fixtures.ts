import type { Candidate } from '../../candidate/candidate.js';
import {
  DEFAULT_DOWNLOAD_POLICY,
  DEFAULT_MATCH_POLICY,
  DEFAULT_RETRY_POLICY,
} from '../../policy/policies.js';
import type { AcquisitionPolicies } from '../../policy/policies.js';
import { DEFAULT_QUALITY_POLICY } from '../../policy/quality-policy.js';
import { rankCandidates } from '../../ranking/ranking.js';
import type { RankedCandidate } from '../../ranking/ranking.js';
import { asCandidateIdentity } from '../../shared/__fixtures__/candidate-identity.js';
import { asMbid } from '../../shared/__fixtures__/mbid.js';
import { asUnit } from '../../shared/__fixtures__/unit.js';
import { createTarget } from '../../target/target.js';
import type { Target } from '../../target/target.js';
import type {
  AcquisitionEvent,
  AcquisitionRequest,
  DownloadedFile,
  EditionCandidate,
} from '../events.js';

/** Shared BDD fixtures for the decider tests: a target, matching candidates, and history builders. */

export const sampleTarget: Target = createTarget({
  type: 'album',
  artist: 'Radiohead',
  title: 'Kid A',
  year: 2000,
  tracks: [
    { position: 1, title: 'Everything in Its Right Place', durationMs: 251_000 },
    { position: 2, title: 'Kid A', durationMs: 264_000 },
  ],
})._unsafeUnwrap();

export const sampleRequest: AcquisitionRequest = {
  kind: 'musicbrainz',
  mbid: asMbid('mbid-1'),
  targetType: 'album',
};

export const sampleFiles: readonly DownloadedFile[] = [
  { path: '/staging/01.flac', name: '01.flac' },
  { path: '/staging/02.flac', name: '02.flac' },
];

export function defaultPolicies(overrides: Partial<AcquisitionPolicies> = {}): AcquisitionPolicies {
  return {
    quality: DEFAULT_QUALITY_POLICY,
    match: DEFAULT_MATCH_POLICY,
    retry: DEFAULT_RETRY_POLICY,
    download: DEFAULT_DOWNLOAD_POLICY,
    ...overrides,
  };
}

/** A lossless, structurally-aligned candidate that clears both gates for {@link sampleTarget}. */
export function matchingCandidate(username: string): Candidate {
  return {
    identity: asCandidateIdentity({
      username,
      path: `${username}/Radiohead - Kid A (2000) [FLAC]`,
      sizeBytes: 1000,
    }),
    files: [
      {
        name: '01 Everything in Its Right Place.flac',
        sizeBytes: 1,
        codec: 'flac',
        durationMs: 251_000,
      },
      { name: '02 Kid A.flac', sizeBytes: 1, codec: 'flac', durationMs: 264_000 },
    ],
    source: { speedBytesPerSec: 100, freeSlots: 1, queueLength: 0 },
  };
}

export function rankedOf(
  candidates: readonly Candidate[],
  policies: AcquisitionPolicies = defaultPolicies(),
): readonly RankedCandidate[] {
  return rankCandidates(candidates, sampleTarget, policies.quality, policies.match);
}

export function requestedHistory(
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  return [{ type: 'AcquisitionRequested', request: sampleRequest, policies }];
}

export const sampleGroupRequest: AcquisitionRequest = {
  kind: 'release-group',
  mbid: asMbid('rg-1'),
  targetType: 'album',
};

/** The candidate editions of a group with no official edition, as resolution would present them. */
export const sampleEditionCandidates: readonly EditionCandidate[] = [
  {
    releaseMbid: asMbid('boot-1'),
    title: 'Live at Budokan',
    date: '1995-05-01',
    country: 'JP',
    format: 'CD',
    trackCount: 12,
  },
  { releaseMbid: asMbid('boot-2'), title: 'Promo Sampler', trackCount: 12 },
];

/** History paused for a human's edition choice — an AwaitingManualSelection state. */
export function awaitingSelectionHistory(
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  return [
    { type: 'AcquisitionRequested', request: sampleGroupRequest, policies },
    { type: 'ManualSelectionRequested', candidates: sampleEditionCandidates },
  ];
}

export function resolvedHistory(
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  return [...requestedHistory(policies), { type: 'TargetResolved', target: sampleTarget }];
}

/** History up to and including selecting the best of `candidates` — a Downloading state. */
export function selectedHistory(
  candidates: readonly Candidate[],
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  const ranked = rankedOf(candidates, policies);
  return [
    ...resolvedHistory(policies),
    { type: 'SearchCompleted', round: 1, candidates },
    { type: 'CandidatesRanked', ranked },
    { type: 'CandidateSelected', candidate: ranked[0]!.candidate },
  ];
}

/** History through a completed download of the best candidate — a Validating state. */
export function validatingHistory(
  candidates: readonly Candidate[],
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  const ranked = rankedOf(candidates, policies);
  const selected = ranked[0]!.candidate;
  return [
    ...selectedHistory(candidates, policies),
    { type: 'DownloadCompleted', candidate: selected.identity, files: sampleFiles },
  ];
}

/** History through a passing validation of the best candidate — an Importing state. */
export function importingHistory(
  candidates: readonly Candidate[],
  policies: AcquisitionPolicies = defaultPolicies(),
): AcquisitionEvent[] {
  const ranked = rankedOf(candidates, policies);
  const selected = ranked[0]!.candidate;
  return [
    ...validatingHistory(candidates, policies),
    {
      type: 'ValidationPassed',
      candidate: selected.identity,
      verdict: { confidence: asUnit(1), reasons: [] },
    },
  ];
}

/**
 * History through a completed import of the best candidate — a revivable Fulfilled state whose
 * `AcquisitionFulfilled` names the fulfilled candidate (fulfillment-external-verdict D3).
 */
export function fulfilledHistory(
  candidates: readonly Candidate[],
  policies: AcquisitionPolicies = defaultPolicies(),
  location = '/library/x',
): AcquisitionEvent[] {
  const selected = rankedOf(candidates, policies)[0]!.candidate;
  return [
    ...importingHistory(candidates, policies),
    { type: 'Imported', candidate: selected.identity, location, files: sampleFiles },
    { type: 'AcquisitionFulfilled', location, candidate: selected.identity },
  ];
}
