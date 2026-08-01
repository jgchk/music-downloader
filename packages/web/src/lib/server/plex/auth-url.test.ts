import { describe, expect, it } from 'vitest';
import { plexAuthUrl } from './auth-url.js';

describe('plexAuthUrl', () => {
  it('builds the hosted auth page URL with the parameters in the FRAGMENT query', () => {
    const url = plexAuthUrl('the-code', 'https://music.example/login/callback?pin=9');
    expect(url.startsWith('https://app.plex.tv/auth#?')).toBe(true);
    const parameters = new URLSearchParams(url.split('#?', 2)[1]);
    expect(parameters.get('clientID')).toBe('music-downloader-web');
    expect(parameters.get('code')).toBe('the-code');
    // The forward URL (with its own query) must survive encoding intact.
    expect(parameters.get('forwardUrl')).toBe('https://music.example/login/callback?pin=9');
    expect(parameters.get('context[device][product]')).toBe('music-downloader');
  });
});
