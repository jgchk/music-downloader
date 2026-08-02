import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ImportStatusResponseDto } from '@music/importer';
import AcquisitionDetail from './AcquisitionDetail.svelte';
import type {
  DownloaderHistoryEntry,
  ImporterHistoryEntry,
  ImportSection,
  TimelineEntry,
} from '$lib/timeline.js';

const candidate = { username: 'xronin', path: '/files/a.flac', sizeBytes: 9 };

const NOW = '2026-08-01T12:00:00Z';
const T = (offsetMinutes: number): string =>
  new Date(Date.parse('2026-08-01T10:00:00Z') + offsetMinutes * 60_000).toISOString();

const working = {
  acquisitionId: 'acq-1',
  status: 'Downloading' as const,
  target: { artist: 'A', title: 'T' },
  currentCandidate: candidate,
  attempts: 2,
  rejectedCount: 1,
  history: [{ kind: 'selected' as const, at: T(0), candidate }],
  // A non-terminal acquisition: the downloader decides it cancellable, and the detail renders that.
  cancellable: true,
};

const base = { nowIso: NOW, timeZone: 'UTC' };

function dl(entry: DownloaderHistoryEntry): TimelineEntry {
  return { module: 'downloader', at: entry.at, entry };
}

function im(entry: ImporterHistoryEntry): TimelineEntry {
  return { module: 'importer', at: entry.at, entry };
}

function imports(over: Partial<ImportStatusResponseDto>): ImportSection {
  return {
    state: 'present',
    status: { importId: 'imp-1', status: 'requested', settled: false, history: [], ...over },
  };
}

