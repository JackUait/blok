/**
 * Individual locale exports and lazy loading utilities.
 * Only English is bundled by default - other locales are loaded on-demand.
 * @see README.md#localization for usage examples
 */
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
} from './index';
