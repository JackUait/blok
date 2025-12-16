/**
 * Available options of i18n config property
 */
import { I18nDictionary } from './i18n-dictionary';

/**
 * Supported locale codes that have built-in translations
 */
export type SupportedLocale = 'am' | 'ar' | 'az' | 'bg' | 'bn' | 'bs' | 'cs' | 'da' | 'de' | 'dv' | 'el' | 'en' | 'es' | 'et' | 'fa' | 'fi' | 'fil' | 'fr' | 'gu' | 'he' | 'hi' | 'hr' | 'hu' | 'hy' | 'id' | 'it' | 'ja' | 'ka' | 'km' | 'kn' | 'ko' | 'ku' | 'lo' | 'lt' | 'lv' | 'mk' | 'ml' | 'mn' | 'mr' | 'ms' | 'my' | 'ne' | 'nl' | 'no' | 'pa' | 'pl' | 'ps' | 'pt' | 'ro' | 'ru' | 'sd' | 'si' | 'sk' | 'sl' | 'sq' | 'sr' | 'sv' | 'sw' | 'ta' | 'te' | 'th' | 'tr' | 'ug' | 'uk' | 'ur' | 'vi' | 'yi' | 'zh';

/**
 * Configuration for a single locale including its dictionary and text direction.
 * This is the single source of truth for locale configuration shape.
 */
export interface LocaleConfig {
  /** Translation dictionary mapping keys to translated strings */
  dictionary: I18nDictionary;
  /** Text direction for the locale */
  direction: 'ltr' | 'rtl';
}

/**
 * Registry of locale configurations.
 * Used for tree-shaking by providing only the locales you need.
 *
 * @example
 * ```typescript
 * import { enLocale, frLocale } from '@jackuait/blok/locales';
 *
 * const myLocales: LocaleRegistry = {
 *   en: enLocale,
 *   fr: frLocale,
 * };
 * ```
 */
export type LocaleRegistry = Partial<Record<SupportedLocale, LocaleConfig>>;

export interface I18nConfig {
  /**
   * Locale code to use for translations.
   * Can be a specific locale (e.g., 'en', 'ru') or 'auto' to detect from browser.
   * When set to 'auto', uses navigator.language with fallback chain.
   * If not set, defaults to 'auto'.
   *
   * @example
   * locale: 'ru'        // Use Russian
   * locale: 'en'        // Use English
   * locale: 'auto'      // Detect from browser (default)
   */
  locale?: SupportedLocale | 'auto';

  /**
   * Dictionary used for translation.
   * If provided, overrides the locale-based dictionary.
   * Use this for custom translations or unsupported languages.
   */
  messages?: I18nDictionary;

  /**
   * Text direction. If not set, automatically determined by locale
   * or defaults to 'ltr'.
   */
  direction?: 'ltr' | 'rtl';

  /**
   * Default locale to use when detection fails or requested locale is not available.
   * Must be present in `locales` if `locales` is specified.
   *
   * @default 'en' or first locale in `locales`
   */
  defaultLocale?: SupportedLocale;

  /**
   * Custom locale registry for tree-shaking and locale restriction.
   * When provided:
   * - Only these locales will be available at runtime
   * - Bundle size is reduced (tree-shaking removes unused locales)
   * - detectLocale() will only return locales from this registry
   * - setLocale() will reject locales not in this registry
   *
   * @example
   * ```typescript
   * import { enLocale, frLocale, deLocale } from '@jackuait/blok/locales';
   *
   * new Blok({
   *   i18n: {
   *     locales: { en: enLocale, fr: frLocale, de: deLocale },
   *     locale: 'auto',
   *   }
   * });
   * ```
   */
  locales?: LocaleRegistry;
}