describe('AcquisitionDetail (SSR)', () => {
  it('renders an in-flight acquisition with a pending download row carrying the progress', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: working,
        timeline: [dl({ kind: 'selected', at: T(0), candidate })],
        importSection: { state: 'none' },
        progress: { percent: 50, bytesTransferred: 5, bytesTotal: 10 },
      },
    });
    expect(body).toContain('A — T');
    expect(body).toContain('data-testid="cancel"');
    expect(body).toContain('data-testid="pending-row"');
    expect(body).toContain('Downloading from xronin…');
    expect(body).toContain('data-testid="progress"');
    expect(body).toContain('Chose a download from xronin');
    // The unified voice: no module tag text, no import-none note, no architecture nouns.
    expect(body).not.toContain('data-testid="import-none"');
    expect(body).not.toContain('Handed off');
    expect(body).not.toContain('data-testid="action-error"');
  });

  it('renders the whole downloader story in the unified voice with codes behind disclosure', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Exhausted' as const,
          currentCandidate: undefined,
          cancellable: false,
        },
        importSection: { state: 'none' },
        timeline: [
          dl({
            kind: 'requested',
            at: T(0),
            request: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
          }),
          dl({ kind: 'resolved', at: T(1), artist: 'A', title: 'T', year: 1975 }),
          dl({ kind: 'search-started', at: T(2), round: 1 }),
          dl({ kind: 'selected', at: T(3), candidate }),
          dl({ kind: 'download-failed', at: T(4), candidate, reason: 'Stalled' }),
          dl({ kind: 'validation-failed', at: T(5), candidate, reasons: ['DurationMismatch'] }),
          dl({ kind: 'exhausted', at: T(6) }),
        ],
      },
    });
    expect(body).toContain('Requested');
    expect(body).toContain('Matched to MusicBrainz — A, T (1975)');
    expect(body).toContain('Started searching for a download');
    expect(body).toContain('Download failed — the download stalled. Trying the next source.');
    expect(body).toContain(
      'The files failed quality checks — track lengths didn’t match the release. Trying the next source.',
    );
    expect(body).toContain('Gave up — every source failed or came up empty');
    // Raw codes live in the per-entry disclosure, not the visible line.
    expect(body).toContain('<details class="timeline-detail"');
    expect(body).toContain('Stalled');
    expect(body).not.toContain('Download failed (Stalled)');
    expect(body).not.toContain('Validation failed (DurationMismatch)');
    // A settled story has no pending row and its status line is a human phrase.
    expect(body).not.toContain('data-testid="pending-row"');
    expect(body).toContain('No usable download found');
    expect(body).not.toContain('>Exhausted<');
  });

  it('renders the import story without a module prefix and with the glossed match', () => {
    const reference = { dataSource: 'MusicBrainz', albumId: 'a1' };
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          cancellable: false,
        },
        importSection: imports({ status: 'applied', location: '/lib/x', settled: true }),
        timeline: [
          im({ kind: 'requested', at: T(10) }),
          im({ kind: 'proposed', at: T(11), candidateCount: 2 }),
          im({ kind: 'proposed', at: T(12), candidateCount: 1 }),
          im({ kind: 'auto-apply-selected', at: T(13), candidate: reference, distance: 0.05 }),
          im({ kind: 'review-required', at: T(14), reviewKind: 'match-review' }),
          im({ kind: 'review-resolved', at: T(15), resolution: 'reject' }),
          im({ kind: 'applied', at: T(16), location: '/lib/x' }),
          im({ kind: 'remediation-required', at: T(17), failures: [] }),
          im({ kind: 'rejected', at: T(18), reason: 'wrong rip', filesDeleted: true }),
          im({
            kind: 'release-verdict-recorded',
            at: T(19),
            acquisitionId: 'acq-1',
            reasons: ['corrupt rip'],
          }),
        ],
      },
    });
    // No module tag: the fixed "Import Import requested" stutter is structurally impossible now.
    expect(body).not.toContain('data-testid="import-entry"');
    expect(body).toContain('data-module="importer"');
    expect(body).toContain('Import started');
    expect(body).toContain('Compared against the library — 2 candidate matches');
    expect(body).toContain('Compared against the library — 1 candidate match');
    expect(body).toContain('Confident match — importing automatically (95% match)');
    expect(body).toContain('Needs your review');
    expect(body).toContain('Review resolved — you rejected the import');
    expect(body).toContain('Added to the library');
    expect(body).toContain('Added to the library, but needs attention');
    expect(body).toContain(
      'Import rejected — wrong rip. Nothing more will be tried — request the release again for another attempt.',
    );
    expect(body).toContain('Marked this delivery unusable — searching for a replacement');
    expect(body).not.toContain('retry-download verdict');
    expect(body).toContain('data-testid="location"');
    expect(body).toContain('In library at');
  });

  it('renders every entry with its occurrence time and a hover timestamp', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: working,
        timeline: [dl({ kind: 'selected', at: '2026-08-01T11:56:00Z', candidate })],
      },
    });
    expect(body).toContain('datetime="2026-08-01T11:56:00Z"');
    expect(body).toContain('title="1 Aug 2026, 11:56:00"');
    expect(body).toContain('4 min ago');
  });

  it('inserts a date divider when the calendar date changes', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: working,
        timeline: [
          dl({ kind: 'selected', at: '2026-07-31T23:50:00Z', candidate }),
          dl({ kind: 'download-failed', at: '2026-08-01T00:10:00Z', candidate, reason: 'Stalled' }),
        ],
      },
    });
    expect(body).toContain('data-testid="date-divider"');
    expect(body).toContain('31 July 2026');
    expect(body).toContain('1 August 2026');
  });

  it('appends the whole-story duration to the closing row once settled', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, status: 'Exhausted' as const, cancellable: false },
        importSection: { state: 'none' },
        timeline: [
          dl({
            kind: 'requested',
            at: T(0),
            request: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
          }),
          dl({ kind: 'exhausted', at: T(6) }),
        ],
      },
    });
    expect(body).toContain('data-testid="duration"');
    expect(body).toContain('6 min from request');
  });

  it('a just-submitted acquisition shows the requested entry plus a pending row, never empty', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, status: 'Pending' as const, currentCandidate: undefined },
        timeline: [
          dl({
            kind: 'requested',
            at: T(0),
            request: { kind: 'musicbrainz', targetType: 'album', mbid: 'm-1' },
          }),
        ],
      },
    });
    expect(body).toContain('Requested');
    expect(body).toContain('Identifying the release…');
    expect(body).not.toContain('data-testid="no-history"');
  });

  it('waits on the user read as attention rows, not spinners', () => {
    const awaiting = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'AwaitingManualSelection' as const,
          currentCandidate: undefined,
          history: [],
          candidates: [{ releaseMbid: 'boot-1', title: 'Live at Budokan', trackCount: 12 }],
        },
        timeline: [],
      },
    });
    expect(awaiting.body).toContain('data-testid="pending-row"');
    expect(awaiting.body).toContain('data-state="attention"');
    expect(awaiting.body).toContain('Waiting for you to choose an edition');

    const review = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, status: 'Fulfilled' as const, cancellable: false },
        importSection: imports({ status: 'awaiting-review' }),
        timeline: [],
      },
    });
    expect(review.body).toContain('Waiting for your review');
    expect(review.body).toContain('href="/reviews"');
  });

  it('the fulfilled downloader entry is curated out — applied is the story ending', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, status: 'Fulfilled' as const, cancellable: false },
        importSection: imports({ status: 'applied', location: '/lib/x', settled: true }),
        timeline: [
          dl({ kind: 'imported', at: T(0), candidate, location: '/stage/x' }),
          dl({ kind: 'fulfilled', at: T(0), location: '/stage/x' }),
          im({ kind: 'applied', at: T(5), location: '/lib/x' }),
        ],
      },
    });
    expect(body).toContain('Download complete — preparing to add to the library');
    expect(body).toContain('Added to the library');
    // In your library appears as the status phrase; the raw enum never renders.
    expect(body).toContain('In your library');
    expect(body).not.toContain('>Fulfilled<');
  });

  it('renders the import section as unavailable while still showing the downloader timeline', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: working,
        importSection: { state: 'unavailable' },
        timeline: [dl({ kind: 'selected', at: T(0), candidate })],
      },
    });
    expect(body).toContain('data-testid="import-unavailable"');
    expect(body).toContain('Chose a download from xronin');
  });

  it('withholds the cancel affordance when the decided flag is absent (older producer)', () => {
    const { cancellable, ...absent } = working;
    void cancellable;
    const { body } = render(AcquisitionDetail, {
      props: { ...base, acquisition: absent, importSection: { state: 'none' }, timeline: [] },
    });
    // No re-derivation from the status enum: an absent flag degrades to no cancel button.
    expect(body).not.toContain('data-testid="cancel"');
  });

  it('labels a legacy fulfilled acquisition with its delivered location', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          location: '/stage/x',
          cancellable: false,
        },
        importSection: { state: 'none' },
        timeline: [],
      },
    });
    expect(body).not.toContain('data-testid="cancel"');
    expect(body).toContain('data-testid="location"');
    expect(body).toContain('Delivered to');
    expect(body).toContain('/stage/x');
  });

  it('lists the candidate editions with a choose action while awaiting manual selection', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'AwaitingManualSelection' as const,
          currentCandidate: undefined,
          history: [],
          candidates: [
            {
              releaseMbid: 'boot-1',
              title: 'Live at Budokan',
              date: '1995-05-01',
              country: 'JP',
              format: 'CD',
              trackCount: 12,
            },
            { releaseMbid: 'boot-2' },
          ],
        },
        timeline: [],
      },
    });
    expect(body).toContain('data-testid="edition-candidates"');
    expect(body).toContain('Live at Budokan');
    expect(body).toContain('1995-05-01');
    expect(body).toContain('JP');
    expect(body).toContain('CD');
    expect(body).toContain('<td>12</td>');
    // The second edition is sparse: an unknown title renders as (untitled) and an unknown (absent)
    // track count renders as a dash, not 0.
    expect(body).toContain('(untitled)');
    expect(body).toContain('<td>—</td>');
    expect(body).toContain('action="?/select"');
    expect(body).toContain('value="boot-1"');
    expect(body).toContain('value="boot-2"');
    expect(body).toContain('data-testid="cancel"');
  });

  it('explains an awaiting-selection acquisition that carries no candidates instead of a dead end', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'AwaitingManualSelection' as const,
          currentCandidate: undefined,
          history: [],
        },
        timeline: [],
      },
    });
    expect(body).not.toContain('data-testid="edition-candidates"');
    expect(body).toContain('data-testid="no-candidates"');
    expect(body).toContain('data-testid="cancel"');
  });

  it('headlines the awaited edition choice when no target is resolved yet', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'AwaitingManualSelection' as const,
          target: undefined,
          currentCandidate: undefined,
          history: [],
          candidates: [{ releaseMbid: 'boot-1', title: 'Live at Budokan', trackCount: 12 }],
        },
        timeline: [],
      },
    });
    expect(body).toContain('<h1>Live at Budokan — awaiting your edition choice</h1>');
    expect(body).not.toContain('resolving…');
  });

  it('says progress is momentarily unavailable inside the pending row when the read failed', () => {
    const { body } = render(AcquisitionDetail, {
      props: { ...base, acquisition: working, timeline: [], progressUnavailable: true },
    });
    expect(body).not.toContain('data-testid="progress"');
    expect(body).toContain('data-testid="progress-unavailable"');
    expect(body).toContain('data-testid="pending-row"');
  });

  it('renders unknown history kinds through neutral fallbacks instead of mislabeling them', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: working,
        importSection: imports({}),
        timeline: [
          dl({ kind: 'teleported', at: T(0) } as never),
          im({ kind: 'zapped', at: T(1) } as never),
        ],
      },
    });
    expect(body).toContain('Something happened that this page can’t describe yet');
    expect(body).toContain('Something happened during import that this page can’t describe yet');
    expect(body).not.toContain('Delivery rejected');
  });

  it('renders an action failure, and the defensive no-history line only when truly empty', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Cancelled' as const,
          history: [],
          currentCandidate: undefined,
          cancellable: false,
        },
        timeline: [],
        importSection: { state: 'none' },
        error: 'Something went wrong (store). Try again.',
      },
    });
    expect(body).toContain('data-testid="action-error"');
    expect(body).toContain('data-testid="no-history"');
    expect(body).not.toContain('Nothing has happened yet');
  });

  it('a settled story whose only entries are curated out renders the defensive line, no duration', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          cancellable: false,
        },
        importSection: imports({ status: 'applied', settled: true }),
        timeline: [dl({ kind: 'fulfilled', at: T(0), location: '/stage/x' })],
      },
    });
    expect(body).toContain('data-testid="no-history"');
    expect(body).not.toContain('data-testid="duration"');
  });

  it('a delivery whose import has not appeared yet keeps narrating instead of claiming the library', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          location: '/stage/x',
          cancellable: false,
        },
        importSection: { state: 'none' },
        timeline: [dl({ kind: 'imported', at: T(0), candidate, location: '/stage/x' })],
      },
    });
    // The async hand-off window: honest status, a live pending row, no duration, no library claim.
    expect(body).toContain('Delivered — confirming the import');
    expect(body).toContain('data-testid="pending-row"');
    expect(body).toContain('Adding to the library…');
    expect(body).not.toContain('In your library');
    expect(body).not.toContain('data-testid="duration"');
  });

  it('surfaces a failed liveness refresh instead of silently going stale', () => {
    const { body } = render(AcquisitionDetail, {
      props: { ...base, acquisition: working, timeline: [], refreshFailed: true },
    });
    expect(body).toContain('data-testid="refresh-failed"');
    expect(body).toContain('Couldn’t refresh just now — retrying.');
  });

  it('pluralizes the status meta and omits zero counts', () => {
    const single = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, attempts: 1, rejectedCount: 0 },
        timeline: [],
      },
    });
    expect(single.body).toContain('1 attempt');
    expect(single.body).not.toContain('1 attempts');
    expect(single.body).not.toContain('rejected');

    const none = render(AcquisitionDetail, {
      props: {
        ...base,
        acquisition: { ...working, attempts: 0, rejectedCount: 0 },
        timeline: [],
      },
    });
    expect(none.body).not.toContain('data-testid="status-meta"');
  });
});
