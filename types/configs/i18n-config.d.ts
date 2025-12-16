/**
 * Available options of i18n config property
 */
import { I18nDictionary } from './i18n-dictionary';

/**
 * Supported locale codes that have built-in translations
 */
export type SupportedLocale = 'ar' | 'az' | 'de' | 'en' | 'es' | 'fr' | 'hy' | 'it' | 'ja' | 'ko' | 'nl' | 'pl' | 'pt' | 'ru' | 'sv' | 'tr' | 'zh';

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
}
