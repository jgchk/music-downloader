import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { RESOLUTION_ACTIONS } from '$lib/resolution-actions.js';
import ResolveForms from './ResolveForms.svelte';

// Derived from the verb inventory, so a new verb exercises this suite without a hand-edit.
const ALL_ON = { actions: new Set(Object.keys(RESOLUTION_ACTIONS)) };

describe('ResolveForms (SSR)', () => {
  it('renders nothing when no verb is enabled', () => {
    const { body } = render(ResolveForms, { props: { actions: new Set<string>() } });
    for (const id of [
      'supply-id',
      'refresh',
      'import-as-is',
      'accept',
      'retry-enrichment',
      'reject',
      'reject-unusable',
    ]) {
      expect(body).not.toContain(`data-testid="${id}"`);
    }
  });

  it('renders each enabled verb as its own form', () => {
    const { body } = render(ResolveForms, { props: ALL_ON });
    for (const id of [
      'supply-id',
      'refresh',
      'import-as-is',
      'accept',
      'retry-enrichment',
      'reject',
      'reject-unusable',
    ]) {
      expect(body).toContain(`data-testid="${id}"`);
    }
    // Each form carries the exact resolve verb the facade dispatches on — the testid alone would
    // pass even if a form posted the wrong verb.
    for (const verb of [
      'supply-id',
      'refresh-candidates',
      'import-as-is',
      'accept',
      'retry-enrichment',
      'reject',
      'reject-unusable-delivery',
    ]) {
      expect(body).toContain(`value="${verb}"`);
    }
  });

  it('labels every action from the verb inventory — imperative, em-dash consequence, no asides', () => {
    const { body } = render(ResolveForms, { props: ALL_ON });
    expect(body).toContain('Import as-is — keep the current tags');
    expect(body).toContain('Refresh the candidates — search the connected sources again');
    expect(body).toContain('Accept it as-is — leave the failed steps undone');
    expect(body).toContain('Retry the failed steps');
    expect(body).toContain('Reject the import — delete the files; nothing more will be tried');
    expect(body).toContain('Reject the files — delete them and search for a replacement');
    // The old parenthesized asides are gone.
    expect(body).not.toContain('(delete files)');
    expect(body).not.toContain('(keep current tags)');
  });

  it('opens the release-ID form behind an ellipsis summary and never names the matcher', () => {
    const { body } = render(ResolveForms, { props: { actions: new Set(['supply-id']) } });
    expect(body).toContain('Supply a release ID…');
    expect(body).toContain('Search with this release ID');
    expect(body).toContain('from any connected source');
    expect(body).not.toContain('beets');
  });

  it('styles exactly the file-deleting verbs as low-emphasis danger', () => {
    const { body } = render(ResolveForms, { props: ALL_ON });
    // Identity, not just cardinality: the danger class sits inside exactly the two deleting
    // forms and nowhere else (slice the render at each form's testid).
    const upToReject = body.split('data-testid="reject"', 1)[0] ?? '';
    const fromReject = body.slice(upToReject.length);
    expect(upToReject).not.toContain('danger');
    const rejectSlice = fromReject.split('data-testid="reject-unusable"', 1)[0] ?? '';
    const unusableSlice = fromReject.slice(rejectSlice.length);
    expect(rejectSlice).toContain('class="btn danger"');
    expect(unusableSlice).toContain('class="btn danger"');
  });
});
