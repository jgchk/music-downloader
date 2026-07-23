import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SkinSwitcher from './SkinSwitcher.svelte';

describe('SkinSwitcher', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.skin;
    localStorage.clear();
  });
  // The storage-unavailable test stubs a browser built-in (Storage.prototype); restore in an
  // afterEach so a failed assertion can never leak the throwing stub into later tests.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mirrors the resolved skin on <html> as the pressed choice', async () => {
    document.documentElement.dataset.skin = 'glass';
    await render(SkinSwitcher, {});
    await expect
      .element(page.getByRole('button', { name: 'glass' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to forum when the document carries no valid skin', async () => {
    document.documentElement.dataset.skin = 'nonsense';
    await render(SkinSwitcher, {});
    await expect
      .element(page.getByRole('button', { name: 'forum' }))
      .toHaveAttribute('aria-pressed', 'true');
    // Pin the fallback independently: no other skin is left pressed.
    await expect
      .element(page.getByRole('button', { name: 'glass' }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect
      .element(page.getByRole('button', { name: 'terminal' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a chosen skin to <html> and persists it', async () => {
    await render(SkinSwitcher, {});
    await page.getByRole('button', { name: 'terminal' }).click();
    expect(document.documentElement.dataset.skin).toBe('terminal');
    expect(localStorage.getItem('skin')).toBe('terminal');
    await expect
      .element(page.getByRole('button', { name: 'terminal' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('still switches when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    await render(SkinSwitcher, {});
    await page.getByRole('button', { name: 'glass' }).click();
    expect(document.documentElement.dataset.skin).toBe('glass');
  });
});
