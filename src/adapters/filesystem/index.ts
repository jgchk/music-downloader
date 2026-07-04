// Filesystem adapters (D13): the library import/staging port and its pure path-rendering policy.
export { FilesystemLibrary, nodeLibraryFileSystem } from './library.js';
export type { LibraryConfig, LibraryFileSystem } from './library.js';
export { candidateStagingDir, renderReleaseDir, sanitizeSegment } from './paths.js';
