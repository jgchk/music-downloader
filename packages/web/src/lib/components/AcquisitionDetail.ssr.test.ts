import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionDetail from './AcquisitionDetail.svelte';
import type { DownloaderHistoryEntry, ImporterHistoryEntry, TimelineEntry } from '$lib/timeline.js';

const candidate = { username: 'u', path: '/files/a.flac', sizeBytes: 9 };

const working = {
  acquisitionId: 'acq-1',
  status: 'Downloading' as const,
  target: { artist: 'A', title: 'T' },
  currentCandidate: candidate,
  attempts: 2,
  rejectedCount: 1,
  history: [{ kind: 'selected' as const, at: 't', candidate }],
};

function dl(entry: DownloaderHistoryEntry): TimelineEntry {
  return { module: 'downloader', at: entry.at, entry };
}

function im(entry: ImporterHistoryEntry): TimelineEntry {
  return { module: 'importer', at: entry.at, entry };
}

describe('AcquisitionDetail (SSR)', () => {
  it('renders a cancellable in-flight acquisition with progress, current candidate, and a timeline', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: working,
        timeline: [dl({ kind: 'selected', at: 't', candidate })],
        importState: 'none',
        progress: { percent: 50, bytesTransferred: 5, bytesTotal: 10 },
      },
    });
    expect(body).toContain('A — T');
    expect(body).toContain('data-testid="cancel"');
    expect(body).toContain('data-testid="progress"');
    expect(body).toContain('data-testid="current-candidate"');
    expect(body).toContain('Selected /files/a.flac');
    expect(body).toContain('data-testid="import-none"');
    expect(body).not.toContain('data-testid="outcome"');
    expect(body).not.toContain('data-testid="action-error"');
  });

  it('renders every downloader timeline kind, labelling the hand-off apart from a library import', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: { ...working, status: 'Fulfilled' as const, currentCandidate: undefined },
        importState: 'present',
        timeline: [
          dl({ kind: 'selected', at: 't0', candidate }),
          dl({ kind: 'download-failed', at: 't1', candidate, reason: 'Stalled' }),
          dl({ kind: 'validation-failed', at: 't2', candidate, reasons: ['DurationMismatch'] }),
          dl({ kind: 'imported', at: 't3', candidate, location: '/stage/x' }),
          dl({ kind: 'fulfillment-rejected', at: 't4', candidate, reasons: ['bad rip'] }),
        ],
      },
    });
    expect(body).not.toContain('data-testid="cancel"');
    expect(body).toContain('data-module="downloader"');
    expect(body).toContain('Download failed (Stalled)');
    expect(body).toContain('Validation failed (DurationMismatch)');
    expect(body).toContain('Handed off to importer — staged at /stage/x');
    // The hand-off must not read as a completed library import (the old ambiguous label).
    expect(body).not.toContain('Deposited at');
    expect(body).toContain('Rejected after delivery (bad rip)');
  });

  it('renders every importer timeline kind, attributed to the import', () => {
    const reference = { dataSource: 'MusicBrainz', albumId: 'a1' };
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: { ...working, status: 'Fulfilled' as const, currentCandidate: undefined },
        importState: 'present',
        timeline: [
          im({ kind: 'requested', at: 'i0' }),
          im({ kind: 'proposed', at: 'i1', candidateCount: 2 }),
          im({ kind: 'proposed', at: 'i2', candidateCount: 1 }),
          im({ kind: 'auto-apply-selected', at: 'i3', candidate: reference, distance: 0.05 }),
          im({ kind: 'review-required', at: 'i4', reviewKind: 'match-review' }),
          im({ kind: 'review-resolved', at: 'i5', resolution: 'reject' }),
          im({ kind: 'applied', at: 'i6', location: '/lib/x' }),
          im({ kind: 'remediation-required', at: 'i7', failures: [] }),
          im({ kind: 'rejected', at: 'i8', reason: 'wrong rip', filesDeleted: true }),
          im({
            kind: 'release-verdict-recorded',
            at: 'i9',
            acquisitionId: 'acq-1',
            reasons: ['corrupt rip'],
          }),
        ],
      },
    });
    expect(body).toContain('data-testid="import-entry"');
    expect(body).toContain('data-module="importer"');
    expect(body).toContain('Import requested');
    expect(body).toContain('Matched 2 candidates against the library');
    expect(body).toContain('Matched 1 candidate against the library');
    expect(body).toContain('Auto-selected a confident match (distance 0.05)');
    expect(body).toContain('Review required (match-review)');
    expect(body).toContain('Review resolved (reject)');
    expect(body).toContain('Imported into the library at /lib/x');
    expect(body).toContain('Applied, but needs remediation');
    expect(body).toContain('Import rejected (wrong rip)');
    expect(body).toContain('Recorded a retry-download verdict (corrupt rip)');
  });

  it('renders the import section as unavailable while still showing the downloader timeline', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: working,
        importState: 'unavailable',
        timeline: [dl({ kind: 'selected', at: 't', candidate })],
      },
    });
    expect(body).toContain('data-testid="import-unavailable"');
    expect(body).not.toContain('data-testid="import-none"');
    expect(body).toContain('Selected /files/a.flac');
  });

  it('renders no import note once the import is present', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: working,
        importState: 'present',
        timeline: [dl({ kind: 'selected', at: 't', candidate })],
      },
    });
    expect(body).not.toContain('data-testid="import-none"');
    expect(body).not.toContain('data-testid="import-unavailable"');
  });

  it('renders a fulfilled acquisition without a cancel affordance', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          location: '/lib/x',
        },
        importState: 'present',
        timeline: [],
      },
    });
    expect(body).not.toContain('data-testid="cancel"');
    expect(body).toContain('/lib/x');
  });

  it('lists the candidate editions with a choose action while awaiting manual selection', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
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
    expect(body).not.toContain('(resolving…)');
  });

  it('renders no edition-candidates section outside the awaiting-selection state', () => {
    const { body } = render(AcquisitionDetail, {
      props: { acquisition: working, timeline: [] },
    });
    expect(body).not.toContain('data-testid="edition-candidates"');
  });

  it('says progress is momentarily unavailable when downloading but the progress read failed', () => {
    const { body } = render(AcquisitionDetail, {
      props: { acquisition: working, timeline: [], progressUnavailable: true },
    });
    expect(body).not.toContain('data-testid="progress"');
    expect(body).toContain('data-testid="progress-unavailable"');
  });

  it('renders unknown history kinds through generic fallbacks instead of mislabeling them', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: working,
        importState: 'present',
        timeline: [
          dl({ kind: 'teleported', at: 't' } as never),
          im({ kind: 'zapped', at: 'i' } as never),
        ],
      },
    });
    expect(body).toContain('Something happened in this acquisition');
    expect(body).toContain('Something happened in the import');
    expect(body).not.toContain('Rejected after delivery');
  });

  it('renders an action failure and an empty history', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: { ...working, history: [], currentCandidate: undefined },
        timeline: [],
        importState: 'present',
        error: 'Something went wrong (store). Try again.',
      },
    });
    expect(body).toContain('data-testid="action-error"');
    expect(body).toContain('data-testid="no-history"');
  });
});
