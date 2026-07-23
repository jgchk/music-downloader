import { describe, expect, it } from 'vitest';
import { legacyRejectResolvedData } from './__fixtures__/legacy-review-resolved.js';
import {
  buildUpcasterRegistry,
  CURRENT_SCHEMA_VERSION,
  reviewResolvedV1ToV2,
  UpcasterRegistry,
} from './upcaster.js';

describe('reviewResolvedV1ToV2', () => {
  it('lifts the legacy verb to reject-unusable-delivery, preserving reasons', () => {
    expect(reviewResolvedV1ToV2(legacyRejectResolvedData(['corrupt rip']))).toEqual({
      type: 'ReviewResolved',
      resolution: { kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] },
    });
  });

  it('passes a ReviewResolved carrying any other resolution kind through untouched', () => {
    const v1 = { type: 'ReviewResolved', resolution: { kind: 'reject', reason: 'wrong album' } };

    // Byte-for-byte: a non-rejection-of-delivery resolution is not this rename's concern.
    expect(reviewResolvedV1ToV2(v1)).toBe(v1);
  });
});

describe('buildUpcasterRegistry', () => {
  it('lifts a v1 ReviewResolved rejection and leaves a v2 one alone', () => {
    const registry = buildUpcasterRegistry();

    expect(registry.upcast('ReviewResolved', 1, legacyRejectResolvedData(['corrupt rip']))).toEqual(
      {
        type: 'ReviewResolved',
        resolution: { kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] },
      },
    );

    const v2 = {
      type: 'ReviewResolved',
      resolution: { kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] },
    };
    // Already current: returned by reference, not needlessly cloned.
    expect(registry.upcast('ReviewResolved', CURRENT_SCHEMA_VERSION, v2)).toBe(v2);
  });

  it('lifts a v1 ReviewResolved of a non-rejection kind through the wired path untouched', () => {
    const registry = buildUpcasterRegistry();
    const v1 = { type: 'ReviewResolved', resolution: { kind: 'accept' } };

    // The rename only touches the rejection verb; other v1 resolutions flow through the registry.
    expect(registry.upcast('ReviewResolved', 1, v1)).toBe(v1);
  });

  it('leaves a non-ReviewResolved type untouched', () => {
    const registry = buildUpcasterRegistry();
    const data = { type: 'ImportApplied', location: '/library/album' };

    expect(registry.upcast('ImportApplied', 1, data)).toBe(data);
  });
});

describe('UpcasterRegistry', () => {
  it('is pass-through when nothing is registered (the MVP)', () => {
    const registry = new UpcasterRegistry();
    const data = { type: 'ImportApplied', location: '/library/album' };

    expect(registry.upcast('ImportApplied', 1, data)).toEqual({
      type: 'ImportApplied',
      location: '/library/album',
    });
  });

  it('chains registered upcasters from the stored version to the latest shape', () => {
    const registry = new UpcasterRegistry()
      .register('Widened', 1, (data) => ({ ...data, two: true }))
      .register('Widened', 2, (data) => ({ ...data, three: true }));

    const result = registry.upcast('Widened', 1, { type: 'Widened', one: true }) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ type: 'Widened', one: true, two: true, three: true });
  });

  it('starts the chain at the stored version, skipping already-applied steps', () => {
    const registry = new UpcasterRegistry().register('Widened', 1, (data) => ({
      ...data,
      two: true,
    }));

    // Stored at version 2: no upcaster registered for v2, so it is already current.
    const result = registry.upcast('Widened', 2, { type: 'Widened', two: true }) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ type: 'Widened', two: true });
  });

  it('passes a future/unknown schema version through untouched (forward compatibility)', () => {
    const registry = new UpcasterRegistry().register('Widened', 1, (data) => ({
      ...data,
      two: true,
    }));

    // A newer writer stamped v5; this reader knows only a v1→v2 step. With no upcaster registered at
    // or above v5, the payload is already at-or-beyond the reader's latest shape and flows through.
    const result = registry.upcast('Widened', 5, { type: 'Widened', future: true }) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ type: 'Widened', future: true });
  });
});
