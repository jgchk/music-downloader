import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ManualTagsForm from './ManualTagsForm.svelte';

const row = { path: '/in/01.flac', title: 'One', artist: '', trackNumber: '1', discNumber: '' };

describe('ManualTagsForm (SSR)', () => {
  it('renders a single starter row without a remove affordance', () => {
    const { body } = render(ManualTagsForm, { props: {} });
    expect(body).toContain('name="tracks.0.path"');
    expect(body).not.toContain('data-testid="remove-track"');
  });

  it('renders provided rows with remove affordances when plural', () => {
    const { body } = render(ManualTagsForm, {
      props: { initialRows: [row, { ...row, path: '/in/02.flac', title: 'Two' }] },
    });
    expect(body).toContain('name="tracks.1.path"');
    expect(body).toContain('data-testid="remove-track"');
    expect(body).toContain('value="manual-tags"');
  });
});
