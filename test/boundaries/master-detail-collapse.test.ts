import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The acquisitions master-detail collapse, pinned across the seam it is implemented over
 * (web-ui: "Small screens present one acquisitions pane at a time").
 *
 * The whole behaviour is a bare string agreement: the layout emits class names, the stylesheet
 * gives them meaning. Nothing type-checks that join, and no test in the suite today looks at it —
 * SSR renders markup without applying CSS, jsdom evaluates no media query, and the browser tier
 * that COULD see it defers per-skin layout invariants by policy (packages/web/tests/parity.spec.ts).
 * So a rename on either side would leave every unit, SSR and e2e test green while the collapse
 * silently stopped: on a phone the queue would come back on top of the request form, the exact
 * regression this change exists to fix. That is a gate going quiet, which is what this tier holds.
 *
 * What is deliberately NOT claimed here: that `display: none` wins the cascade at 959px under
 * every skin, and that focus cannot enter the hidden pane. Both need a real browser at a real
 * viewport and belong to the deferred a11y/layout parity suite.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string): string =>
  readFileSync(`${REPO_ROOT}/${relative}`, 'utf8').replaceAll(/\s+/gu, ' ');

const LAYOUT = read('packages/web/src/routes/acquisitions/+layout.svelte');
const BASE_CSS = read('packages/web/src/lib/styles/base.css');

/** The `@media (max-width: 960px)` block alone — brace-matched, so "inside it" means inside it. */
function narrowViewportBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 960px) {');
  expect(start, 'the collapse breakpoint block should exist').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error('unterminated @media block in base.css');
}

describe('the acquisitions collapse is joined up across markup and stylesheet', () => {
  it('the layout emits every class the collapse rule keys on', () => {
    // `.master-detail.detail-active .master` names three; `.detail` and the back link complete the
    // set the stylesheet targets. Each is an untyped string on the markup side, so each is pinned.
    expect(LAYOUT).toContain('class="master-detail"');
    expect(LAYOUT).toContain('class:detail-active=');
    expect(LAYOUT).toContain('class="master panel"');
    expect(LAYOUT).toContain('class="detail"');
    expect(LAYOUT).toContain('class="back-to-queue"');
  });

  it('the stylesheet hides the queue on a detail-active shell, out of the a11y tree', () => {
    // `display: none` specifically: a visual-only hiding would leave the queue in the tab order,
    // and the spec requires that focus never enter the hidden pane.
    // Matched on the declaration, not the whole rule body: adding another declaration to the rule
    // is a refactor, not a regression, and should not fail this pin.
    expect(narrowViewportBlock(BASE_CSS)).toMatch(
      /\.master-detail\.detail-active \.master \{[^}]*display: none;/u,
    );
  });

  it('the collapse and the back link apply only below the breakpoint', () => {
    // Inside the block: the desktop two-pane presentation is untouched by both rules…
    const narrow = narrowViewportBlock(BASE_CSS);
    expect(narrow).toContain('.master-detail.detail-active .master');
    expect(narrow).toContain('.master-detail.detail-active .back-to-queue');
    // …and the back link is hidden by default, so it never appears beside a visible queue.
    expect(BASE_CSS).toContain('.master-detail .back-to-queue { display: none; }');
  });
});
