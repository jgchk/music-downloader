import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import CoverArt from './CoverArt.svelte';

/** The archive answering badly for one cover, triggered on the image itself rather than awaited. */
async function theCoverFails(): Promise<void> {
  const image = document.querySelector('.art img');
  if (image === null) {
    throw new Error('no cover was being rendered to fail');
  }

  image.dispatchEvent(new Event('error'));
  await tick();
}

describe('CoverArt', () => {
  it('keeps the placeholder underneath in every state, so the slot is never empty', async () => {
    // Asserted once, here, because it is one standing invariant rather than a fact about any of
    // the states below — the cover is drawn OVER the initials, never instead of them.
    const slot = await render(CoverArt, {
      src: '/cover-art/release-group/x?size=250',
      initials: 'PS',
    });
    await expect.element(page.getByText('PS')).toBeVisible();

    await theCoverFails();
    await expect.element(page.getByText('PS')).toBeVisible();

    await slot.rerender({ initials: 'PS' });
    await expect.element(page.getByText('PS')).toBeVisible();
  });

  it('asks for the cover when there is one to ask for', async () => {
    await render(CoverArt, { src: '/cover-art/release-group/x?size=250', initials: 'PS' });

    expect(document.querySelector('.art img')?.getAttribute('src')).toBe(
      '/cover-art/release-group/x?size=250',
    );
  });

  it('does not defer the one cover that is on screen the moment it exists', async () => {
    await render(CoverArt, {
      src: '/cover-art/release-group/x?size=500',
      initials: 'PS',
      shape: 'detail',
    });

    // The panel's cover is in view as soon as the panel is; deferring it just delays the picture.
    expect(document.querySelector('.art img')?.getAttribute('loading')).toBe('eager');
  });

  it('asks for nothing when there is no cover to ask for', async () => {
    await render(CoverArt, { initials: 'DB', shape: 'artist' });

    expect(document.querySelector('.art img')).toBeNull();
  });

  it('stops drawing a cover that fails', async () => {
    await render(CoverArt, { src: '/cover-art/release-group/x?size=250', initials: 'PS' });

    await theCoverFails();

    // Left in place, an errored image paints the browser's broken-image mark over the initials.
    expect(document.querySelector('.art img')).toBeNull();
  });

  it('gives the next subject its own chance, even in a slot where one already failed', async () => {
    const slot = await render(CoverArt, {
      src: '/cover-art/release-group/first?size=250',
      initials: 'PS',
    });

    await theCoverFails();
    await slot.rerender({ src: '/cover-art/release-group/second?size=250', initials: 'DB' });

    // The failure was about the first cover. A slot that remembered only "something failed here"
    // would hide the second one for good.
    const image = document.querySelector('.art img');
    expect(image?.getAttribute('src')).toBe('/cover-art/release-group/second?size=250');
  });
});
