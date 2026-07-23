import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionForm from './AcquisitionForm.svelte';

describe('AcquisitionForm (SSR)', () => {
  it('renders the musicbrainz kind by default', () => {
    const { body } = render(AcquisitionForm, { props: {} });
    expect(body).toContain('name="mbid"');
    expect(body).not.toContain('name="artist"');
    expect(body).not.toContain('data-testid="form-error"');
    // With no echoed value the target type defaults to album selected, not track.
    expect(body).toContain('value="album" selected');
    expect(body).not.toContain('value="track" selected');
  });

  it('renders the descriptor kind with echoed values and the error banner', () => {
    const { body } = render(AcquisitionForm, {
      props: {
        error: 'Invalid input: artist required',
        values: { kind: 'descriptor', targetType: 'track', title: 'T', album: 'L' },
      },
    });
    expect(body).toContain('data-testid="form-error"');
    expect(body).toContain('Invalid input: artist required');
    expect(body).toContain('name="artist"');
    expect(body).not.toContain('name="mbid"');
    expect(body).toContain('value="T"');
    // A track descriptor echoes its target type as the selected option, not album.
    expect(body).toContain('value="track" selected');
    expect(body).not.toContain('value="album" selected');
  });

  it('renders the release-group kind with an id field and no target-type choice', () => {
    const { body } = render(AcquisitionForm, {
      props: { values: { kind: 'release-group', mbid: 'rg-1' } },
    });
    expect(body).toContain('name="mbid"');
    expect(body).toContain('value="rg-1"');
    expect(body).not.toContain('name="targetType"');
    expect(body).not.toContain('name="artist"');
  });

  it('renders every optional policy field', () => {
    const { body } = render(AcquisitionForm, {
      props: {
        values: {
          qualityFloor: 'LOSSLESS',
          qualityOrder: 'LOSSLESS',
          matchThreshold: '0.5',
          maxSearchRounds: '1',
          maxTotalAttempts: '2',
          timeBudgetMs: '1000',
          stallTimeoutMs: '2000',
          maxQueueWaitMs: '3000',
          mbid: 'mb-7',
        },
      },
    });
    for (const name of [
      'qualityFloor',
      'qualityOrder',
      'matchThreshold',
      'maxSearchRounds',
      'maxTotalAttempts',
      'timeBudgetMs',
      'stallTimeoutMs',
      'maxQueueWaitMs',
    ]) {
      expect(body).toContain(`name="${name}"`);
    }
    expect(body).toContain('value="mb-7"');
    // The seeded values actually populate their inputs, and LOSSLESS renders as the selected option.
    expect(body).toContain('value="0.5"');
    expect(body).toContain('value="1000"');
    expect(body).toContain('value="LOSSLESS" selected');
  });
});
