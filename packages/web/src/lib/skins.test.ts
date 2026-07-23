import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKINS, DEFAULT_SKIN, isSkin } from './skins.js';

describe('skins', () => {
  it('recognises every shipped skin and rejects anything else', () => {
    for (const skin of SKINS) expect(isSkin(skin)).toBe(true);
    expect(isSkin('nonsense')).toBe(false);
    expect(isSkin(undefined)).toBe(false);
  });

  it('defaults to the first shipped skin', () => {
    expect(DEFAULT_SKIN).toBe(SKINS[0]);
  });

  it("app.html's no-flash allow-list stays in step with the skin set", () => {
    // app.html re-encodes the skin literals by hand (it can't import this module — it runs before
    // the bundle). Guard against drift: the server-rendered default and every shipped skin must
    // appear in the pre-paint script, or a renamed/added skin would be silently rejected.
    const appHtml = readFileSync(fileURLToPath(new URL('../app.html', import.meta.url)), 'utf8');
    expect(appHtml).toContain(`data-skin="${DEFAULT_SKIN}"`);
    const script = appHtml.slice(appHtml.indexOf("localStorage.getItem('skin')"));
    for (const skin of SKINS) expect(script).toContain(`'${skin}'`);
  });
});
