import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ResolveForms from './ResolveForms.svelte';

describe('ResolveForms (SSR)', () => {
  it('renders nothing when no verb is enabled', () => {
    const { body } = render(ResolveForms, { props: {} });
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
    const { body } = render(ResolveForms, {
      props: {
        supplyId: true,
        refresh: true,
        importAsIs: true,
        reject: true,
        rejectUnusable: true,
        accept: true,
        retryEnrichment: true,
      },
    });
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
});
