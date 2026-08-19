import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it } from 'vitest';
import CoverArt from './CoverArt.svelte';

/** The archive answering badly for one cover, triggered on the image itself rather than awaited. */
function theCoverFails(): void {
  const image = document.querySelector('.art img');
  if (image === null) {
    throw new Error('no cover was being rendered to fail');
  }

  image.dispatchEvent(new Event('error'));
}

describe('CoverArt', () => {
  it('names its subject while the cover is still coming', async () => {
    await render(CoverArt, { src: '/cover-art/release-group/x?size=250', initials: 'PS' });

    await expect.element(page.getByText('PS')).toBeVisible();
    expect(document.querySelector('.art img')).not.toBeNull();
  });

  it('asks for nothing when there is no cover to ask for', async () => {
    await render(CoverArt, { initials: 'DB', shape: 'artist' });

    expect(document.querySelector('.art img')).toBeNull();
    await expect.element(page.getByText('DB')).toBeVisible();
  });

  it('replaces a cover that fails with the placeholder it was drawn over', async () => {
    await render(CoverArt, { src: '/cover-art/release-group/x?size=250', initials: 'PS' });

    theCoverFails();

    // Left in place, an errored image paints the browser's broken-image mark over the initials.
    await expect.element(page.getByText('PS')).toBeVisible();
    expect(document.querySelector('.art img')).toBeNull();
  });

  it('gives the next subject its own chance, even in a slot where one already failed', async () => {
    const slot = await render(CoverArt, {
      src: '/cover-art/release-group/first?size=250',
      initials: 'PS',
    });

    theCoverFails();
    await slot.rerender({ src: '/cover-art/release-group/second?size=250', initials: 'DB' });

    // The failure was about the first cover. A slot that remembered only "something failed here"
    // would hide the second one for good.
    const image = document.querySelector('.art img');
    expect(image?.getAttribute('src')).toBe('/cover-art/release-group/second?size=250');
  });
});
