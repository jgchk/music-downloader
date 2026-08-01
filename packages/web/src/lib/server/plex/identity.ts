/**
 * How this app identifies itself to Plex — shared vocabulary for the adapter (request headers),
 * the hosted-auth URL builder, and the contract tier's recorder/drift scripts. Its own module so
 * pure code (auth-url) never has to import the HTTP adapter for two strings.
 */

/** Stable across installs and sessions so users see ONE "music-downloader" device entry. */
export const PLEX_CLIENT_IDENTIFIER = 'music-downloader-web';
export const PLEX_PRODUCT = 'music-downloader';
