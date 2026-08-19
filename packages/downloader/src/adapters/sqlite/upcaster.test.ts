import { describe, expect, it } from 'vitest';
import { UpcasterRegistry, buildUpcasterRegistry } from './upcaster.js';
import type { Upcaster } from './upcaster.js';

describe('UpcasterRegistry', () => {
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

  it('passes a future/unknown schema version through untouched (forward compatibility)', () => {
    // A newer writer stamped v5; this reader knows only a v1→v2 step. With no step at or above
    // v5, the payload is already at-or-beyond the reader's latest shape and flows through.
    const registry = new UpcasterRegistry().register('Widened', 1, (data) => ({
      ...data,
      two: true,
    }));

    expect(registry.upcast('Widened', 5, { type: 'Widened', future: true })).toEqual({
      type: 'Widened',
      future: true,
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

  it('is pass-through when nothing is registered (the MVP)', () => {
    const registry = new UpcasterRegistry();
    const data = { type: 'DownloadExhausted' };

    expect(registry.upcast('DownloadExhausted', 1, data)).toEqual({
      type: 'DownloadExhausted',
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
});

describe('buildUpcasterRegistry — ManualSelectionRequested v1 → v2', () => {
  const registry = buildUpcasterRegistry();

  function upcast(data: Record<string, unknown>): Record<string, unknown> {
    return registry.upcast('ManualSelectionRequested', 1, data);
  }

  it('drops a v1 trackCount: 0 sentinel to absent and passes a real count through', () => {
    const result = upcast({
      type: 'ManualSelectionRequested',
      candidates: [
        { releaseMbid: 'a', title: 'Known', trackCount: 12 },
        { releaseMbid: 'b', title: 'Unknown', trackCount: 0 },
      ],
    });

    expect(result.candidates).toEqual([
      { releaseMbid: 'a', title: 'Known', trackCount: 12 },
      { releaseMbid: 'b', title: 'Unknown' },
    ]);
  });

  it('tolerates an event with no candidates array', () => {
    expect(upcast({ type: 'ManualSelectionRequested' })).toEqual({
      type: 'ManualSelectionRequested',
      candidates: [],
    });
  });

  it('leaves a v2 event (stored at the current version) untouched', () => {
    const v2 = {
      type: 'ManualSelectionRequested',
      candidates: [{ releaseMbid: 'b', title: 'Unknown' }],
    };
    expect(registry.upcast('ManualSelectionRequested', 2, v2)).toEqual(v2);
  });
});
