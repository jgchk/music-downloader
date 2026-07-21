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
});
