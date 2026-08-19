import { describe, expect, it } from 'vitest';
import type { ImportEventType } from '../../domain/import/events.js';
import { buildUpcasterRegistry } from './upcaster.js';
import {
  MODEL_TYPE_BY_TOKEN,
  STORED_TOKEN_BY_TYPE,
  toModelType,
  toStoredToken,
} from './event-tokens.js';

/**
 * The storage-token seam (adopt-download-language, design D1). Stored `type` strings are frozen
 * serialization constants; the model's event names are ubiquitous language and may be renamed.
 * These tests are the tripwire that a rename never reaches the on-disk log: the map must stay a
 * total bijection, and no model name may be confusable with another event's stored token — the
 * hazard is that the importer's `CandidatesProposed` stays on disk while its model name becomes
 * `MatchesProposed`.
 */

describe('stored-token <-> model-type map', () => {
  // The golden pin. These strings are what is physically written in every production database,
  // including rows written years ago. Changing one is not a refactor — it silently orphans all
  // existing history of that type. If you are here because this test failed, the correct move is
  // almost never to update the expectation.
  it('stores exactly these tokens — changing one orphans existing history', () => {
    expect(STORED_TOKEN_BY_TYPE).toEqual({
      ImportRequested: 'ImportRequested',
      MatchesProposed: 'CandidatesProposed',
      AutoApplySelected: 'AutoApplySelected',
      ReviewRequired: 'ReviewRequired',
      ReviewResolved: 'ReviewResolved',
      ImportApplied: 'ImportApplied',
      RemediationRequired: 'RemediationRequired',
      ImportRejected: 'ImportRejected',
      ReleaseVerdictRecorded: 'ReleaseVerdictRecorded',
    });
  });

  it('is injective — no two model types share a stored token', () => {
    const tokens = Object.values(STORED_TOKEN_BY_TYPE);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('never resolves a model name to a different event', () => {
    // The hazard this seam creates: some model names ARE stored tokens of other events. Reading
    // one back must never land on the wrong event.
    for (const type of Object.keys(STORED_TOKEN_BY_TYPE)) {
      expect(toModelType(type)).toBe(type);
    }
  });

  it('does not resolve an inherited Object property as an event type', () => {
    // The lookup is keyed by row data; on a normal object literal `toString` would resolve to a
    // function where an event type is declared, and `??` would never fire.
    expect(toModelType('toString')).toBe('toString');
    expect(toModelType('constructor')).toBe('constructor');
  });

  it('passes an unknown token through unchanged, so a future writer stays readable', () => {
    expect(toModelType('SomethingNobodyKnows')).toBe('SomethingNobodyKnows');
  });
  it('keys every production upcaster by a stored token, never a model name', () => {
    // Upcasters run on the raw on-disk shape, so their registration keys live in storage
    // vocabulary. Registering one under a renamed model name would silently never fire.
    for (const type of buildUpcasterRegistry().registeredTypes()) {
      expect(Object.keys(MODEL_TYPE_BY_TOKEN)).toContain(type);
    }
  });

  it('refuses to write a type it has no token for, naming it', () => {
    // Reachable only by round-tripping an unknown token back into an append; binding `undefined`
    // into SQLite would write a blob with no `type` at all.
    expect(() => toStoredToken('NotAnEvent' as ImportEventType)).toThrow(/NotAnEvent/);
  });
});
