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
      'reject-retry',
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
        rejectAndRetry: true,
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
      'reject-retry',
    ]) {
      expect(body).toContain(`data-testid="${id}"`);
    }
    expect(body).toContain('value="reject-and-retry-download"');
  });
});
