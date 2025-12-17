import defaultDictionary from './locales/en/messages.json';
import type { I18nDictionary, LocaleConfig, LocaleRegistry } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import { DEFAULT_LOCALE, basicLocales } from './locales';

/**
 * Result of locale detection containing the resolved locale and direction
 */
export interface LocaleDetectionResult {
  locale: SupportedLocale;
  dictionary: I18nDictionary;
  direction: 'ltr' | 'rtl';
}

/**
 * Options for initializing the I18n system.
 * @see README.md#localization for usage examples
 */
export interface I18nInitOptions {
  /**
   * Default locale to use when detection fails or locale is not available.
   * Must be present in `locales` if `locales` is specified.
   * @default 'en' or first locale in `locales`
   */
  defaultLocale?: SupportedLocale;

  /**
   * Custom locale registry. When provided, only these locales are available.
   */
  locales?: LocaleRegistry;
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
   * Custom locale registry for tree-shaking support.
   * When set, only locales in this registry are available.
   */
  private static customRegistry: LocaleRegistry | null = null;

  /**
   * Configured default locale
   */
  private static configuredDefaultLocale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Initialize I18n with configuration options.
   * Call before any locale operations when using custom locales for tree-shaking.
   *
   * @param options - Configuration options
   * @throws Error if defaultLocale is not in the locales registry
   */
  public static init(options: I18nInitOptions): void {
    // Set custom registry if provided
    I18n.customRegistry = options.locales ?? null;

    // Determine available locales
    const availableLocales = I18n.customRegistry !== null
      ? Object.keys(I18n.customRegistry) as SupportedLocale[]
      : null;

    // Determine default locale
    const candidateDefault = options.defaultLocale ??
      availableLocales?.[0] ??
      DEFAULT_LOCALE;

    // Validate default locale is available
    if (availableLocales !== null && !availableLocales.includes(candidateDefault)) {
      throw new Error(
        `defaultLocale "${candidateDefault}" is not in locales. ` +
        `Available: ${availableLocales.join(', ')}`
      );
    }

    I18n.configuredDefaultLocale = candidateDefault;
  }

  /**
   * Reset I18n to default state.
   * Useful for testing or reinitializing the system.
   */
  public static reset(): void {
    I18n.customRegistry = null;
    I18n.configuredDefaultLocale = DEFAULT_LOCALE;
    I18n.currentLocale = DEFAULT_LOCALE;
    I18n.currentDictionary = defaultDictionary;
  }

  /**
   * Check if a locale is available based on current configuration
   *
   * @param locale - Locale code to check
   * @returns True if the locale is available
   */
  private static isLocaleAvailable(locale: string): locale is SupportedLocale {
    const registry = I18n.customRegistry ?? basicLocales;

    return locale in registry;
  }

  /**
   * Get locale config from appropriate registry
   *
   * @param locale - Locale code
   * @returns Locale config
   */
  private static getLocaleConfigInternal(locale: SupportedLocale): LocaleConfig {
    const registry = I18n.customRegistry ?? basicLocales;
    const config = registry[locale];

    if (config === undefined) {
      throw new Error(`Locale "${locale}" not found in registry`);
    }

    return config;
  }

  /**
   * Translate a key using the current dictionary.
   * If no translation exists, returns the last segment of the key as fallback.
   * For example, "ui.popover.Search" returns "Search" if not found.
   * @param key - full dot-notation key to the translation
   */
  public static t(key: string): string {
    const translation = I18n.currentDictionary[key];

    if (translation) {
      return translation;
    }

    const lastDot = key.lastIndexOf('.');

    return lastDot === -1 ? key : key.slice(lastDot + 1);
  }

  /**
   * Adjust module for using external dictionary
   * @param dictionary - new messages list to override default
   */
  public static setDictionary(dictionary: I18nDictionary): void {
    I18n.currentDictionary = dictionary;
  }

  /**
   * Set locale by code and update the dictionary.
   * Rejects unavailable locales, falling back to defaultLocale with a warning.
   *
   * @param locale - Locale code to set
   * @returns The locale config that was set
   */
  public static setLocale(locale: SupportedLocale): LocaleDetectionResult {
    if (I18n.isLocaleAvailable(locale)) {
      const config = I18n.getLocaleConfigInternal(locale);

      I18n.currentLocale = locale;
      I18n.currentDictionary = config.dictionary;

      return {
        locale,
        dictionary: config.dictionary,
        direction: config.direction,
      };
    }

    // Guard against infinite recursion if default locale is misconfigured
    if (locale === I18n.configuredDefaultLocale) {
      throw new Error(
        `Default locale "${locale}" is not available. ` +
        `This indicates a configuration error.`
      );
    }

    const available = I18n.getSupportedLocales();

    console.warn(
      `Locale "${locale}" is not available. Falling back to "${I18n.configuredDefaultLocale}". ` +
      `Available locales: ${available.join(', ')}`
    );

    const fallbackLocale = I18n.configuredDefaultLocale;
    const config = I18n.getLocaleConfigInternal(fallbackLocale);

    I18n.currentLocale = fallbackLocale;
    I18n.currentDictionary = config.dictionary;

    return {
      locale: fallbackLocale,
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
   * Get the configured default locale
   * @returns Default locale code
   */
  public static getDefaultLocale(): SupportedLocale {
    return I18n.configuredDefaultLocale;
  }

  /**
   * Detect the best matching locale from browser settings.
   * Only returns locales from the custom registry if one is configured.
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
      return I18n.configuredDefaultLocale;
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

    return I18n.configuredDefaultLocale;
  }

  /**
   * Try to match a language tag to an available locale
   * @param languageTag - BCP 47 language tag (e.g., 'en-US', 'ru')
   * @returns Matched locale or null if no match found
   */
  private static matchLanguageTag(languageTag: string): SupportedLocale | null {
    const normalizedTag = languageTag.toLowerCase();

    // Try exact match first (e.g., 'ru', 'en')
    if (I18n.isLocaleAvailable(normalizedTag)) {
      return normalizedTag;
    }

    // Try base language (e.g., 'en-US' -> 'en', 'ru-RU' -> 'ru')
    const baseLang = normalizedTag.split('-')[0];

    if (baseLang !== undefined && I18n.isLocaleAvailable(baseLang)) {
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

    // Use specified locale if available, otherwise fallback to default
    const resolvedLocale = I18n.isLocaleAvailable(locale) ? locale : I18n.configuredDefaultLocale;

    return I18n.setLocale(resolvedLocale);
  }

  /**
   * Get list of available locales
   * @returns Array of supported locale codes
   */
  public static getSupportedLocales(): SupportedLocale[] {
    const registry = I18n.customRegistry ?? basicLocales;

    return Object.keys(registry) as SupportedLocale[];
  }

  /**
   * Check if a translation exists for the given key
   * @param key - full dot-notation key to check
   * @returns true if a translation exists (non-empty string)
   */
  public static hasTranslation(key: string): boolean {
    const translation = I18n.currentDictionary[key];

    return typeof translation === 'string' && translation.length > 0;
  }
}
