/**
 * Available options of i18n config property
 */
import { I18nDictionary } from './i18n-dictionary';

/**
 * Supported locale codes that have built-in translations.
 *
 * When adding a new locale:
 * 1. Add the code to this union type
 * 2. Add the code to ALL_LOCALE_CODES in src/components/i18n/locales/index.ts
 * 3. Add the importer to localeImporters in the same file
 * 4. Create the messages.json file in src/components/i18n/locales/{code}/
 *
 * TypeScript will error if localeImporters is missing any code from this type.
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
 */
export type LocaleRegistry = Partial<Record<SupportedLocale, LocaleConfig>>;

/**
 * I18n configuration options.
 *
 * All 68 supported locales are available for lazy loading by default.
 *
 * @see README.md#localization for usage examples
 */
export interface I18nConfig {
  /**
   * Active locale code ('en', 'ru', etc.) or 'auto' to detect from browser.
   * All 68 locales are supported and will be loaded on-demand.
   * @default 'auto'
   */
  locale?: SupportedLocale | 'auto';

  /**
   * Custom dictionary that overrides locale-based translations.
   */
  messages?: I18nDictionary;

  /**
   * Text direction. Auto-determined by locale if not set.
   * @default 'ltr'
   */
  direction?: 'ltr' | 'rtl';

  /**
   * Fallback locale when detection fails or requested locale unavailable.
   * @default 'en'
   */
  defaultLocale?: SupportedLocale;
}
