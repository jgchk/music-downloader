import { describe, expect, it } from 'vitest';
import { containmentScore, normalizeText, tokenize } from './text.js';

describe('normalizeText', () => {
  it('lowercases, strips diacritics, and collapses punctuation to single spaces', () => {
    expect(normalizeText('Björk — Homogénic (1997)!')).toBe('bjork homogenic 1997');
  });
});

describe('tokenize', () => {
  it('splits normalized text into tokens', () => {
    expect(tokenize('Aphex Twin')).toEqual(['aphex', 'twin']);
  });

  it('returns an empty array for text with no alphanumerics', () => {
    expect(tokenize('!!! ---')).toEqual([]);
  });
});

describe('containmentScore', () => {
  it('measures how many query tokens are present', () => {
    expect(containmentScore(['aphex', 'twin'], ['aphex', 'twin', 'drukqs'])).toBe(1);
    expect(containmentScore(['aphex', 'twin'], ['aphex', 'only'])).toBe(0.5);
  });

  it('treats an empty query as fully contained', () => {
    expect(containmentScore([], ['anything'])).toBe(1);
  });
});
