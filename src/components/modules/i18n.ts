import { Module } from '../__module';
import type { I18nDictionary } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import {
  DEFAULT_LOCALE,
  loadLocale,
  getDirection,
  ALL_LOCALE_CODES,
  enMessages,
} from '../i18n/locales';
import { LightweightI18n } from '../i18n/lightweight-i18n';
import type { I18nextInitResult } from '../i18n/i18next-loader';

/**
 * I18n module - handles translations and locale management.
 *
 * Uses a lightweight implementation for English (default) and dynamically
 * loads i18next only when non-English locales are needed.
 *
 * This lazy-loading approach saves ~18 KB gzipped for English-only users.
 *
 * Instance-based module that provides:
 * - Translation lookup with interpolation
 * - Lazy locale loading
 * - Browser locale detection
 * - RTL support
 * - Pluralization support (via i18next when loaded)
 */
export class I18n extends Module {
  /**
   * Lightweight i18n for English (synchronous, no dependencies)
   */
  private lightweightI18n: LightweightI18n;

  /**
   * Full i18next instance (loaded dynamically for non-English locales)
   */
  private i18nextWrapper: I18nextInitResult | null = null;

  /**
   * Current locale code
   */
  private locale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Default locale to fall back to
   */
  private defaultLocale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Whether we're using the full i18next implementation
   */
  private usingI18next = false;

  /**
   * Constructor - creates lightweight i18n instance
   */
  constructor(...args: ConstructorParameters<typeof Module>) {
    super(...args);
    this.lightweightI18n = new LightweightI18n();
  }

  /**
   * Translate a key with optional interpolation.
   *
   * @param key - Translation key (e.g., 'blockSettings.delete')
   * @param vars - Optional variables to interpolate (e.g., { count: 5 })
   * @returns Translated string, or the key if not found
   *
   * @example
   * // Simple translation
   * this.Blok.I18n.t('blockSettings.delete')
   *
   * @example
   * // With interpolation
   * this.Blok.I18n.t('a11y.blockMoved', { position: 3, total: 10 })
   */
  public t(key: string, vars?: Record<string, string | number>): string {
    if (this.usingI18next && this.i18nextWrapper !== null) {
      return this.i18nextWrapper.t(key, vars);
    }

    return this.lightweightI18n.t(key, vars);
  }

  /**
   * Get the English translation for a key.
   * Used for multilingual search - always searches against English terms.
   *
   * @param key - Translation key (e.g., 'toolNames.heading')
   * @returns English translation string, or empty string if not found
   */
  public getEnglishTranslation(key: string): string {
    return (enMessages as I18nDictionary)[key] ?? '';
  }

  /**
   * Check if a translation exists for the given key
   *
   * @param key - Translation key to check
   * @returns True if translation exists
   */
  public has(key: string): boolean {
    if (this.usingI18next && this.i18nextWrapper !== null) {
      return this.i18nextWrapper.has(key);
    }

    return this.lightweightI18n.has(key);
  }

  /**
   * Set the active locale, loading it if necessary.
   * All 68 supported locales are available for loading.
   *
   * @param locale - Locale code to set
   * @returns Promise that resolves when locale is loaded and set
   */
  public async setLocale(locale: SupportedLocale): Promise<void> {
    try {
      // For English, use lightweight implementation
      if (locale === 'en') {
        this.locale = 'en';
        this.usingI18next = false;

        return;
      }

      // For non-English, load i18next dynamically
      const localeConfig = await loadLocale(locale);

      await this.ensureI18nextLoaded(locale, localeConfig);

      if (this.i18nextWrapper === null) {
        return;
      }

      // If locale was already loaded, just change language
      const needsBundle = !this.i18nextWrapper.instance.hasResourceBundle(locale, 'translation');

      if (needsBundle) {
        this.i18nextWrapper.instance.addResourceBundle(locale, 'translation', localeConfig.dictionary);
      }

      await this.i18nextWrapper.changeLanguage(locale);

      this.locale = locale;
      this.usingI18next = true;
    } catch (error) {
      // Log warning but don't throw - graceful degradation to default locale
      console.warn(`Failed to load locale "${locale}". Falling back to "${this.defaultLocale}".`, error);
      this.locale = this.defaultLocale;

      if (this.defaultLocale === 'en') {
        this.usingI18next = false;
      }
    }
  }

  /**
   * Detect browser locale and set it.
   *
   * @returns The detected and set locale code
   */
  public async detectAndSetLocale(): Promise<SupportedLocale> {
    const detected = this.detectBrowserLocale();

    await this.setLocale(detected);

    return this.locale;
  }

