import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AcquisitionForm from './AcquisitionForm.svelte';

describe('AcquisitionForm (SSR)', () => {
  it('renders the musicbrainz kind by default', () => {
    const { body } = render(AcquisitionForm, { props: {} });
    expect(body).toContain('name="mbid"');
    expect(body).not.toContain('name="artist"');
    expect(body).not.toContain('data-testid="form-error"');
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
  });
});
