import type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../../../../types/configs/i18n-config';
import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';

// Only English is statically imported - it's the default/fallback
import enMessages from './en/messages.json';

/**
 * RTL (right-to-left) locale codes.
 * Single source of truth for text direction.
 */
export const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set([
  'ar', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi',
]);

/**
 * Get direction for a locale code.
 */
export const getDirection = (code: SupportedLocale): 'ltr' | 'rtl' =>
  RTL_LOCALES.has(code) ? 'rtl' : 'ltr';

/**
 * Build a locale config from a dictionary.
 * Direction is determined automatically from RTL_LOCALES.
 */
export const buildConfig = (code: SupportedLocale, dictionary: I18nDictionary): LocaleConfig => ({
  dictionary,
  direction: getDirection(code),
});

/**
 * Locale codes included in the Basic preset (14 languages).
 * Most commonly used languages covering major global markets.
 */
export const BASIC_LOCALE_CODES: readonly SupportedLocale[] = [
  'en', 'zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ar', 'it', 'ru', 'hi', 'hy', 'id',
] as const;

/**
 * Additional locale codes for the Extended preset (12 languages).
 * Regional European and Asian language coverage.
 */
export const EXTENDED_LOCALE_ADDITIONS: readonly SupportedLocale[] = [
  'tr', 'vi', 'pl', 'nl', 'th', 'ms', 'sv', 'no', 'da', 'fi', 'el', 'cs',
] as const;

/**
 * All locale codes in the Extended preset.
 */
export const EXTENDED_LOCALE_CODES: readonly SupportedLocale[] = [
  ...BASIC_LOCALE_CODES,
  ...EXTENDED_LOCALE_ADDITIONS,
];

/**
 * All supported locale codes.
 */
export const ALL_LOCALE_CODES: readonly SupportedLocale[] = [
  'am', 'ar', 'az', 'bg', 'bn', 'bs', 'cs', 'da', 'de', 'dv', 'el', 'en', 'es', 'et',
  'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'ja', 'ka',
  'km', 'kn', 'ko', 'ku', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne',
  'nl', 'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'sq', 'sr',
  'sv', 'sw', 'ta', 'te', 'th', 'tr', 'ug', 'uk', 'ur', 'vi', 'yi', 'zh',
] as const;

/**
 * Default locale to use when detection fails or locale is not supported
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * English locale config - always available (statically imported).
 */
export const enLocale: LocaleConfig = buildConfig('en', enMessages);

/**
 * Cache for loaded locales.
 */
const localeCache = new Map<SupportedLocale, LocaleConfig>();
localeCache.set('en', enLocale);

/**
 * Dynamic import map for locale dictionaries.
 * Vite/Rollup will code-split these into separate chunks.
 */
