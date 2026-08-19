import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type { ImportEvent } from '../../../domain/import/events.js';
import {
  DELIVERED_CANDIDATE,
  SOURCE,
  awaitingReviewWithCandidate,
  resolved,
} from '../../../domain/import/__fixtures__/import-fixtures.js';
import { toOriginatingDownloadId } from '../../../domain/shared/originating-download-id.js';
import { OTHER_STORY, STORY } from '../../../application/__fixtures__/correlation.js';
import { publishedEventMapping } from './mapping.js';

const OCCURRED_AT = '2026-07-18T12:00:00.000Z';

function stored(
  events: readonly ImportEvent[],
  streamId = 'imp-1',
  storyOf: (event: ImportEvent, index: number) => string | undefined = () => STORY,
): StoredEvent[] {
  return events.map((event, index) => ({
    globalSeq: index + 1,
    streamId,
    version: index,
    type: event.type,
    event,
    metadata: { importId: streamId, occurredAt: OCCURRED_AT, correlationId: storyOf(event, index) },
  }));
}

function verdictHistory(
  overrides: Partial<Extract<ImportEvent, { type: 'ReleaseVerdictRecorded' }>> = {},
): ImportEvent[] {
  return [
    ...awaitingReviewWithCandidate(),
    resolved({ kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] }),
    {
      type: 'ReleaseVerdictRecorded',
      acquisitionId: SOURCE.acquisitionId,
      candidate: DELIVERED_CANDIDATE,
      reasons: ['corrupt rip'],
      ...overrides,
    },
  ];
}

function renderLast(events: readonly ImportEvent[]) {
  const prefix = stored(events);
  return publishedEventMapping.render(prefix.at(-1)!, prefix);
}

describe('publishedEventMapping.publishes', () => {
  it('maps ReleaseVerdictRecorded and nothing else', () => {
    expect(publishedEventMapping.publishes('ReleaseVerdictRecorded')).toBe(true);
    expect(publishedEventMapping.publishes('ImportRequested')).toBe(false);
    expect(publishedEventMapping.publishes('ImportRejected')).toBe(false);
  });
});

describe('publishedEventMapping.render — release.verdict', () => {
  it('renders the self-contained payload from the recorded verdict', () => {
    const rendered = renderLast(verdictHistory())._unsafeUnwrap();

    expect(rendered.type).toBe('release.verdict');
    expect(rendered.timestamp).toBe(OCCURRED_AT);
    expect(rendered.data).toEqual({
      acquisitionId: 'acq-1',
      candidate: DELIVERED_CANDIDATE,
      verdict: 'rejected',
      reasons: ['corrupt rip'],
    });
  });

  it('omits sizeBytes — never null — when the retained candidate has none', () => {
    const { sizeBytes: _size, ...bareCandidate } = DELIVERED_CANDIDATE;
    const rendered = renderLast(verdictHistory({ candidate: bareCandidate }))._unsafeUnwrap();
    const data = rendered.data as { candidate: Record<string, unknown> };
    expect(data.candidate).toEqual(bareCandidate);
    expect('sizeBytes' in data.candidate).toBe(false);
  });

  it('refuses an event type without a published mapping', () => {
    const prefix = stored(verdictHistory().slice(0, 1));
    const error = publishedEventMapping.render(prefix[0]!, prefix)._unsafeUnwrapErr();
    expect(error.kind).toBe('RenderError');
    expect(error.message).toContain('no published mapping');
  });

  it('refuses a payload that violates the outbound schema (it must never leave the process)', () => {
    const error = renderLast(
      verdictHistory({ acquisitionId: toOriginatingDownloadId('') }),
    )._unsafeUnwrapErr();
    expect(error.kind).toBe('RenderError');
    expect(error.message).toContain('schema');
  });
});

