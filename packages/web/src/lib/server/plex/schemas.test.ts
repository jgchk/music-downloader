import { describe, expect, it } from 'vitest';
import { plexResourcesSchema } from './schemas.js';

/**
 * The consumed /resources surface stays TOLERANT (external-api-contracts): the fields the
 * predicate reads (`provides`, `owned`) are optional, so their absence decodes cleanly — and the
 * adapter's least-privilege defaults (deny membership, guest role) do the failing-closed, not the
 * schema. These tests pin the decode shapes; the predicate semantics live in adapter tests.
 */
describe('plexResourcesSchema', () => {
  it('decodes an entry carrying only a clientIdentifier — provides and owned stay absent', () => {
    const parsed = plexResourcesSchema.parse([{ clientIdentifier: 'machine-1' }]);
    expect(parsed).toEqual([{ clientIdentifier: 'machine-1' }]);
    expect(parsed[0]!.provides).toBeUndefined();
    expect(parsed[0]!.owned).toBeUndefined();
  });

  it('decodes the real wire shapes: single-value and comma-list provides, boolean owned', () => {
    const parsed = plexResourcesSchema.parse([
      { clientIdentifier: 'server-1', provides: 'server', owned: true },
      { clientIdentifier: 'player-1', provides: 'client,player,pubsub-player', owned: false },
    ]);
    expect(parsed).toEqual([
      { clientIdentifier: 'server-1', provides: 'server', owned: true },
      { clientIdentifier: 'player-1', provides: 'client,player,pubsub-player', owned: false },
    ]);
  });

  it('rejects a non-string provides and a non-boolean owned (consumed fields keep their types)', () => {
    expect(plexResourcesSchema.safeParse([{ clientIdentifier: 'x', provides: 1 }]).success).toBe(
      false,
    );
    expect(plexResourcesSchema.safeParse([{ clientIdentifier: 'x', owned: 'yes' }]).success).toBe(
      false,
    );
  });
});