const localeImporters: Record<SupportedLocale, () => Promise<{ default: I18nDictionary }>> = {
  am: () => import('./am/messages.json'),
  ar: () => import('./ar/messages.json'),
  az: () => import('./az/messages.json'),
  bg: () => import('./bg/messages.json'),
  bn: () => import('./bn/messages.json'),
  bs: () => import('./bs/messages.json'),
  cs: () => import('./cs/messages.json'),
  da: () => import('./da/messages.json'),
  de: () => import('./de/messages.json'),
  dv: () => import('./dv/messages.json'),
  el: () => import('./el/messages.json'),
  en: () => Promise.resolve({ default: enMessages }),
  es: () => import('./es/messages.json'),
  et: () => import('./et/messages.json'),
  fa: () => import('./fa/messages.json'),
  fi: () => import('./fi/messages.json'),
  fil: () => import('./fil/messages.json'),
  fr: () => import('./fr/messages.json'),
  gu: () => import('./gu/messages.json'),
  he: () => import('./he/messages.json'),
  hi: () => import('./hi/messages.json'),
  hr: () => import('./hr/messages.json'),
  hu: () => import('./hu/messages.json'),
  hy: () => import('./hy/messages.json'),
  id: () => import('./id/messages.json'),
  it: () => import('./it/messages.json'),
  ja: () => import('./ja/messages.json'),
  ka: () => import('./ka/messages.json'),
  km: () => import('./km/messages.json'),
  kn: () => import('./kn/messages.json'),
  ko: () => import('./ko/messages.json'),
  ku: () => import('./ku/messages.json'),
  lo: () => import('./lo/messages.json'),
  lt: () => import('./lt/messages.json'),
  lv: () => import('./lv/messages.json'),
  mk: () => import('./mk/messages.json'),
  ml: () => import('./ml/messages.json'),
  mn: () => import('./mn/messages.json'),
  mr: () => import('./mr/messages.json'),
  ms: () => import('./ms/messages.json'),
  my: () => import('./my/messages.json'),
  ne: () => import('./ne/messages.json'),
  nl: () => import('./nl/messages.json'),
  no: () => import('./no/messages.json'),
  pa: () => import('./pa/messages.json'),
  pl: () => import('./pl/messages.json'),
  ps: () => import('./ps/messages.json'),
  pt: () => import('./pt/messages.json'),
  ro: () => import('./ro/messages.json'),
  ru: () => import('./ru/messages.json'),
  sd: () => import('./sd/messages.json'),
  si: () => import('./si/messages.json'),
  sk: () => import('./sk/messages.json'),
  sl: () => import('./sl/messages.json'),
  sq: () => import('./sq/messages.json'),
  sr: () => import('./sr/messages.json'),
  sv: () => import('./sv/messages.json'),
  sw: () => import('./sw/messages.json'),
  ta: () => import('./ta/messages.json'),
  te: () => import('./te/messages.json'),
  th: () => import('./th/messages.json'),
  tr: () => import('./tr/messages.json'),
  ug: () => import('./ug/messages.json'),
  uk: () => import('./uk/messages.json'),
  ur: () => import('./ur/messages.json'),
  vi: () => import('./vi/messages.json'),
  yi: () => import('./yi/messages.json'),
  zh: () => import('./zh/messages.json'),
};

/**
 * Load a locale configuration asynchronously.
 * Returns cached config if already loaded.
 *
 * @param code - Locale code to load
 * @returns Promise resolving to the locale config
 */
export const loadLocale = async (code: SupportedLocale): Promise<LocaleConfig> => {
  // Return cached if available
  const cached = localeCache.get(code);

  if (cached !== undefined) {
    return cached;
  }

  // Load and cache
  const importer = localeImporters[code];
  const module = await importer();
  const config = buildConfig(code, module.default);

  localeCache.set(code, config);

  return config;
};

/**
 * Get a locale configuration synchronously.
 * Returns undefined if not yet loaded. Use loadLocale() to load first.
 *
 * @param code - Locale code
 * @returns Locale config or undefined if not loaded
 */
export const getLocaleSync = (code: SupportedLocale): LocaleConfig | undefined =>
  localeCache.get(code);

/**
 * Check if a locale is already loaded in the cache.
 *
 * @param code - Locale code to check
 * @returns True if locale is loaded
 */
export const isLocaleLoaded = (code: SupportedLocale): boolean =>
  localeCache.has(code);

/**
 * Preload multiple locales.
 * Useful for preloading a preset's locales.
 *
 * @param codes - Array of locale codes to preload
 * @returns Promise that resolves when all locales are loaded
 */
export const preloadLocales = async (codes: readonly SupportedLocale[]): Promise<void> => {
  await Promise.all(codes.map(loadLocale));
};

/**
 * Load and build a locale registry asynchronously.
 *
 * @param codes - Array of locale codes
 * @returns Promise resolving to the registry
 */
export const buildRegistry = async (codes: readonly SupportedLocale[]): Promise<LocaleRegistry> => {
  await preloadLocales(codes);

  const registry: LocaleRegistry = {};

  for (const code of codes) {
    const config = localeCache.get(code);

    if (config !== undefined) {
      registry[code] = config;
    }
  }

  return registry;
};

// ============================================================================
// Preset factories - these return promises and load only what's needed
// ============================================================================

/**
 * Load the Basic locale preset (14 languages).
 * Use this for tree-shaking - only these locales will be bundled.
 */
export const loadBasicLocales = async (): Promise<LocaleRegistry> =>
  buildRegistry(BASIC_LOCALE_CODES);

/**
 * Load the Extended locale preset (26 languages).
 */
export const loadExtendedLocales = async (): Promise<LocaleRegistry> =>
  buildRegistry(EXTENDED_LOCALE_CODES);

/**
 * Load all locales (68 languages).
 */
export const loadAllLocales = async (): Promise<LocaleRegistry> =>
  buildRegistry(ALL_LOCALE_CODES);
