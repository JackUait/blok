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
  // Constants
  DEFAULT_LOCALE,
  RTL_LOCALES,
  BASIC_LOCALE_CODES,
  EXTENDED_LOCALE_CODES,
  EXTENDED_LOCALE_ADDITIONS,
  ALL_LOCALE_CODES,

  // English locale (always bundled)
  enLocale,

  // Lazy loading functions
  loadLocale,
  loadBasicLocales,
  loadExtendedLocales,
  loadAllLocales,
  preloadLocales,
  buildRegistry,
  getLocaleSync,
  isLocaleLoaded,

  // Direction utilities
  getDirection,
  buildConfig,
} from './components/i18n/locales';

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../types/configs/i18n-config';
