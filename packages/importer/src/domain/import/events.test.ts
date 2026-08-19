import { describe, expect, it } from 'vitest';
import { toOriginatingDownloadId } from '../shared/originating-download-id.js';
import { asDistance } from '../shared/__fixtures__/distance.js';
import {
  DELIVERED_CANDIDATE,
  FAILURE,
  candidate,
  requested,
} from './__fixtures__/import-fixtures.js';
import { isCycleStart } from './events.js';
import type { ImportEvent, ImportEventType } from './events.js';

/**
 * Where a cycle begins. A stream holds several cycles — the revival loop reopens the same import
 * when a replacement delivery arrives — so "opens a cycle" is a two-valued fact about EVERY event
 * type, not a property of the one that happens to be first in a stream. The outbound renderer
 * slices a cycle's story on this answer, so an event that quietly declines to answer would silently
 * publish the previous cycle's story.
 */
describe('isCycleStart', () => {
  it('opens a cycle at ImportRequested', () => {
    expect(isCycleStart(requested())).toBe(true);
  });

  /**
   * One sample of every event type that CONTINUES an already-open cycle. Keyed by the event type
   * minus the opener, so a newly added event is a compile error here as well as in `isCycleStart`
   * itself: both places must classify it, and neither may inherit a default.
   */
  const CONTINUING_EVENTS: {
    readonly [T in Exclude<ImportEventType, 'ImportRequested'>]: Extract<ImportEvent, { type: T }>;
  } = {
    MatchesProposed: { type: 'MatchesProposed', candidates: [candidate()], duplicates: [] },
    AutoApplySelected: {
      type: 'AutoApplySelected',
      ref: { dataSource: 'MusicBrainz', albumId: 'album-1' },
      distance: asDistance(0.05),
    },
    ReviewRequired: { type: 'ReviewRequired', cause: { kind: 'no-match' } },
    ReviewResolved: { type: 'ReviewResolved', resolution: { kind: 'accept' } },
    ImportApplied: { type: 'ImportApplied', location: '/library/Artist/Album' },
    RemediationRequired: { type: 'RemediationRequired', failures: [FAILURE] },
    ImportRejected: { type: 'ImportRejected', reason: 'corrupt rip', filesDeleted: true },
    ReleaseVerdictRecorded: {
      type: 'ReleaseVerdictRecorded',
      acquisitionId: toOriginatingDownloadId('acq-1'),
      candidate: DELIVERED_CANDIDATE,
      reasons: ['corrupt rip'],
    },
  };

  // Exactly `false`, never merely falsy: a type that fell through the switch unclassified would
  // answer `undefined`, and a renderer asking "does this open a cycle" cannot tell the two apart.
  it.each(Object.values(CONTINUING_EVENTS))('continues the open cycle at $type', (event) => {
    expect(isCycleStart(event)).toBe(false);
  });
});