  /**
   * Set a custom dictionary directly.
   * Useful for custom translations or testing.
   *
   * @param dictionary - Custom translation dictionary
   */
  public setDictionary(dictionary: I18nDictionary): void {
    if (this.usingI18next && this.i18nextWrapper !== null) {
      this.i18nextWrapper.setDictionary(dictionary);
    } else {
      this.lightweightI18n.setDictionary(dictionary);
    }
  }

  /**
   * Get the current locale code
   */
  public getLocale(): SupportedLocale {
    return this.locale;
  }

  /**
   * Get the text direction for the current locale
   */
  public getDirection(): 'ltr' | 'rtl' {
    return getDirection(this.locale);
  }

  /**
   * Get the text direction for any locale code
   *
   * @param locale - Locale code to check
   */
  public getDirectionForLocale(locale: SupportedLocale): 'ltr' | 'rtl' {
    return getDirection(locale);
  }

  /**
   * Module preparation - called during editor initialization.
   * Uses lightweight i18n for English, loads i18next only for other locales.
   */
  public async prepare(): Promise<void> {
    const i18nConfig = this.config.i18n;

    // Set default locale if configured
    this.applyDefaultLocale(i18nConfig?.defaultLocale);

    // Load base translations first
    const requestedLocale = i18nConfig?.locale;

    if (requestedLocale === undefined || requestedLocale === 'auto') {
      await this.detectAndSetLocale();
    } else {
      await this.setLocale(requestedLocale);
    }

    // Merge custom messages on top of base translations (if provided)
    if (i18nConfig?.messages !== undefined) {
      this.setDictionary(i18nConfig.messages);
    }

    // Update config.i18n.direction so other modules can access it via isRtl getter
    this.updateConfigDirection(i18nConfig?.direction ?? this.getDirection());
  }

  /**
   * Dynamically load i18next when needed for non-English locales
   */
  private async ensureI18nextLoaded(
    locale: SupportedLocale,
    localeConfig: { dictionary: I18nDictionary }
  ): Promise<void> {
    if (this.i18nextWrapper !== null) {
      return;
    }

    // Dynamic import of the i18next loader
    const { loadI18next } = await import('../i18n/i18next-loader');

    this.i18nextWrapper = await loadI18next(locale, localeConfig);
  }

  /**
   * Update the config.i18n.direction value
   */
  private updateConfigDirection(direction: 'ltr' | 'rtl'): void {
    if (this.config.i18n === undefined) {
      this.config.i18n = {};
    }
    this.config.i18n.direction = direction;
  }

  /**
   * Apply default locale from config if valid.
   * The locale is type-checked at compile time via SupportedLocale type.
   */
  private applyDefaultLocale(defaultLocale: SupportedLocale | undefined): void {
    if (defaultLocale === undefined) {
      return;
    }

    this.defaultLocale = defaultLocale;
  }

  /**
   * Check if a locale code is supported.
   * All 68 locales in ALL_LOCALE_CODES are supported.
   */
  private isLocaleSupported(locale: string): locale is SupportedLocale {
    return ALL_LOCALE_CODES.includes(locale as SupportedLocale);
  }

  /**
   * Detect best matching locale from browser settings
   */
  private detectBrowserLocale(): SupportedLocale {
    if (typeof navigator === 'undefined') {
      return this.defaultLocale;
    }

    const browserLanguages = navigator.languages ?? [navigator.language];

    for (const lang of browserLanguages) {
      if (!lang) {
        continue;
      }

      const matched = this.matchLanguageTag(lang);

      if (matched !== null) {
        return matched;
      }
    }

    return this.defaultLocale;
  }

  /**
   * Match a browser language tag to a supported locale.
   * All 68 locales are supported.
   *
   * @param languageTag - BCP 47 language tag (e.g., 'en-US', 'ru')
   */
  private matchLanguageTag(languageTag: string): SupportedLocale | null {
    const normalized = languageTag.toLowerCase();

    // Try exact match (e.g., 'ru')
    if (this.isLocaleSupported(normalized)) {
      return normalized as SupportedLocale;
    }

    // Try base language (e.g., 'en-US' -> 'en')
    const baseLang = normalized.split('-')[0];

    if (baseLang !== undefined && this.isLocaleSupported(baseLang)) {
      return baseLang as SupportedLocale;
    }

    return null;
  }
}
