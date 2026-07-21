import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ManualTagsForm from './ManualTagsForm.svelte';

const row = { path: '/in/01.flac', title: 'One', artist: '', trackNumber: '1', discNumber: '' };

describe('ManualTagsForm', () => {
  it('adds and removes track rows', async () => {
    render(ManualTagsForm, {});
    await page.getByText('Import with manual tags').click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(1);
    expect(page.getByTestId('remove-track').query()).toBeNull();

    await page.getByTestId('add-track').click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(2);

    await page.getByTestId('remove-track').first().click();
    expect(page.getByTestId('track-row').elements()).toHaveLength(1);
  });

  it('renders provided initial rows', () => {
    render(ManualTagsForm, { initialRows: [row, { ...row, path: '/in/02.flac' }] });
    expect(page.getByTestId('track-row').elements()).toHaveLength(2);
  });
});
