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
