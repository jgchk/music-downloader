import { describe, expect, it } from 'vitest';
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
    const bus = new InProcessEventBus();
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
    const bus = new InProcessEventBus();
    const seen: number[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(event.globalSeq);
    });

    bus.publish([storedAt(1)]);
    unsubscribe();
    bus.publish([storedAt(2)]);

    expect(seen).toEqual([1]);
  });
});
