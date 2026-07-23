import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ManualTagsForm from './ManualTagsForm.svelte';

const row = { path: '/in/01.flac', title: 'One', artist: '', trackNumber: '1', discNumber: '' };

describe('ManualTagsForm', () => {
  it('adds and removes track rows', async () => {
    await render(ManualTagsForm, {});
    await page.getByText('Import with manual tags').click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(1);
    expect(page.getByTestId('remove-track').query()).toBeNull();

    await page.getByTestId('add-track').click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(2);

    await page.getByTestId('remove-track').first().click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(1);
  });

  it('renders provided initial rows, bound and numbered', async () => {
    await render(ManualTagsForm, {
      initialRows: [row, { ...row, path: '/in/02.flac', title: 'Two' }],
    });
    expect(page.getByTestId('track-row').elements()).toHaveLength(2);
    // The first row's title input is bound to the provided value, not just present.
    await expect.element(page.getByLabelText('Title').first()).toHaveValue('One');
    // Legends number the rows by position.
    await expect.element(page.getByText('Track 2')).toBeInTheDocument();
  });
});
