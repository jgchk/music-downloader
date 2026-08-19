import { describe, expect, it } from 'vitest';
import baseCss from '$lib/styles/base.css?inline';
import tokensCss from '$lib/styles/tokens.css?inline';
import forumCss from '$lib/styles/skins/forum.css?inline';
import glassCss from '$lib/styles/skins/glass.css?inline';
import terminalCss from '$lib/styles/skins/terminal.css?inline';

/**
 * The convention that keeps the chrome inversion from being undone. Cascade layers order the
 * stylesheets, but layers alone cannot stop a future skin from re-chroming every bare `button` —
 * the skin layer is deliberately the last one, because overriding the base is what a skin is for.
 * So the guard is this scan: outside the reset, nobody styles a globally-scoped bare `button`.
 *
 * The stylesheets are parsed by the browser that ships them rather than by a regex over their
 * text, so what is asserted is what the cascade actually sees.
 */

const SKINS = { forum: forumCss, glass: glassCss, terminal: terminalCss } as const;

interface LayeredRule {
  /** The rule's own selector list, as the parser normalised it. */
  readonly selector: string;
  /** The layer names enclosing it, outermost first; empty when the rule sits outside every layer. */
  readonly layers: readonly string[];
}

/** A `@layer name { … }` block: a grouping rule that also carries the layer's name. */
const isLayerBlock = (rule: CSSRule): rule is CSSGroupingRule & { readonly name: string } =>
  'cssRules' in rule && 'name' in rule;

/** A `@layer a, b, c;` statement, which names an order without styling anything. */
const isLayerStatement = (
  rule: CSSRule,
): rule is CSSRule & { readonly nameList: readonly string[] } => 'nameList' in rule;

const isStyleRule = (rule: CSSRule): rule is CSSStyleRule => 'selectorText' in rule;

function parse(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/** Every style rule in a sheet, each tagged with the layers it sits inside. */
function styleRules(rules: CSSRuleList, layers: readonly string[] = []): LayeredRule[] {
  return [...rules].flatMap((rule) => {
    if (isLayerBlock(rule)) {
      return styleRules(rule.cssRules, [...layers, rule.name]);
    }
    if (isStyleRule(rule)) {
      return [{ selector: rule.selectorText, layers }];
    }
    if ('cssRules' in rule) {
      return styleRules((rule as CSSGroupingRule).cssRules, layers);
    }

    return [];
  });
}

/** The scopes a rule can hang off and still reach every button in the document. */
const GLOBAL_SCOPE = /^(:root(\[[^\]]*])?|html(\[[^\]]*])?|body|>|\+|~)$/;
/** A `button` subject wearing no class, id, or attribute of its own — the thing that leaked. */
const BARE_BUTTON = /^button(::?[a-z-]+(\([^)]*\))?)*$/;

function isReachingEveryButton(selector: string): boolean {
  const parts = selector.trim().split(/\s+/);
  const subject = parts.at(-1);
  if (subject === undefined || !BARE_BUTTON.test(subject)) {
    return false;
  }

  return parts.slice(0, -1).every((part) => GLOBAL_SCOPE.test(part));
}

function globalButtonRules(css: string): LayeredRule[] {
  return styleRules(parse(css).cssRules).filter((rule) =>
    rule.selector.split(',').some((one) => isReachingEveryButton(one)),
  );
}

describe('the stylesheets’ layering', () => {
  it('names the layer order before anything uses one', () => {
    const [first] = [...parse(tokensCss).cssRules];

    if (first === undefined || !isLayerStatement(first)) {
      throw new Error('the first stylesheet loaded does not open by naming the layer order');
    }
    // Theme last: a skin overriding the base is the skin system's whole contract.
    expect([...first.nameList]).toEqual(['reset', 'base', 'theme']);
  });

  it.each([
    ['tokens', tokensCss],
    ['base', baseCss],
  ])('leaves no %s rule outside a layer', (_name, css) => {
    const unlayered = styleRules(parse(css).cssRules).filter((rule) => rule.layers.length === 0);

    // An unlayered rule outranks every layer, skins included — it would silently win.
    expect(unlayered.map((rule) => rule.selector)).toEqual([]);
  });

  it.each(Object.entries(SKINS))('keeps the %s skin inside the theme layer', (_name, css) => {
    const stray = styleRules(parse(css).cssRules).filter((rule) => rule.layers[0] !== 'theme');

    expect(stray.map((rule) => rule.selector)).toEqual([]);
  });

  it.each([['base', baseCss], ['tokens', tokensCss], ...Object.entries(SKINS)])(
    'styles a globally-scoped bare button in %s only from the reset',
    (_name, css) => {
      const outsideTheReset = globalButtonRules(css).filter((rule) => rule.layers[0] !== 'reset');

      // Widget chrome is opt-in via `.btn`. A rule here is how the anatomy broke the first time.
      expect(outsideTheReset.map((rule) => rule.selector)).toEqual([]);
    },
  );
});
