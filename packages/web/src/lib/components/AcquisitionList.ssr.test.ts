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
          // In-progress, target not yet resolved → titled by the request as given.
          acquisition({
            acquisitionId: 'acq-1',
            // Validating: its phrase ("Checking quality") differs from the enum identifier, so the
            // human-phrase assertion below can actually fail on a raw-enum regression.
            status: 'Validating',
            attempts: 1,
            requestedTarget: { kind: 'descriptor', targetType: 'album', artist: 'R', title: 'Q' },
          }),
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
    // The in-progress row shows its granular phase + attempts, titled by the request as given…
    expect(body).toContain('R — Q');
    expect(body).toContain('Checking quality'); // the human phrase, not the raw enum
    expect(body).not.toContain('Validating');
    expect(body).toContain('1 attempt');
    expect(body).not.toContain('1 attempts');
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

  it('renders the rows in the order it is given, without re-sorting them', () => {
    // Recency is decided upstream, in the layout's load (orderByNewestRequest) — this component
    // knows nothing about it and must simply not disturb the order on the way to the DOM. Both
    // rows are asserted present first: `indexOf` returns -1 for a missing one, so comparing
    // positions alone would pass vacuously if a row were dropped.
    const { body } = render(AcquisitionList, {
      props: {
        acquisitions: [
          acquisition({ acquisitionId: 'acq-first', target: { artist: 'F', title: 'First' } }),
          acquisition({ acquisitionId: 'acq-second', target: { artist: 'S', title: 'Second' } }),
        ],
      },
    });
    expect(body).toContain('F — First');
    expect(body).toContain('S — Second');
    expect(body.indexOf('F — First')).toBeLessThan(body.indexOf('S — Second'));
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
