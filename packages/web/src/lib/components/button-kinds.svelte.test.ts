import { describe, expect, it } from 'vitest';

/**
 * The other half of the chrome inversion's guard. `styles/layers.svelte.test.ts` proves no
 * stylesheet chromes a button that no class claimed; this proves the markup never leaves a button
 * unclaimed. Between them, "is this a widget?" is answered in exactly one place per button.
 *
 * The inversion made forgetting `.btn` a silent regression — before it, the element carried the
 * chrome and a missing class changed nothing; now a real push button rendered without it ships as
 * unstyled text. So every `<button>` in the app declares which kind it is, and the kinds are
 * listed here rather than inferred.
 */

/** The class that says "this is a push button" — the chrome opts in through it. */
const WIDGET = 'btn';

/**
 * The kinds that are deliberately NOT push buttons. Each is a real presentation with a rule of
 * its own: a whole result card, an edition row, an inline link-styled action, the tracklist
 * disclosure, and one segment of the segmented control.
 */
const PLAIN_KINDS = new Set([
  'result-open',
  'edition',
  'linkish',
  'tracklist-open',
  'segment',
  // The best-match summary: a surface stating what the system would take, which is selectable to
  // hand the choice back to it. A raised push button would read as a fifth request action.
  'best-match',
]);

const SOURCES = import.meta.glob<string>('/src/**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * The opening tags of every `<button>` in a source. Scanned rather than matched with one regex
 * because an attribute value can hold a `>` of its own (`onclick={() => a > b}`), which ends the
 * tag early for anything that just looks for the next angle bracket.
 */
function endOfTag(source: string, start: number): number {
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return cursor;
  }

  return source.length - 1;
}

function buttonTags(source: string): string[] {
  const tags: string[] = [];
  for (
    let index = source.indexOf('<button');
    index !== -1;
    index = source.indexOf('<button', index + 1)
  ) {
    tags.push(source.slice(index, endOfTag(source, index) + 1));
  }

  return tags;
}

/** The literal classes on a tag — a class built by an expression is not a declaration we can read. */
function classesOn(tag: string): string[] {
  const written = /class="(?<names>[^"]*)"/.exec(tag)?.groups?.names;

  return written === undefined ? [] : written.split(/\s+/).filter(Boolean);
}

describe('every button says which kind it is', () => {
  it('finds the components to scan', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
  });

  it('leaves no button unclaimed by either the widget class or a named plain kind', () => {
    const unclaimed = Object.entries(SOURCES).flatMap(([path, source]) =>
      buttonTags(source)
        .filter((tag) => {
          const classes = classesOn(tag);

          return !classes.includes(WIDGET) && classes.every((one) => !PLAIN_KINDS.has(one));
        })
        .map((tag) => `${path}: ${tag.replaceAll(/\s+/g, ' ').slice(0, 80)}`),
    );

    // A push button that lost its `.btn` renders as bare text — which, since the inversion, no
    // other test would notice. A new plain kind belongs in PLAIN_KINDS with a rule to match.
    expect(unclaimed).toEqual([]);
  });
});
