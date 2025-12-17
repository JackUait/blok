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
 */
export type LocaleRegistry = Partial<Record<SupportedLocale, LocaleConfig>>;

/**
 * I18n configuration options.
 * @see README.md#localization for usage examples
 */
export interface I18nConfig {
  /**
   * Active locale code ('en', 'ru', etc.) or 'auto' to detect from browser.
   * @default 'auto'
   */
  activeLocale?: SupportedLocale | 'auto';

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

  /**
   * Custom locale registry. Use presets (basicLocales, extendedLocales,
   * completeLocales) or build your own for tree-shaking.
   */
  locales?: LocaleRegistry;
}
