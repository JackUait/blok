/**
 * Public entry point for locale imports.
 *
 * Lazy Loading (Recommended):
 * Only English is bundled by default. Use loadLocale() or loadBasicLocales()
 * to load additional locales on-demand, reducing initial bundle size.
 *
 * @example
 * // Load a single locale on-demand
 * import { loadLocale, BASIC_LOCALE_CODES } from '@aspect/blok/locales';
 * const frConfig = await loadLocale('fr');
 *
 * @example
 * // Preload basic locales during app initialization
 * import { loadBasicLocales } from '@aspect/blok/locales';
 * await loadBasicLocales();
 *
 * @see README.md#localization for usage examples
 */

// ============================================================================
// Constants - no bundle size impact
// ============================================================================

export {
  /** Default locale code ('en') */
  DEFAULT_LOCALE,
  /** Set of RTL locale codes */
  RTL_LOCALES,
  /** Basic preset locale codes (14 languages) */
  BASIC_LOCALE_CODES,
  /** Extended preset locale codes (26 languages) */
  EXTENDED_LOCALE_CODES,
  /** Additional codes in extended preset beyond basic */
  EXTENDED_LOCALE_ADDITIONS,
  /** All supported locale codes (68 languages) */
  ALL_LOCALE_CODES,
} from './components/i18n/locales/exports';

// ============================================================================
// English locale - always bundled (default/fallback)
// ============================================================================

export { enLocale } from './components/i18n/locales/exports';

// ============================================================================
// Lazy loading functions - recommended for optimal bundle size
// ============================================================================

export {
  /** Load a single locale on-demand */
  loadLocale,
  /** Load all basic preset locales */
  loadBasicLocales,
  /** Load all extended preset locales */
  loadExtendedLocales,
  /** Load all locales */
  loadAllLocales,
  /** Preload multiple locales */
  preloadLocales,
  /** Build a registry from locale codes (async) */
  buildRegistry,
  /** Get a loaded locale synchronously (returns undefined if not loaded) */
  getLocaleSync,
  /** Check if a locale is loaded */
  isLocaleLoaded,
} from './components/i18n/locales/exports';

// ============================================================================
// Utility functions
// ============================================================================

export {
  /** Get text direction for a locale code */
  getDirection,
  /** Build a locale config from a dictionary */
  buildConfig,
} from './components/i18n/locales/exports';

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../types/configs/i18n-config';