describe('published correlation metadata', () => {
  const SECOND_DELIVERY_STORY = 'ffffffffffffffffffffffffffffffff';

  it('publishes under the cycle story, not the story of the request that resolved the review', () => {
    // The human resolution is its own trigger with its own story; the verdict is a fact about the
    // import cycle, so it must go out under the story that crossed the seam inbound.
    const events = verdictHistory();
    const prefix = stored(events, 'imp-1', (event) =>
      event.type === 'ImportRequested' ? STORY : OTHER_STORY,
    );

    const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix)._unsafeUnwrap();

    expect(rendered.metadata).toEqual({
      correlationId: STORY,
      causation: {
        kind: 'event',
        context: 'importer',
        streamId: 'imp-1',
        version: prefix.at(-1)!.version,
      },
    });
  });

  it('publishes a revived cycle under ITS delivery story, not the original delivery story', () => {
    // The revival loop reopens the same stream with a fresh adopted story. Walking back to the
    // stream's FIRST event instead of the cycle's would file the second verdict under the first
    // delivery's story and cross two unrelated operations.
    const firstCycle = verdictHistory();
    const events = [...firstCycle, ...verdictHistory()];
    let seenRequests = 0;
    const prefix = stored(events, 'imp-1', (event) => {
      if (event.type !== 'ImportRequested') return;
      seenRequests += 1;
      return seenRequests === 1 ? STORY : SECOND_DELIVERY_STORY;
    });

    const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix)._unsafeUnwrap();

    expect(rendered.metadata).toMatchObject({ correlationId: SECOND_DELIVERY_STORY });
  });

  it('publishes a verdict under the story of the cycle it belongs to, not of one opened after it', () => {
    // The bound on the walk-back is the renderer's own, deliberately redundant with the feed's
    // truncation: `render` is a public port method and callers do hand it whole streams (the
    // full-circle test does). A revived acquisition's stream carries a LATER cycle, and an
    // unbounded walk-back would refile the FIRST delivery's verdict under the replacement's story
    // every time that verdict is re-rendered.
    const firstCycle = verdictHistory();
    const events = [...firstCycle, ...verdictHistory()];
    let seenRequests = 0;
    const stream = stored(events, 'imp-1', (event) => {
      if (event.type !== 'ImportRequested') return;
      seenRequests += 1;
      return seenRequests === 1 ? STORY : SECOND_DELIVERY_STORY;
    });
    const firstVerdict = stream[firstCycle.length - 1]!;

    const rendered = publishedEventMapping.render(firstVerdict, stream)._unsafeUnwrap();

    expect(rendered.metadata).toEqual({
      correlationId: STORY,
      causation: {
        kind: 'event',
        context: 'importer',
        streamId: 'imp-1',
        version: firstVerdict.version,
      },
    });
  });

  it('omits the block when the prefix carries no cycle start to take a story from', () => {
    // Defensive, not decorative: the story is a property of the CYCLE, so with no cycle in the
    // prefix there is no story to publish — and inventing one is exactly what is forbidden.
    const events = verdictHistory().filter((event) => event.type !== 'ImportRequested');
    const prefix = stored(events);

    const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix)._unsafeUnwrap();

    expect(rendered.metadata).toBeUndefined();
  });

  it('omits the block when the cycle story is present but malformed', () => {
    const prefix = stored(verdictHistory(), 'imp-1', (event) =>
      event.type === 'ImportRequested' ? 'not-a-trace-id' : STORY,
    );

    const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix)._unsafeUnwrap();

    expect(rendered.metadata).toBeUndefined();
  });

  it('omits the block entirely for a cycle stored before correlation existed', () => {
    const prefix = stored(verdictHistory(), 'imp-1', () => {
      return;
    });

    const rendered = publishedEventMapping.render(prefix.at(-1)!, prefix)._unsafeUnwrap();

    // No correlation block for a cycle whose rows predate the capability: nothing is fabricated.
    //
    // Asserted as "no value", not as "no key". `expect('metadata' in rendered).toBe(false)` would
    // also pass and would kill one more mutant, but it would pin a distinction nothing can observe:
    // `JSON.stringify` drops an `undefined` property, so the two shapes are byte-identical on the
    // wire; `OutboundFeed` re-adds the key unconditionally one layer out; and no consumer reads a
    // published event with `in` or `Object.keys`. That assertion would exist for the mutation score
    // rather than for a reader, so the mutant carries a recorded-survivor marker at its site in
    // `mapping.ts` — where the machine now reads it, instead of only this paragraph.
    expect(rendered.metadata).toBeUndefined();
    expect(rendered.data).toBeDefined(); // the payload is unaffected by the envelope's absence
  });
});
