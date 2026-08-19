import { describe, expect, it } from 'vitest';
import { buildUpcasterRegistry, registeredUpcasterTypes } from './upcaster.js';
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
  it('is total in both directions', () => {
    const entries = Object.entries(STORED_TOKEN_BY_TYPE);

    expect(Object.keys(MODEL_TYPE_BY_TOKEN)).toHaveLength(entries.length);
    for (const [type, token] of entries) {
      expect(MODEL_TYPE_BY_TOKEN[token]).toBe(type);
    }
  });

  it('is injective — no two model types share a stored token', () => {
    const tokens = Object.values(STORED_TOKEN_BY_TYPE);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('never lets a model name be read as a different event stored token', () => {
    for (const [type, token] of Object.entries(STORED_TOKEN_BY_TYPE)) {
      const collision = MODEL_TYPE_BY_TOKEN[type];
      // A model name may appear as a stored token only when it is that same event's own token
      // (the unchanged-name case). Anything else means a read could resolve to the wrong event.
      if (collision !== undefined) expect(token).toBe(type);
    }
  });

  it('round-trips every stored token through the model and back', () => {
    for (const token of Object.keys(MODEL_TYPE_BY_TOKEN)) {
      expect(toStoredToken(toModelType(token))).toBe(token);
    }
  });

  it('passes an unknown token through unchanged, so a future writer stays readable', () => {
    expect(toModelType('SomethingNobodyKnows')).toBe('SomethingNobodyKnows');
  });
  it('keys every production upcaster by a stored token, never a model name', () => {
    // Upcasters run on the raw on-disk shape, so their registration keys live in storage
    // vocabulary. Registering one under a renamed model name would silently never fire.
    for (const type of registeredUpcasterTypes(buildUpcasterRegistry())) {
      expect(Object.keys(MODEL_TYPE_BY_TOKEN)).toContain(type);
    }
  });
});
