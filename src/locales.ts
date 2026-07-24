/**
 * Public entry point for locale imports.
 *
 * Lazy Loading:
 * Only English is bundled by default. All 69 supported locale variants are available
 * for on-demand loading, reducing initial bundle size while providing full
 * language support.
 *
 * @example
 * // Load a single locale on-demand
 * import { loadLocale } from '@aspect/blok/locales';
 * const frConfig = await loadLocale('fr');
 *
 * @example
 * // Get all supported locale codes
 * import { ALL_LOCALE_CODES } from '@aspect/blok/locales';
 * console.log(ALL_LOCALE_CODES); // Array of all 69 locale codes
 *
 * @see README.md#localization for usage examples
 */

// ============================================================================
// Constants and utilities
// ============================================================================

export {
  // Constants
  DEFAULT_LOCALE,
  ALL_LOCALE_CODES,

  // English locale (always bundled)
  enLocale,

  // Lazy loading functions
  loadLocale,
  preloadLocales,
  buildRegistry,
  getLocaleSync,

  // Direction utilities
  getDirection,

  // BCP-47 normalization
  normalizeLocale,

  // Testing utilities
  clearLocaleCache,
} from './components/i18n/locales';

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../types/configs/i18n-config';
