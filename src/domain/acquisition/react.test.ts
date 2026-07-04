import { describe, expect, it } from 'vitest';
import { react } from './react.js';
import type { Effect } from './react.js';
import type { AcquisitionEvent } from './events.js';
import { foldEvents, initialState } from './state.js';
import {
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleFiles,
  sampleTarget,
  selectedHistory,
  validatingHistory,
  importingHistory,
} from './__fixtures__/acquisition-fixtures.js';

function effectTypes(effects: readonly Effect[]): string[] {
  return effects.map((effect) => effect.type);
}

describe('react — the event → effect table', () => {
  it('resolves metadata after a request', () => {
    const state = foldEvents(requestedHistory());
    const effects = react(
      { type: 'AcquisitionRequested', request: state.request!, policies: state.policies! },
      state,
    );
    expect(effects).toEqual([{ type: 'ResolveMetadata', request: state.request }]);
  });

  it('searches after a target resolves', () => {
    const state = foldEvents(resolvedHistory());
    const effects = react({ type: 'TargetResolved', target: sampleTarget }, state);
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 1 }]);
  });

  it('searches again on a re-search request, carrying the round', () => {
    const state = foldEvents([...resolvedHistory(), { type: 'SearchRequested', round: 3 }]);
    const effects = react({ type: 'SearchRequested', round: 3 }, state);
    expect(effects).toEqual([{ type: 'Search', target: sampleTarget, round: 3 }]);
  });

  it('downloads the selected candidate with the download policy', () => {
    const candidate = matchingCandidate('a');
    const state = foldEvents(selectedHistory([candidate]));
    const effects = react({ type: 'CandidateSelected', candidate }, state);
    expect(effectTypes(effects)).toEqual(['Download']);
    expect((effects[0] as Extract<Effect, { type: 'Download' }>).candidate).toEqual(candidate);
  });

  it('validates a completed download against the target', () => {
    const state = foldEvents(validatingHistory([matchingCandidate('a')]));
    const effects = react(
      { type: 'DownloadCompleted', candidate: matchingCandidate('a').identity, files: sampleFiles },
      state,
    );
    expect(effectTypes(effects)).toEqual(['Validate']);
  });

  it('imports validated files', () => {
    const state = foldEvents(importingHistory([matchingCandidate('a')]));
    const effects = react(
      {
        type: 'ValidationPassed',
        candidate: matchingCandidate('a').identity,
        verdict: { confidence: 1, reasons: [] },
      },
      state,
    );
    expect(effectTypes(effects)).toEqual(['Import']);
  });

  const inertEvents: AcquisitionEvent[] = [
    { type: 'MetadataResolutionFailed' },
    { type: 'SearchCompleted', round: 1, candidates: [] },
    { type: 'CandidatesRanked', ranked: [] },
    { type: 'DownloadFailed', candidate: matchingCandidate('a').identity, reason: 'Stalled' },
    {
      type: 'ValidationFailed',
      candidate: matchingCandidate('a').identity,
      verdict: { confidence: 0, reasons: [] },
    },
    { type: 'Imported', candidate: matchingCandidate('a').identity, location: '/x' },
    { type: 'AcquisitionFulfilled', location: '/x' },
    { type: 'AcquisitionExhausted' },
    { type: 'ImportConflicted', location: '/x' },
    { type: 'AcquisitionCancelled' },
  ];

  it.each(inertEvents)('emits no effect for $type', (event) => {
    expect(react(event, initialState)).toEqual([]);
  });

  it('cleans up staging when a candidate is rejected', () => {
    const identity = matchingCandidate('a').identity;
    expect(react({ type: 'CandidateRejected', candidate: identity }, initialState)).toEqual([
      { type: 'Cleanup', candidate: identity },
    ]);
  });
});
