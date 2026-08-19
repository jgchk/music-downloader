import { readFileSync } from 'node:fs';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { FakeCheckpointStore, silentLogger } from '../../src/application/__fixtures__/fakes.js';
import { catchUpSubscription } from '../../src/application/events/catch-up-subscription.js';
import type {
  CatchUpSubscription,
  SeamFeedBatch,
} from '../../src/application/events/catch-up-subscription.js';
import type { StoredEvent } from '../../src/application/ports/event-store-port.js';
import {
  importingHistory,
  matchingCandidate,
} from '../../src/domain/download/__fixtures__/download-fixtures.js';
import { publishedEventMapping } from '../../src/interfaces/contracts/events/mapping.js';

/**
 * Consumer-driven contract over the seam-error KINDS, the one part of the cross-module feed
 * contract that travels as a bare string. `SeamFeed.read` is a consumer-owned structural port
 * typed `{ kind: string }` — deliberately, because importing the producer's `RenderError` would be
 * a shared kernel — so the consumer's "is this permanent?" decision is a string comparison that
 * no type checks. Rename the literal on either side alone and this module's halt silently degrades
 * into the transient hold path: `seam:verdicts` wedges on the same position forever while
 * `/health` answers 200, which is exactly the defect the halt exists to surface.
 *
 * Each module therefore declares its published kinds in its own `seam-contract.json`, and both
 * roles are pinned against it here: this module as PRODUCER (its render defect carries the kind it
 * declares) and as CONSUMER (its subscription halts on the kind the *importer* declares, and on
 * nothing else). A cross-package read is a test-tier affair, as with the recorded event fixtures;
 * the no-shared-kernel rule governs `src`.
 */

interface SeamContract {
  readonly feedErrorKinds: { readonly permanentRenderDefect: string };
}

function seamContractOf(module: string): SeamContract {
  const location = new URL(`../../../${module}/test/contract/seam-contract.json`, import.meta.url)
    .pathname;
  return JSON.parse(readFileSync(location, 'utf8')) as SeamContract;
}

const OWN = seamContractOf('downloader');
const PRODUCER = seamContractOf('importer');

/** A subscription whose feed only ever fails, with the given kind. */
function subscriptionOverFailingFeed(kind: string): CatchUpSubscription {
  return catchUpSubscription({
    name: 'seam:test',
    feed: {
      read: (): Promise<Result<SeamFeedBatch, { kind: string }>> => Promise.resolve(err({ kind })),
    },
    checkpoints: new FakeCheckpointStore(),
    handler: () => {
      throw new Error('the feed never yields an event to deliver');
    },
    logger: silentLogger(),
    tuning: {
      retry: { attempts: 1, baseDelayMs: 0 },
      sleep: () => Promise.resolve(),
      interval: () => () => {},
    },
  });
}

describe('the seam-error kinds this module publishes', () => {
  it('renders a permanent payload defect with the kind it declares', () => {
    // An event type with no published mapping is the cheapest real render defect: the mapping
    // refuses it, and the refusal is what a consumer sees on the feed.
    const first = importingHistory([matchingCandidate('peer')])[0]!;
    const stored: StoredEvent = {
      globalSeq: 1,
      streamId: 'acq-1',
      version: 0,
      type: first.type,
      event: first,
      metadata: { acquisitionId: 'acq-1', occurredAt: '2026-07-03T12:00:00.000Z' },
    };

    const error = publishedEventMapping.render(stored, [stored])._unsafeUnwrapErr();

    expect(error.kind).toBe(OWN.feedErrorKinds.permanentRenderDefect);
  });
});

describe("this module's subscription over the importer's feed", () => {
  it('halts on exactly the permanent render kind the producer declares', async () => {
    const sub = subscriptionOverFailingFeed(PRODUCER.feedErrorKinds.permanentRenderDefect);

    await sub.start();

    expect(sub.isHalted).toBe(true);
    await sub.stop();
  });

  it('holds rather than halts on any other feed error kind', async () => {
    // The other half of the claim: halting is reserved for the permanent kind. A transient store
    // fault must stay retryable, or a blip would take the module down until an operator resets it.
    const sub = subscriptionOverFailingFeed('InfraError');

    await sub.start();

    expect(sub.isHalted).toBe(false);
    await sub.stop();
  });
});
