// Adapters layer — concrete port implementations (slskd, musicbrainz, ffmpeg, sqlite, filesystem).
// Depends on application ports + domain; never on interfaces or composition.
export * from './support/index.js';
export * from './slskd/index.js';
export * from './sqlite/index.js';
export * from './filesystem/index.js';
export * from './ffmpeg/index.js';
export * from './musicbrainz/index.js';
