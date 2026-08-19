import { describe, expect, it } from 'vitest';
import { SKINS } from '$lib/skins.js';
import baseCss from '$lib/styles/base.css?inline';
import tokensCss from '$lib/styles/tokens.css?inline';

/**
 * The convention that keeps the chrome inversion from being undone. Cascade layers order the
 * stylesheets, but layers alone cannot stop a future skin from re-chroming every bare `button` —
 * the skin layer is deliberately the last one, because overriding the base is what a skin is for.
 * So the guard is this scan: outside the reset, nobody styles a `button` that no class has
 * claimed.
 *
 * The browser parses the sheets, so the layer structure and the selector text asserted here are
 * the real ones rather than a regex's guess at them; the subject rule below is then applied to
 * those normalised selectors. What this does NOT reach: Svelte component `<style>` blocks (none
 * style buttons today) and any stylesheet not collected here — which is why the skins are globbed
 * rather than listed, so a new skin file is scanned the day it lands.
 */

/** Every skin stylesheet, found rather than enumerated. */
const SKIN_CSS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('./skins/*.css', { query: '?inline', import: 'default', eager: true }),
  ).map(([path, css]) => [path.replace(/^.*\/(.*)\.css$/, '$1'), css as string]),
);

const SHEETS: Record<string, string> = { tokens: tokensCss, base: baseCss, ...SKIN_CSS };
const EVERY_SHEET = Object.entries(SHEETS);

interface LayeredRule {
  /** The rule's own selector list, as the parser normalised it. */
  readonly selector: string;
  /** The layer names enclosing it, outermost first; empty when the rule sits outside every layer. */
  readonly layers: readonly string[];
}

function parse(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/**
 * Every style rule in a sheet, each tagged with the layers it sits inside. The variants are
 * discriminated by their actual CSSOM class rather than by which properties they happen to carry:
 * `@keyframes` also has a name and child rules, and a style rule may itself nest others.
 */
function styleRules(rules: CSSRuleList, layers: readonly string[] = []): LayeredRule[] {
  return [...rules].flatMap((rule) => {
    if (rule instanceof CSSLayerBlockRule) {
      return styleRules(rule.cssRules, [...layers, rule.name]);
    }
    if (rule instanceof CSSStyleRule) {
      // A style rule can nest, so it is emitted AND descended into.
      return [{ selector: rule.selectorText, layers }, ...styleRules(rule.cssRules, layers)];
    }
    if (rule instanceof CSSGroupingRule) {
      return styleRules(rule.cssRules, layers);
    }

    return [];
  });
}

/** A `button` subject wearing no class or id of its own — attributes and pseudos do not claim it. */
const BARE_BUTTON_SUBJECT = /^button(\[[^\]]*])*(::?[a-z-]+)*$/;

/**
 * Whether a selector can reach a button no class has claimed. Restrictive by default, which is
 * the only safe direction for a guard.
 *
 * The rule is a character test, not a structural one: after every functional pseudo-class's
 * argument and every attribute's value are emptied, a selector counts as narrowed only if a `.`
 * or `#` survives somewhere in what is left. Two consequences are deliberate rather than
 * accidental. `button:not(.btn)` is flagged — decision 1 rejected `:not()` opt-outs, so an
 * escape hatch written that way should fail this. And `:is(.card, .row) button` is flagged too:
 * classes inside a functional pseudo do not count as narrowing, because chrome applied across
 * two named surfaces is still chrome no button opted into. Both are in the table below, so
 * whoever meets one reads a decision rather than guessing at a bug.
 */
function isReachingUnclaimedButtons(selector: string): boolean {
  const flattened = emptyEveryGroup(selector);
  const subject = flattened.trim().split(/\s+/).at(-1);
  // Attribute VALUES are emptied before the probe: a dot or a hash inside one is somebody's URL
  // fragment or test id, not a class narrowing the rule.
  const narrowing = flattened.replaceAll(/\[[^\]]*]/g, '[]');

  return (
    subject !== undefined &&
    BARE_BUTTON_SUBJECT.test(subject.replaceAll('()', '')) &&
    !/[#.]/.test(narrowing)
  );
}

