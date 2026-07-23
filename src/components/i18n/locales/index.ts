import type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../../../../types/configs/i18n-config';
import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';

// Only English is statically imported - it's the default/fallback
import enMessages from './en.json';

/**
 * RTL (right-to-left) locale codes.
 * Single source of truth for text direction.
 * @internal
 */
const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set([
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
 * @internal
 */
const buildConfig = (code: SupportedLocale, dictionary: I18nDictionary): LocaleConfig => ({
  dictionary,
  direction: getDirection(code),
});

/**
 * All supported locale codes (69 locale variants).
 *
 * All locales are available for lazy loading by default - no preset restrictions.
 *
 * IMPORTANT: This array must match the SupportedLocale type in types/configs/i18n-config.d.ts.
 * The localeImporters object below will fail to compile if they don't match since it's typed
 * as Record<SupportedLocale, ...>.
 */
export const ALL_LOCALE_CODES: readonly SupportedLocale[] = [
  'am', 'ar', 'az', 'bg', 'bn', 'bs', 'cs', 'da', 'de', 'dv', 'el', 'en', 'es', 'et',
  'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'ja', 'ka',
  'km', 'kn', 'ko', 'ku', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne',
  'nl', 'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'sq', 'sr',
  'sv', 'sw', 'ta', 'te', 'th', 'tr', 'ug', 'uk', 'ur', 'vi', 'yi', 'zh', 'zh-TW',
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
 *
 * Note: This is intentionally a module-level cache shared across all Blok instances.
 * Locale dictionaries are immutable and expensive to load, so sharing is beneficial.
 * Use clearLocaleCache() in tests to reset state between test runs.
 */
const localeCache = new Map<SupportedLocale, LocaleConfig>();
localeCache.set('en', enLocale);

/**
 * Clear the locale cache.
 *
 * This is primarily useful for testing to ensure test isolation.
 * In production, the cache should persist for the lifetime of the application.
 *
 * @internal
 */
export const clearLocaleCache = (): void => {
  localeCache.clear();
  // Always keep English available since it's statically imported
  localeCache.set('en', enLocale);
};

/**
 * Dynamic import map for locale dictionaries.
 * Vite/Rollup will code-split these into separate chunks.
 */
const localeImporters: Record<SupportedLocale, () => Promise<{ default: I18nDictionary }>> = {
  am: () => import('./am.json'),
  ar: () => import('./ar.json'),
  az: () => import('./az.json'),
  bg: () => import('./bg.json'),
  bn: () => import('./bn.json'),
  bs: () => import('./bs.json'),
  cs: () => import('./cs.json'),
  da: () => import('./da.json'),
  de: () => import('./de.json'),
  dv: () => import('./dv.json'),
  el: () => import('./el.json'),
  en: () => Promise.resolve({ default: enMessages }),
  es: () => import('./es.json'),
  et: () => import('./et.json'),
  fa: () => import('./fa.json'),
  fi: () => import('./fi.json'),
  fil: () => import('./fil.json'),
  fr: () => import('./fr.json'),
  gu: () => import('./gu.json'),
  he: () => import('./he.json'),
  hi: () => import('./hi.json'),
  hr: () => import('./hr.json'),
  hu: () => import('./hu.json'),
  hy: () => import('./hy.json'),
  id: () => import('./id.json'),
  it: () => import('./it.json'),
  ja: () => import('./ja.json'),
  ka: () => import('./ka.json'),
  km: () => import('./km.json'),
  kn: () => import('./kn.json'),
  ko: () => import('./ko.json'),
  ku: () => import('./ku.json'),
  lo: () => import('./lo.json'),
  lt: () => import('./lt.json'),
  lv: () => import('./lv.json'),
  mk: () => import('./mk.json'),
  ml: () => import('./ml.json'),
  mn: () => import('./mn.json'),
  mr: () => import('./mr.json'),
  ms: () => import('./ms.json'),
  my: () => import('./my.json'),
  ne: () => import('./ne.json'),
  nl: () => import('./nl.json'),
  no: () => import('./no.json'),
  pa: () => import('./pa.json'),
  pl: () => import('./pl.json'),
  ps: () => import('./ps.json'),
  pt: () => import('./pt.json'),
  ro: () => import('./ro.json'),
  ru: () => import('./ru.json'),
  sd: () => import('./sd.json'),
  si: () => import('./si.json'),
  sk: () => import('./sk.json'),
  sl: () => import('./sl.json'),
  sq: () => import('./sq.json'),
  sr: () => import('./sr.json'),
  sv: () => import('./sv.json'),
  sw: () => import('./sw.json'),
  ta: () => import('./ta.json'),
  te: () => import('./te.json'),
  th: () => import('./th.json'),
  tr: () => import('./tr.json'),
  ug: () => import('./ug.json'),
  uk: () => import('./uk.json'),
  ur: () => import('./ur.json'),
  vi: () => import('./vi.json'),
  yi: () => import('./yi.json'),
  zh: () => import('./zh.json'),
  'zh-TW': () => import('./zh-TW.json'),
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

/**
 * English messages dictionary - always available for fallback search.
 * @internal
 */
export { enMessages };
