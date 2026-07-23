import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, UpcasterRegistry, buildUpcasterRegistry } from './upcaster.js';

describe('UpcasterRegistry', () => {
  it('is pass-through when nothing is registered (the MVP)', () => {
    const registry = new UpcasterRegistry();
    const data = { type: 'AcquisitionExhausted' };

    expect(registry.upcast('AcquisitionExhausted', 1, data)).toEqual({
      type: 'AcquisitionExhausted',
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

  it('stamps new events at the current schema version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
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
