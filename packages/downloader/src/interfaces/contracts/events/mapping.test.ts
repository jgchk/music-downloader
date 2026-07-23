import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type { AcquisitionEvent } from '../../../domain/acquisition/events.js';
import {
  importingHistory,
  matchingCandidate,
  sampleFiles,
  sampleTarget,
} from '../../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { asMbid } from '../../../domain/shared/__fixtures__/mbid.js';
import { createTarget } from '../../../domain/target/target.js';
import type { Target } from '../../../domain/target/target.js';
import { publishedEventMapping } from './mapping.js';

const OCCURRED_AT = '2026-07-03T12:00:00.000Z';
const LOCATION = '/library/Radiohead/Kid A (2000)';

function stored(events: readonly AcquisitionEvent[], streamId = 'acq-1'): StoredEvent[] {
  return events.map((event, index) => ({
    globalSeq: index + 1,
    streamId,
    version: index,
    type: event.type,
    event,
    metadata: { acquisitionId: streamId, occurredAt: OCCURRED_AT },
  }));
}

const candidate = matchingCandidate('peer');

function fulfilledHistory(target: Target = sampleTarget): AcquisitionEvent[] {
  const base = importingHistory([candidate]).map((event) =>
    event.type === 'TargetResolved' ? { ...event, target } : event,
  );
  return [
    ...base,
    { type: 'Imported', candidate: candidate.identity, location: LOCATION, files: sampleFiles },
    { type: 'AcquisitionFulfilled', location: LOCATION },
  ];
}

function renderLast(events: readonly AcquisitionEvent[]) {
  const prefix = stored(events);
  return publishedEventMapping.render(prefix.at(-1)!, prefix);
}

describe('publishedEventMapping.publishes', () => {
  it('maps AcquisitionFulfilled and nothing else', () => {
    expect(publishedEventMapping.publishes('AcquisitionFulfilled')).toBe(true);
    expect(publishedEventMapping.publishes('AcquisitionRequested')).toBe(false);
    expect(publishedEventMapping.publishes('Imported')).toBe(false);
  });
});

describe('publishedEventMapping.render — acquisition.fulfilled', () => {
  it('renders the fat payload from the stream prefix', () => {
    const target: Target = createTarget({
      ...sampleTarget,
      mbid: asMbid('release-mbid-1'),
    })._unsafeUnwrap();
    const rendered = renderLast(fulfilledHistory(target))._unsafeUnwrap();

    expect(rendered.type).toBe('acquisition.fulfilled');
    expect(rendered.timestamp).toBe(OCCURRED_AT);
    expect(rendered.data).toEqual({
      acquisitionId: 'acq-1',
      target: {
        type: 'album',
        artist: 'Radiohead',
        title: 'Kid A',
        musicbrainzReleaseId: 'release-mbid-1',
        year: 2000,
        trackCount: 2,
      },
      candidate: candidate.identity,
      location: LOCATION,
      files: [
        { name: '01.flac', path: `${LOCATION}/01.flac` },
        { name: '02.flac', path: `${LOCATION}/02.flac` },
      ],
    });
  });

  it('renders explicit nulls for a target without MusicBrainz id or year', () => {
    const { year: _year, ...targetNoYear } = sampleTarget;
    const rendered = renderLast(fulfilledHistory(targetNoYear))._unsafeUnwrap();
    const data = rendered.data as {
      target: { musicbrainzReleaseId: string | null; year: number | null };
    };
    expect(data.target.musicbrainzReleaseId).toBeNull();
    expect(data.target.year).toBeNull();
  });

  it('renders an empty file listing when the Imported event carries none (legacy histories)', () => {
    const history = fulfilledHistory().map((event) =>
      event.type === 'Imported' ? { ...event, files: undefined } : event,
    );
    const rendered = renderLast(history)._unsafeUnwrap();
    expect((rendered.data as { files: unknown[] }).files).toEqual([]);
  });

  it('fails on a stream prefix with no TargetResolved', () => {
    const history = fulfilledHistory().filter((event) => event.type !== 'TargetResolved');
    const error = renderLast(history)._unsafeUnwrapErr();
    expect(error.kind).toBe('RenderError');
    expect(error.message).toContain('TargetResolved');
  });

  it('fails on a stream prefix with no Imported', () => {
    const history = fulfilledHistory().filter((event) => event.type !== 'Imported');
    const error = renderLast(history)._unsafeUnwrapErr();
    expect(error.message).toContain('Imported');
  });

  it('refuses an event type without a published mapping', () => {
    const history = fulfilledHistory();
    const prefix = stored(history.slice(0, 1));
    const error = publishedEventMapping.render(prefix[0]!, prefix)._unsafeUnwrapErr();
    expect(error.message).toContain('no published mapping');
  });

  it('refuses a payload that violates the outbound schema (it must never leave the process)', () => {
    const history = fulfilledHistory().map((event) =>
      event.type === 'AcquisitionFulfilled' ? { ...event, location: '' } : event,
    );
    const error = renderLast(history)._unsafeUnwrapErr();
    expect(error.kind).toBe('RenderError');
    expect(error.message).toContain('schema');
  });
});
