import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionDetail from './AcquisitionDetail.svelte';

const candidate = { username: 'u', path: '/files/a.flac', sizeBytes: 9 };

const working = {
  acquisitionId: 'acq-1',
  status: 'Downloading' as const,
  target: { artist: 'A', title: 'T' },
  currentCandidate: candidate,
  attempts: 2,
  rejectedCount: 1,
  history: [{ kind: 'selected' as const, candidate }],
};

describe('AcquisitionDetail (SSR)', () => {
  it('renders a cancellable in-flight acquisition with progress and current candidate', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: working,
        progress: { percent: 50, bytesTransferred: 5, bytesTotal: 10 },
      },
    });
    expect(body).toContain('A — T');
    expect(body).toContain('data-testid="cancel"');
    expect(body).toContain('data-testid="progress"');
    expect(body).toContain('data-testid="current-candidate"');
    expect(body).toContain('Selected /files/a.flac');
    expect(body).not.toContain('data-testid="outcome"');
    expect(body).not.toContain('data-testid="action-error"');
  });

  it('renders a fulfilled acquisition without a cancel affordance', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: {
          ...working,
          status: 'Fulfilled' as const,
          currentCandidate: undefined,
          location: '/lib/x',
          history: [
            { kind: 'imported', candidate, location: '/lib/x' },
            { kind: 'validation-failed', candidate, reasons: ['DurationMismatch'] },
            { kind: 'download-failed', candidate, reason: 'Stalled' },
            { kind: 'fulfillment-rejected', candidate, reasons: ['bad rip'] },
          ],
        },
      },
    });
    expect(body).not.toContain('data-testid="cancel"');
    expect(body).toContain('/lib/x');
    expect(body).toContain('Validation failed (DurationMismatch)');
    expect(body).toContain('Download failed (Stalled)');
    expect(body).toContain('Rejected after delivery (bad rip)');
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
            { releaseMbid: 'boot-2', trackCount: 10 },
          ],
        },
      },
    });
    expect(body).toContain('data-testid="edition-candidates"');
    expect(body).toContain('Live at Budokan');
    expect(body).toContain('1995-05-01');
    expect(body).toContain('JP');
    expect(body).toContain('CD');
    expect(body).toContain('<td>12</td>');
    expect(body).toContain('action="?/select"');
    expect(body).toContain('value="boot-1"');
    expect(body).toContain('value="boot-2"');
    // Awaiting selection is not terminal: cancelling remains available.
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
      },
    });
    expect(body).not.toContain('data-testid="edition-candidates"');
    expect(body).toContain('data-testid="no-candidates"');
    expect(body).toContain('data-testid="cancel"');
  });

  it('renders no edition-candidates section outside the awaiting-selection state', () => {
    const { body } = render(AcquisitionDetail, { props: { acquisition: working } });
    expect(body).not.toContain('data-testid="edition-candidates"');
  });

  it('renders an action failure and an empty history', () => {
    const { body } = render(AcquisitionDetail, {
      props: {
        acquisition: { ...working, history: [], currentCandidate: undefined },
        error: 'Something went wrong (store). Try again.',
      },
    });
    expect(body).toContain('data-testid="action-error"');
    expect(body).toContain('data-testid="no-history"');
  });
});
