/**
 * The shipped application version (design D5): the workspace root package.json `version`, inlined
 * at build/boot by a Vite `define` (see `__APP_VERSION__` in the vite/vitest configs). It is the
 * artifact's own version — sourced from the shipped package, never from the environment.
 */
export const version: string = __APP_VERSION__;
