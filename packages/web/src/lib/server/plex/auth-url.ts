import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from './identity.js';

/**
 * The hosted Plex auth page URL for a created PIN (design D3, full-page redirect): the tab
 * navigates here, the user approves, and Plex bounces them to `forwardUrl` (our callback). Plex's
 * pairing page reads its parameters from the FRAGMENT query (`#?`), not the search string. Pure —
 * the e2e login journey asserts this exact contract before simulating the bounce.
 */
export function plexAuthUrl(code: string, forwardUrl: string): string {
  const parameters = new URLSearchParams({
    clientID: PLEX_CLIENT_IDENTIFIER,
    code,
    forwardUrl,
    'context[device][product]': PLEX_PRODUCT,
  });
  return `https://app.plex.tv/auth#?${parameters.toString()}`;
}
