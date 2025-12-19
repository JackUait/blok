/**
 * Maximum bundle variant - All tools + all 68 locales
 *
 * This entry point bundles everything: the Blok class, all bundled tools,
 * and all 68 locale dictionaries (statically imported, not code-split).
 *
 * Use this to measure the maximum bundle size when everything is included.
 *
 * This file is NOT part of the public API - it's only used for bundle size measurement.
 */

// Re-export everything from the main blok entry
export * from '../blok';

// Import all locales to force them into the bundle
// The allLocales export ensures these aren't tree-shaken
import { allLocales, localeCount } from './all-locales';

// Export to prevent tree-shaking
export { allLocales, localeCount };
