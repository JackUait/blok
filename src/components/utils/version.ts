/**
 * Version utilities for Blok editor
 */

/**
 * Allow to use global VERSION, that will be overwritten by Webpack
 */
declare const VERSION: string;

const fallbackBlokVersion = 'dev';

/**
 * Returns Blok version injected by bundler or a globally provided fallback.
 */
export const getBlokVersion = (): string => {
  if (typeof VERSION !== 'undefined') {
    return VERSION;
  }

  const globalVersion = (typeof globalThis === 'object' && globalThis !== null)
    ? (globalThis as { VERSION?: unknown }).VERSION
    : undefined;

  if (typeof globalVersion === 'string' && globalVersion.trim() !== '') {
    return globalVersion;
  }

  return fallbackBlokVersion;
};