/** Replaces every `(...)` — however nested — with an empty pair, leaving the structure around it. */
function emptyEveryGroup(selector: string): string {
  let flattened = selector;
  let previous = '';
  while (flattened !== previous) {
    previous = flattened;
    flattened = flattened.replaceAll(/\([^()]*\)/g, '()');
  }

  return flattened;
}

/** The selector list's own commas — the ones inside `:is(...)` separate arguments, not selectors. */
function selectorsOf(selectorText: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of selectorText) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      selectors.push(current);
      current = '';
      continue;
    }
    current += character;
  }

  return [...selectors, current];
}

function unclaimedButtonRules(css: string): LayeredRule[] {
  return styleRules(parse(css).cssRules).filter((rule) =>
    selectorsOf(rule.selector).some((one) => isReachingUnclaimedButtons(one)),
  );
}

describe('the stylesheets’ layering', () => {
  it('scans a stylesheet for every shipped skin', () => {
    // The skins are globbed so a skin nobody remembered to add to a list is still scanned; this
    // assertion exists to catch the glob silently matching nothing.
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect(Object.keys(SKIN_CSS).toSorted(byName)).toEqual([...SKINS].toSorted(byName));
  });

  it.each(EVERY_SHEET)('names the layer order at the head of %s', (_name, css) => {
    const [first] = [...parse(css).cssRules];

    if (first === undefined || !(first instanceof CSSLayerStatementRule)) {
      throw new Error('this stylesheet does not open by naming the layer order');
    }
    // Every sheet restates it, so no import order can decide it. Theme last: a skin overriding
    // the base is the skin system's whole contract.
    expect([...first.nameList]).toEqual(['reset', 'base', 'theme']);
  });

  it.each(EVERY_SHEET)('leaves no rule in %s outside a layer', (_name, css) => {
    const unlayered = styleRules(parse(css).cssRules).filter((rule) => rule.layers.length === 0);

    // An unlayered rule outranks every layer, skins included — it would silently win.
    expect(unlayered.map((rule) => rule.selector)).toEqual([]);
  });

  it.each(Object.entries(SKIN_CSS))('keeps the %s skin inside the theme layer', (_name, css) => {
    const stray = styleRules(parse(css).cssRules).filter((rule) => rule.layers[0] !== 'theme');

    expect(stray.map((rule) => rule.selector)).toEqual([]);
  });

  it.each(EVERY_SHEET)('styles an unclaimed button in %s only from the reset', (_name, css) => {
    const outsideTheReset = unclaimedButtonRules(css).filter((rule) => rule.layers[0] !== 'reset');

    // Widget chrome is opt-in via `.btn`. A rule here is how the anatomy broke the first time.
    expect(outsideTheReset.map((rule) => rule.selector)).toEqual([]);
  });
});

describe('what counts as reaching an unclaimed button', () => {
  // A guard is worth exactly what its subject rule is worth, so the rule is specified directly.
  // Every row below is a way someone could re-chrome the app's buttons without meaning to.
  it.each([
    'button',
    'button:hover',
    ':root button',
    ':root[data-skin="forum"] button',
    'html body button',
    '* button',
    'main button',
    ':is(html, body) button',
    ':where(:root) button',
    'button[type="submit"]',
    'button:not(.btn)',
    '[href="#top"] button',
    // Strict on purpose: a rule chroming buttons across two named surfaces is still chrome that
    // no button opted into. Recorded here so it reads as the decision it is, not as a hole.
    ':is(.card, .row) button',
  ])('flags %s', (selector) => {
    expect(isReachingUnclaimedButtons(selector)).toBe(true);
  });

  it.each([
    '.btn',
    '.btn:hover',
    '.segmented button',
    '.entity-filter button[aria-pressed="true"]',
    ':root[data-skin="forum"] .segmented button',
    '.result-open',
    'a',
    'input',
  ])('leaves %s alone', (selector) => {
    expect(isReachingUnclaimedButtons(selector)).toBe(false);
  });
});
