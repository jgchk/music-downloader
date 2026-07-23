/**
 * The interchangeable presentation skins. This array is the single source of truth for the skin
 * allow-list within TypeScript. The no-flash script in `app.html` re-encodes these literals by
 * hand (it runs before the bundle, so it can't import this module); `skins.test.ts` guards the
 * two against drift.
 */
export const SKINS = ['forum', 'glass', 'terminal'] as const;

export type Skin = (typeof SKINS)[number];

/** The default skin, server-rendered on `<html>` and used when no valid preference is resolved. */
export const DEFAULT_SKIN: Skin = SKINS[0];

export const isSkin = (value: string | undefined): value is Skin =>
  (SKINS as readonly string[]).includes(value ?? '');
