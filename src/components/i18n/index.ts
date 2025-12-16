import defaultDictionary from './locales/en/messages.json';
import type { I18nDictionary, Dictionary } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import type { LeavesDictKeys } from '../../types-internal/i18n-internal-namespace';
import {
  localeRegistry,
  DEFAULT_LOCALE,
  isLocaleSupported,
  getLocaleConfig,
} from './locales';

/**
 * Type for all available internal dictionary strings
 */
type DictKeys = LeavesDictKeys<typeof defaultDictionary>;

/**
 * Result of locale detection containing the resolved locale and direction
 */
export interface LocaleDetectionResult {
  locale: SupportedLocale;
  dictionary: I18nDictionary;
  direction: 'ltr' | 'rtl';
}

/**
 * This class will responsible for the translation through the language dictionary
 */
export default class I18n {
  /**
   * Property that stores messages dictionary
   */
  private static currentDictionary: I18nDictionary = defaultDictionary;

  /**
   * Current active locale
   */
  private static currentLocale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Type-safe translation for internal UI texts:
   * Perform translation of the string by namespace and a key
   * @example I18n.ui(I18nInternalNS.ui.blockTunes.toggler, 'Drag to move')
   * @param internalNamespace - path to translated string in dictionary
   * @param dictKey - dictionary key. Better to use default locale original text
   */
  public static ui(internalNamespace: string, dictKey: DictKeys): string {
    return I18n._t(internalNamespace, dictKey);
  }

  /**
   * Translate for external strings that is not presented in default dictionary.
   * For example, for user-specified tool names
   * @param namespace - path to translated string in dictionary
   * @param dictKey - dictionary key. Better to use default locale original text
   */
  public static t(namespace: string, dictKey: string): string {
    return I18n._t(namespace, dictKey);
  }

  /**
   * Adjust module for using external dictionary
   * @param dictionary - new messages list to override default
   */
  public static setDictionary(dictionary: I18nDictionary): void {
    I18n.currentDictionary = dictionary;
  }

  /**
   * Set locale by code and update the dictionary
   * @param locale - Locale code to set
   * @returns The locale config that was set
   */
  public static setLocale(locale: SupportedLocale): LocaleDetectionResult {
    const config = getLocaleConfig(locale);

    I18n.currentLocale = locale;
    I18n.currentDictionary = config.dictionary;

    return {
      locale,
      dictionary: config.dictionary,
      direction: config.direction,
    };
  }

  /**
   * Get the current active locale
   * @returns Current locale code
   */
  public static getLocale(): SupportedLocale {
    return I18n.currentLocale;
  }

  /**
   * Detect the best matching locale from browser settings
   * Uses navigator.languages with fallback chain:
   * 1. Exact match (e.g., 'ru' matches 'ru')
   * 2. Base language match (e.g., 'en-US' matches 'en')
   * 3. Default locale if no match found
   *
   * @returns The detected locale code
   */
  public static detectLocale(): SupportedLocale {
    // Check if we're in a browser environment
    if (typeof navigator === 'undefined') {
      return DEFAULT_LOCALE;
    }

    // Get user's preferred languages (ordered by preference)
    const browserLanguages = navigator.languages ?? [navigator.language];

    for (const lang of browserLanguages) {
      if (!lang) {
        continue;
      }

      const matched = I18n.matchLanguageTag(lang);

      if (matched !== null) {
        return matched;
      }
    }

    return DEFAULT_LOCALE;
  }

  /**
   * Try to match a language tag to a supported locale
   * @param languageTag - BCP 47 language tag (e.g., 'en-US', 'ru')
   * @returns Matched locale or null if no match found
   */
  private static matchLanguageTag(languageTag: string): SupportedLocale | null {
    const normalizedTag = languageTag.toLowerCase();

    // Try exact match first (e.g., 'ru', 'en')
    if (isLocaleSupported(normalizedTag)) {
      return normalizedTag;
    }

    // Try base language (e.g., 'en-US' -> 'en', 'ru-RU' -> 'ru')
    const baseLang = normalizedTag.split('-')[0];

    if (baseLang !== undefined && isLocaleSupported(baseLang)) {
      return baseLang;
    }

    return null;
  }

  /**
   * Resolve locale configuration based on the provided locale setting
   * @param locale - Locale setting ('auto', specific locale, or undefined)
   * @returns Resolved locale configuration
   */
  public static resolveLocale(locale?: SupportedLocale | 'auto'): LocaleDetectionResult {
    // Auto-detect from browser
    if (locale === undefined || locale === 'auto') {
      return I18n.setLocale(I18n.detectLocale());
    }

    // Use specified locale if supported, otherwise fallback to default
    const resolvedLocale = isLocaleSupported(locale) ? locale : DEFAULT_LOCALE;

    return I18n.setLocale(resolvedLocale);
  }

  /**
   * Get list of all supported locales
   * @returns Array of supported locale codes
   */
  public static getSupportedLocales(): SupportedLocale[] {
    return Object.keys(localeRegistry) as SupportedLocale[];
  }

  /**
   * Perform translation both for internal and external namespaces
   * If there is no translation found, returns passed key as a translated message
   * @param namespace - path to translated string in dictionary
   * @param dictKey - dictionary key. Better to use default locale original text
   */
  private static _t(namespace: string, dictKey: string): string {
    const section = I18n.getNamespace(namespace);

    /**
     * For Console Message to Check Section is defined or not
     * if (section === undefined) {
     *  _.logLabeled('I18n: section %o was not found in current dictionary', 'log', namespace);
     * }
     */

    if (!section || !section[dictKey]) {
      return dictKey;
    }

    return section[dictKey] as string;
  }

  /**
   * Find messages section by namespace path
   * @param namespace - path to section
   */
  private static getNamespace(namespace: string): Dictionary {
    const parts = namespace.split('.');

    return parts.reduce((section, part) => {
      if (!section || !Object.keys(section).length) {
        return {};
      }

      const value = section[part];

      return typeof value === 'string' ? {} : (value as Dictionary);
    }, I18n.currentDictionary as Dictionary);
  }
}
