import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AcquisitionForm from './AcquisitionForm.svelte';

describe('AcquisitionForm', () => {
  it('starts on musicbrainz and swaps the fields when the kind changes', async () => {
    await render(AcquisitionForm, {});
    await expect.element(page.getByTestId('mbid')).toBeVisible();
    // The target type defaults to album when no value is echoed.
    await expect.element(page.getByTestId('target-type')).toHaveValue('album');

    await page.getByTestId('kind').selectOptions('descriptor');
    await expect.element(page.getByTestId('artist')).toBeVisible();
    expect(page.getByTestId('mbid').query()).toBeNull();

    await page.getByTestId('kind').selectOptions('musicbrainz');
    await expect.element(page.getByTestId('mbid')).toBeVisible();
  });

  it('offers the release-group kind: id field shown, target type fixed to album', async () => {
    await render(AcquisitionForm, {});
    await page.getByTestId('kind').selectOptions('release-group');
    await expect.element(page.getByTestId('mbid')).toBeVisible();
    expect(page.getByTestId('target-type').query()).toBeNull();
  });

  it('renders a rejected submission: error banner plus echoed values', async () => {
    await render(AcquisitionForm, {
      error: 'Invalid input: title required',
      values: { kind: 'descriptor', targetType: 'track', artist: 'A', title: 'T', album: 'L' },
    });
    await expect
      .element(page.getByTestId('form-error'))
      .toHaveTextContent('Invalid input: title required');
    await expect.element(page.getByTestId('artist')).toHaveValue('A');
    // A track descriptor echoes its target type as the selected option.
    await expect.element(page.getByTestId('target-type')).toHaveValue('track');
  });

  it('seeds the policy fields from the echoed values', async () => {
    await render(AcquisitionForm, {
      values: {
        mbid: 'mb-7',
        qualityFloor: 'LOSSLESS',
        qualityOrder: 'LOSSLESS',
        matchThreshold: '0.5',
        maxSearchRounds: '1',
        maxTotalAttempts: '2',
        timeBudgetMs: '1000',
        stallTimeoutMs: '2000',
        maxQueueWaitMs: '3000',
      },
    });
    await expect.element(page.getByTestId('submit-form')).toBeVisible();
    // The seeded numeric policies actually populate their inputs.
    await expect.element(page.getByLabelText(/Match threshold/)).toHaveValue('0.5');
    await expect.element(page.getByLabelText(/Time budget/)).toHaveValue('1000');
    // The quality floor select shows the echoed LOSSLESS option as selected.
    await expect.element(page.getByLabelText('Quality floor')).toHaveValue('LOSSLESS');
  });
});
