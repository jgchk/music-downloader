import { describe, expect, it } from 'vitest';
import { legacyRejectResolvedData } from './__fixtures__/legacy-review-resolved.js';
import {
  buildUpcasterRegistry,
  CURRENT_SCHEMA_VERSION,
  reviewResolvedV1ToV2,
  UpcasterRegistry,
} from './upcaster.js';
import type { Upcaster } from './upcaster.js';

describe('reviewResolvedV1ToV2', () => {
  it('lifts the legacy verb to reject-unusable-delivery, preserving reasons', () => {
    expect(reviewResolvedV1ToV2(legacyRejectResolvedData(['corrupt rip']))).toEqual({
      type: 'ReviewResolved',
      resolution: { kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] },
    });
  });

  it('passes a stored payload carrying no resolution at all through untouched', () => {
    // An upcaster reads raw on-disk JSON, not a typed event, so it is a tolerant reader: a row
    // whose `resolution` is absent is not this rename's concern and flows on. Reaching into the
    // missing field instead would throw, and a throw here poisons the whole stream read — one
    // unreadable row would make the entire import unloadable rather than just unrenamed.
    const v1 = { type: 'ReviewResolved' };

    expect(reviewResolvedV1ToV2(v1)).toBe(v1);
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

  it('continues across absent versions: every step at or above the stored version applies', () => {
    // The schema version is a store-wide counter, so a type's chain is EXPECTED non-contiguous —
    // it skips the versions it did not participate in, and the absence of a step at a version IS
    // the declaration that the type's shape did not change there. Steps {1→2, 3→4, 5→6} with a
    // v1 row therefore apply ALL THREE, in ascending order (registration order must not matter).
    // Each step records that it ran, so the payload itself carries the order they ran in: a chain
    // applied out of order would feed a later shape to an earlier step and corrupt the event.
    const step =
      (label: string): Upcaster =>
      (data) => ({ ...data, applied: [...(data.applied as readonly string[]), label] });
    const registry = new UpcasterRegistry()
      .register('Widened', 1, step('1→2'))
      .register('Widened', 5, step('5→6'))
      .register('Widened', 3, step('3→4'));

    expect(registry.upcast('Widened', 1, { type: 'Widened', applied: [] })).toEqual({
      type: 'Widened',
      applied: ['1→2', '3→4', '5→6'],
    });
  });

  it('starts a non-contiguous chain at the stored version, not below it', () => {
    // A row stored at v4 (after the 3→4 change) must not re-apply the earlier steps.
    const registry = new UpcasterRegistry()
      .register('Widened', 1, (data) => ({ ...data, two: true }))
      .register('Widened', 3, (data) => ({ ...data, four: true }));

    expect(registry.upcast('Widened', 4, { type: 'Widened', four: true })).toEqual({
      type: 'Widened',
      four: true,
    });
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
