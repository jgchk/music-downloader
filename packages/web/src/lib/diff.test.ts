import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff.js';

/**
 * The word-level diff behind the tag comparison's change highlighting (reviews-register-alignment D7). The contract:
 * shared runs render plain, each side's divergent words carry the highlight, and no character is
 * ever lost — joining a side's segments reproduces its input exactly.
 */

function joined(segments: readonly { text: string }[]): string {
  return segments.map((segment) => segment.text).join('');
}

describe('wordDiff', () => {
  it('marks identical strings as one unchanged run on both sides', () => {
    const result = wordDiff('The Last One Standing', 'The Last One Standing');
    expect(result.from).toEqual([{ text: 'The Last One Standing', changed: false }]);
    expect(result.to).toEqual([{ text: 'The Last One Standing', changed: false }]);
  });

  it('highlights only the inserted word — the mark hugs the word, not its whitespace', () => {
    const result = wordDiff('Last One Standing', 'The Last One Standing');
    expect(result.from).toEqual([{ text: 'Last One Standing', changed: false }]);
    expect(result.to).toEqual([
      { text: 'The', changed: true },
      { text: ' Last One Standing', changed: false },
    ]);
  });

  it('hugs an appended word: the joining space stays unmarked ahead of the mark', () => {
    const result = wordDiff('Intro', 'Intro Live');
    expect(result.to).toEqual([
      { text: 'Intro ', changed: false },
      { text: 'Live', changed: true },
    ]);
  });

  it('keeps a whitespace-only divergence marked (there is no word to hug)', () => {
    const result = wordDiff('A B', 'A  B');
    expect(joined(result.to)).toBe('A  B');
    expect(result.to.some((segment) => segment.changed)).toBe(true);
  });

  it('handles two empty inputs', () => {
    expect(wordDiff('', '')).toEqual({ from: [], to: [] });
  });

  it('highlights a replaced word on both sides and keeps the shared remainder plain', () => {
    const result = wordDiff('Intro (Live)', 'Intro (Remastered)');
    expect(result.from).toEqual([
      { text: 'Intro ', changed: false },
      { text: '(Live)', changed: true },
    ]);
    expect(result.to).toEqual([
      { text: 'Intro ', changed: false },
      { text: '(Remastered)', changed: true },
    ]);
  });

  it('never loses a character: each side joins back to its input', () => {
    const from = 'Sigur Rós — Ágætis byrjun  (1999)';
    const to = 'Sigur Ros — Agaetis Byrjun (1999)';
    const result = wordDiff(from, to);
    expect(joined(result.from)).toBe(from);
    expect(joined(result.to)).toBe(to);
  });

  it('treats a wholly different pair as fully changed', () => {
    const result = wordDiff('AAA', 'BBB');
    expect(result.from).toEqual([{ text: 'AAA', changed: true }]);
    expect(result.to).toEqual([{ text: 'BBB', changed: true }]);
  });

  it('handles an empty side without inventing segments', () => {
    expect(wordDiff('', 'New Title')).toEqual({
      from: [],
      to: [{ text: 'New Title', changed: true }],
    });
    expect(wordDiff('Old Title', '')).toEqual({
      from: [{ text: 'Old Title', changed: true }],
      to: [],
    });
  });
});
