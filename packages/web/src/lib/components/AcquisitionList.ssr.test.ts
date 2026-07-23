import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionList from './AcquisitionList.svelte';

const candidate = { username: 'u', path: 'p', sizeBytes: 1 };

describe('AcquisitionList (SSR)', () => {
  it('renders the empty state with the request link', () => {
    const { body } = render(AcquisitionList, { props: { acquisitions: [] } });
    expect(body).toContain('data-testid="empty"');
    expect(body).toContain('/acquisitions/new');
  });

  it('renders working and terminal rows with target, phase, and outcome', () => {
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          {
            acquisitionId: 'acq-1',
            status: 'Searching',
            target: { artist: 'A', title: 'T' },
            attempts: 1,
            rejectedCount: 0,
            history: [],
          },
          {
            acquisitionId: 'acq-2',
            status: 'Exhausted',
            attempts: 3,
            rejectedCount: 2,
            history: [{ kind: 'download-failed', candidate, reason: 'Stalled' }],
          },
        ],
      },
    });
    expect(body).toContain('A — T');
    expect(body).toContain('(resolving…)');
    expect(body).toContain('/acquisitions/acq-1');
    expect(body).toContain('Exhausted (Stalled)');
    expect(body).toContain('Searching');
  });

  it('marks the selected acquisition as the current row', () => {
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          {
            acquisitionId: 'acq-1',
            status: 'Searching',
            target: { artist: 'A', title: 'T' },
            attempts: 1,
            rejectedCount: 0,
            history: [],
          },
        ],
        selectedId: 'acq-1',
      },
    });
    expect(body).toContain('aria-current="true"');
  });

  it('presents an awaiting-selection row as action-needed while a searching row stays generic', () => {
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          {
            acquisitionId: 'acq-waiting',
            status: 'AwaitingManualSelection',
            attempts: 0,
            rejectedCount: 0,
            history: [],
            candidates: [{ releaseMbid: 'r1', title: 'OK Computer', trackCount: 12 }],
          },
          {
            acquisitionId: 'acq-searching',
            status: 'Searching',
            target: { artist: 'A', title: 'T' },
            attempts: 1,
            rejectedCount: 0,
            history: [],
          },
        ],
      },
    });
    expect(body).toContain('data-phase="attention"');
    expect(body).toContain('Action needed');
    expect(body).toContain('OK Computer — awaiting your edition choice');
    expect(body).not.toContain('(resolving…)');
    expect(body).toContain('data-phase="pending"');
  });
});
