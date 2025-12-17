import defaultDictionary from './locales/en/messages.json';
import type { I18nDictionary, LocaleConfig, LocaleRegistry } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import {
  DEFAULT_LOCALE,
  enLocale,
  loadLocale,
  getLocaleSync,
  isLocaleLoaded,
  getDirection,
  ALL_LOCALE_CODES,
  BASIC_LOCALE_CODES,
} from './locales';

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
   * For lazy loading, pass locale codes to `allowedLocales` instead.
   */
  locales?: LocaleRegistry;

  /**
   * Allowed locale codes for lazy loading.
   * When set, only these locales can be loaded on-demand.
   * Use this instead of `locales` for smaller bundle size.
   */
  allowedLocales?: readonly SupportedLocale[];
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
   * Allowed locale codes for lazy loading.
   */
  private static allowedLocales: readonly SupportedLocale[] | null = null;

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
    I18n.allowedLocales = options.allowedLocales ?? null;

    // Determine available locales
    const availableLocales = I18n.getAvailableLocalesFromOptions();

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
   * Get available locales from current options
   */
  private static getAvailableLocalesFromOptions(): SupportedLocale[] | null {
    if (I18n.customRegistry !== null) {
      return Object.keys(I18n.customRegistry) as SupportedLocale[];
    }

    if (I18n.allowedLocales !== null) {
      return [...I18n.allowedLocales];
    }

    return null;
  }

  /**
   * Reset I18n to default state.
   * Useful for testing or reinitializing the system.
   */
  public static reset(): void {
    I18n.customRegistry = null;
    I18n.allowedLocales = null;
    I18n.configuredDefaultLocale = DEFAULT_LOCALE;
    I18n.currentLocale = DEFAULT_LOCALE;
    I18n.currentDictionary = defaultDictionary;
  }

  /**
   * Check if a locale code is in the allowed list
   */
  private static isLocaleAllowed(locale: string): locale is SupportedLocale {
    // If custom registry is set, check against it
    if (I18n.customRegistry !== null) {
      return locale in I18n.customRegistry;
    }

    // If allowed locales are set, check against them
    if (I18n.allowedLocales !== null) {
      return I18n.allowedLocales.includes(locale as SupportedLocale);
    }

    // Default: allow basic locales
    return BASIC_LOCALE_CODES.includes(locale as SupportedLocale);
  }

  /**
   * Check if a locale is available (allowed and either loaded or in sync registry)
   *
   * @param locale - Locale code to check
   * @returns True if the locale is available
   */
  private static isLocaleAvailable(locale: string): locale is SupportedLocale {
    if (!I18n.isLocaleAllowed(locale)) {
      return false;
    }

    // If custom registry, must be in registry
    if (I18n.customRegistry !== null) {
      return locale in I18n.customRegistry;
    }

    // For lazy loading, check if loaded or is English (always available)
    return locale === 'en' || isLocaleLoaded(locale as SupportedLocale);
  }

  /**
   * Get locale config from appropriate source
   *
   * @param locale - Locale code
   * @returns Locale config or undefined
   */
  private static getLocaleConfigInternal(locale: SupportedLocale): LocaleConfig | undefined {
    // Check custom registry first
    if (I18n.customRegistry !== null) {
      return I18n.customRegistry[locale];
    }

    // Check cache (for lazy-loaded locales)
    return getLocaleSync(locale);
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
   * Set locale by code and update the dictionary (synchronous).
   * Only works if the locale is already loaded or in a custom registry.
   * For lazy loading, use setLocaleAsync() instead.
   *
   * @param locale - Locale code to set
   * @returns The locale config that was set
   */
  public static setLocale(locale: SupportedLocale): LocaleDetectionResult {
    // Try to get config for available locale
    const config = I18n.isLocaleAvailable(locale)
      ? I18n.getLocaleConfigInternal(locale)
      : undefined;

    if (config !== undefined) {
      I18n.currentLocale = locale;
      I18n.currentDictionary = config.dictionary;

      return {
        locale,
        dictionary: config.dictionary,
        direction: config.direction,
      };
    }

    // Guard against infinite recursion if default locale is misconfigured
    if (locale === I18n.configuredDefaultLocale && locale !== 'en') {
      console.warn(
        `Default locale "${locale}" is not loaded. Falling back to English.`
      );

      return I18n.setEnglishFallback();
    }

    if (locale === I18n.configuredDefaultLocale) {
      // English is always available
      return I18n.setEnglishFallback();
    }

    const available = I18n.getSupportedLocales();

    console.warn(
      `Locale "${locale}" is not available. Falling back to "${I18n.configuredDefaultLocale}". ` +
      `Available locales: ${available.join(', ')}`
    );

    return I18n.setLocale(I18n.configuredDefaultLocale);
  }

  /**
   * Set English as fallback locale
   */
  private static setEnglishFallback(): LocaleDetectionResult {
    I18n.currentLocale = 'en';
    I18n.currentDictionary = enLocale.dictionary;

    return {
      locale: 'en',
      dictionary: enLocale.dictionary,
      direction: 'ltr',
    };
  }

  /**
   * Set locale by code asynchronously, loading the locale if needed.
   * This is the preferred method for lazy loading.
   *
   * @param locale - Locale code to set
   * @returns Promise resolving to the locale config that was set
   */
  public static async setLocaleAsync(locale: SupportedLocale): Promise<LocaleDetectionResult> {
    // Check if locale is allowed
    if (!I18n.isLocaleAllowed(locale)) {
      console.warn(
        `Locale "${locale}" is not allowed. Falling back to "${I18n.configuredDefaultLocale}".`
      );

      return I18n.setLocaleAsync(I18n.configuredDefaultLocale);
    }

    // If using custom registry, use sync method
    if (I18n.customRegistry !== null) {
      return I18n.setLocale(locale);
    }

    // Load locale if not already loaded
    try {
      const config = await loadLocale(locale);

      I18n.currentLocale = locale;
      I18n.currentDictionary = config.dictionary;

      return {
        locale,
        dictionary: config.dictionary,
        direction: config.direction,
      };
    } catch (error) {
      console.warn(
        `Failed to load locale "${locale}". Falling back to "${I18n.configuredDefaultLocale}".`,
        error
      );

      // Prevent infinite recursion
      if (locale === I18n.configuredDefaultLocale) {
        I18n.currentLocale = 'en';
        I18n.currentDictionary = enLocale.dictionary;

        return {
          locale: 'en',
          dictionary: enLocale.dictionary,
          direction: 'ltr',
        };
      }

      return I18n.setLocaleAsync(I18n.configuredDefaultLocale);
    }
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
   * Try to match a language tag to an allowed locale
   * @param languageTag - BCP 47 language tag (e.g., 'en-US', 'ru')
   * @returns Matched locale or null if no match found
   */
  private static matchLanguageTag(languageTag: string): SupportedLocale | null {
    const normalizedTag = languageTag.toLowerCase();

    // Try exact match first (e.g., 'ru', 'en')
    if (I18n.isLocaleAllowed(normalizedTag)) {
      return normalizedTag;
    }

    // Try base language (e.g., 'en-US' -> 'en', 'ru-RU' -> 'ru')
    const baseLang = normalizedTag.split('-')[0];

    if (baseLang !== undefined && I18n.isLocaleAllowed(baseLang)) {
      return baseLang;
    }

    return null;
  }

  /**
   * Resolve locale configuration based on the provided locale setting (synchronous).
   * Only works if the locale is already loaded.
   * For lazy loading, use resolveLocaleAsync() instead.
   *
   * @param locale - Locale setting ('auto', specific locale, or undefined)
   * @returns Resolved locale configuration
   */
  public static resolveLocale(locale?: SupportedLocale | 'auto'): LocaleDetectionResult {
    // Auto-detect from browser
    if (locale === undefined || locale === 'auto') {
      return I18n.setLocale(I18n.detectLocale());
    }

    // Use specified locale if available, otherwise fallback to default
    const resolvedLocale = I18n.isLocaleAllowed(locale) ? locale : I18n.configuredDefaultLocale;

    return I18n.setLocale(resolvedLocale);
  }

  /**
   * Resolve locale configuration asynchronously, loading if needed.
   * This is the preferred method for lazy loading.
   *
   * @param locale - Locale setting ('auto', specific locale, or undefined)
   * @returns Promise resolving to the locale configuration
   */
  public static async resolveLocaleAsync(locale?: SupportedLocale | 'auto'): Promise<LocaleDetectionResult> {
    // Auto-detect from browser
    if (locale === undefined || locale === 'auto') {
      return I18n.setLocaleAsync(I18n.detectLocale());
    }

    // Use specified locale if allowed, otherwise fallback to default
    const resolvedLocale = I18n.isLocaleAllowed(locale) ? locale : I18n.configuredDefaultLocale;

    return I18n.setLocaleAsync(resolvedLocale);
  }

  /**
   * Get list of available locales.
   * For lazy loading mode, returns allowed locales (not necessarily loaded).
   *
   * @returns Array of supported locale codes
   */
  public static getSupportedLocales(): SupportedLocale[] {
    if (I18n.customRegistry !== null) {
      return Object.keys(I18n.customRegistry) as SupportedLocale[];
    }

    if (I18n.allowedLocales !== null) {
      return [...I18n.allowedLocales];
    }

    // Default: basic locales
    return [...BASIC_LOCALE_CODES];
  }

  /**
   * Get list of all possible locale codes (not necessarily available).
   *
   * @returns Array of all locale codes
   */
  public static getAllLocaleCodes(): SupportedLocale[] {
    return [...ALL_LOCALE_CODES];
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

  /**
   * Get direction for any locale code without loading it.
   *
   * @param locale - Locale code
   * @returns Text direction
   */
  public static getDirectionForLocale(locale: SupportedLocale): 'ltr' | 'rtl' {
    return getDirection(locale);
  }
}
