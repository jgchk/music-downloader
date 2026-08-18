import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The acquisitions master-detail collapse, pinned across the seam it is implemented over
 * (web-ui: "Small screens present one acquisitions pane at a time").
 *
 * The whole behaviour is a bare string agreement between two files: the layout emits the class
 * names, the stylesheet gives them meaning. Nothing type-checks that join and no rendering test
 * can see it — SSR renders markup without applying CSS, and jsdom evaluates no media query. So a
 * rename on either side leaves every unit, SSR and e2e test green while the collapse silently
 * stops happening: on a phone the queue comes back on top of the request form, which is the exact
 * regression this change exists to fix. That is a gate going quiet, which is what this tier holds.
 *
 * What is deliberately NOT claimed here: that `display: none` wins the cascade at 959px under
 * every skin. That needs a real browser at a real viewport and belongs to the deferred
 * a11y/layout parity suite (see packages/web/tests/parity.spec.ts, which defers exactly that and
 * asks for no new heavy specs in the meantime). This pins the join, not the rendering.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string): string =>
  readFileSync(`${REPO_ROOT}/${relative}`, 'utf8').replaceAll(/\s+/gu, ' ');

const LAYOUT = read('packages/web/src/routes/acquisitions/+layout.svelte');
const BASE_CSS = read('packages/web/src/lib/styles/base.css');

describe('the acquisitions collapse is joined up across markup and stylesheet', () => {
  it('the layout emits the two hooks the stylesheet keys the collapse on', () => {
    expect(LAYOUT).toContain('class:detail-active={data.detailActive}');
    expect(LAYOUT).toContain('class="back-to-queue"');
  });

  it('the stylesheet hides the queue on a detail-active shell, out of the a11y tree', () => {
    // `display: none` specifically: a visual-only hiding would leave the queue in the tab order,
    // and the spec requires focus never to enter the hidden pane.
    expect(BASE_CSS).toContain('.master-detail.detail-active .master { display: none; }');
  });

  it('the collapse and the back link are scoped to narrow viewports', () => {
    // Both rules live under the same max-width query — the desktop two-pane presentation is
    // untouched, and the back link does not appear beside a queue that is already on screen.
    const narrow = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 960px)'));
    expect(narrow).toContain('.master-detail.detail-active .master');
    expect(narrow).toContain('.master-detail.detail-active .back-to-queue');
    expect(BASE_CSS).toContain('.master-detail .back-to-queue { display: none; }');
  });
});
