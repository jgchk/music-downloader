import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { StoredEvent } from '../../application/ports/event-store-port.js';
import { InProcessEventBus } from './event-bus.js';

function storedAt(globalSeq: number): StoredEvent {
  return {
    globalSeq,
    streamId: 'imp-1',
    version: globalSeq - 1,
    type: 'ImportApplied',
    event: { type: 'ImportApplied', location: '/library/album' },
    metadata: { importId: 'imp-1', occurredAt: '2026-07-03T12:00:00.000Z' },
  };
}

describe('InProcessEventBus', () => {
  it('fans committed events out to every subscriber', () => {
    const bus = new InProcessEventBus(silentLogger());
    const seen: number[] = [];
    bus.subscribe((event) => {
      seen.push(event.globalSeq);
    });
    bus.subscribe((event) => {
      seen.push(event.globalSeq * 10);
    });

    bus.publish([storedAt(1), storedAt(2)]);

    expect(seen).toEqual([1, 10, 2, 20]);
  });

  it('stops delivering once a subscriber unsubscribes', () => {
    const bus = new InProcessEventBus(silentLogger());
    const seen: number[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(event.globalSeq);
    });

    bus.publish([storedAt(1)]);
    unsubscribe();
    bus.publish([storedAt(2)]);

    expect(seen).toEqual([1]);
  });

  it('isolates a throwing subscriber: it is logged, and its peers still receive the event', () => {
    const logger = silentLogger();
    const errorSpy = vi.spyOn(logger, 'error');
    const bus = new InProcessEventBus(logger);
    const seen: number[] = [];
    bus.subscribe(() => {
      throw new Error('subscriber boom');
    });
    bus.subscribe((event) => {
      seen.push(event.globalSeq);
    });

    expect(() => bus.publish([storedAt(1)])).not.toThrow();

    // The healthy peer still saw the event, and the fault was surfaced (never swallowed silently).
    expect(seen).toEqual([1]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ globalSeq: 1 }),
      'event-bus subscriber threw; isolated',
    );
  });
});
