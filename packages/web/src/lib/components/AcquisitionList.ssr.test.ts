import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import AcquisitionList from './AcquisitionList.svelte';

const candidate = { username: 'u', path: 'p', sizeBytes: 1 };

/** Local builder: each test shows only its one significant field over sane defaults. */
function acquisition(over: Partial<AcquisitionStatusResponseDto>): AcquisitionStatusResponseDto {
  return {
    acquisitionId: 'acq',
    status: 'Searching',
    attempts: 0,
    rejectedCount: 0,
    history: [],
    ...over,
  };
}

describe('AcquisitionList (SSR)', () => {
  it('renders the empty state with the request link', () => {
    const { body } = render(AcquisitionList, { props: { acquisitions: [] } });
    expect(body).toContain('data-testid="empty"');
    expect(body).toContain('/acquisitions/new');
  });

  it('renders each acquisition as a compact row: target, phase signal, attempts', () => {
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          // In-progress, target not yet resolved → the "(resolving…)" placeholder.
          acquisition({ acquisitionId: 'acq-1', status: 'Searching', attempts: 1 }),
          // Terminal with a resolved target; its failure reason must NOT leak into the list.
          acquisition({
            acquisitionId: 'acq-2',
            status: 'Exhausted',
            target: { artist: 'A', title: 'T' },
            attempts: 3,
            rejectedCount: 2,
            history: [{ kind: 'download-failed', at: 't', candidate, reason: 'Stalled' }],
          }),
        ],
      },
    });
    // The in-progress row shows its granular phase + attempts and the resolving placeholder…
    expect(body).toContain('(resolving…)');
    expect(body).toContain('Searching'); // granular phase for the in-progress row
    expect(body).toContain('data-phase="pending"');
    expect(body).toContain('/acquisitions/acq-1');
    // …the terminal row shows its target, a Failed badge, and its attempts…
    expect(body).toContain('A — T');
    expect(body).toContain('data-phase="failed"'); // Exhausted → Failed badge
    expect(body).toContain('3 attempts');
    // …but the long outcome / failure reason is NOT in the list — it lives in the detail pane.
    expect(body).not.toContain('Exhausted');
    expect(body).not.toContain('Stalled');
    // With no selection, no row is marked current.
    expect(body).not.toContain('aria-current');
  });

  it('marks the selected acquisition as the current row', () => {
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          acquisition({ acquisitionId: 'acq-1', target: { artist: 'A', title: 'T' } }),
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
          acquisition({
            acquisitionId: 'acq-waiting',
            status: 'AwaitingManualSelection',
            candidates: [{ releaseMbid: 'r1', title: 'OK Computer', trackCount: 12 }],
          }),
          acquisition({
            acquisitionId: 'acq-searching',
            status: 'Searching',
            target: { artist: 'A', title: 'T' },
            attempts: 1,
          }),
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
