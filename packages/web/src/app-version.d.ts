/**
 * The shipped product version, inlined at build/boot by a Vite `define` (design D5): the root
 * workspace package.json `version`, read at config-eval time. Declared here as an ambient global
 * so both the adapter-node build and the three vitest projects resolve it; it is not an
 * environment variable and carries no configuration.
 */
declare const __APP_VERSION__: string;
