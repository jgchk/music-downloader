import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ReviewQueue from './ReviewQueue.svelte';

describe('ReviewQueue (SSR)', () => {
  it('renders the empty state', () => {
    const { body } = render(ReviewQueue, { props: { reviews: [] } });
    expect(body).toContain('data-testid="empty"');
  });

  it('renders one linked row per pending review with kind and context', () => {
    const { body } = render(ReviewQueue, {
      props: {
        reviews: [
          { importId: 'imp-1', path: '/intake/a', review: { kind: 'no-match' } },
          {
            importId: 'imp-2',
            path: '/intake/b',
            review: { kind: 'remediation-review', failures: [{ stage: 'fetchart', message: 'x' }] },
          },
        ],
      },
    });
    expect(body).toContain('/reviews/imp-1');
    expect(body).toContain('No match');
    expect(body).toContain('Beets found no candidates at all');
    expect(body).toContain('/reviews/imp-2');
    expect(body).toContain('Import applied, but fetchart failed');
  });
});
