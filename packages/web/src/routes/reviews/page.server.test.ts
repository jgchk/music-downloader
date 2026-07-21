import { describe, expect, it } from 'vitest';
import type { ImporterFacade } from '@music/importer';
import { load } from './+page.server.js';

describe('review queue load', () => {
  it('returns the facade pending-review read model unchanged', () => {
    const list = { reviews: [{ importId: 'imp-1' }] };
    const facades = { importer: { listPendingReviews: () => list } as unknown as ImporterFacade };
    expect(load({ locals: { facades } } as never)).toEqual({ list });
  });
});
