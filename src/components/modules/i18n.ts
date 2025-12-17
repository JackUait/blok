import i18next from 'i18next';
import type { i18n as I18nextInstance } from 'i18next';

import Module from '../__module';
import type { I18nDictionary } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import {
  DEFAULT_LOCALE,
  loadLocale,
  getDirection,
  enLocale,
  BASIC_LOCALE_CODES,
} from '../i18n/locales';

/**
 * Virtual locale code used when custom messages are provided via config.
 * This is not a real locale - it's an i18next resource bundle name.
 */
const CUSTOM_MESSAGES_LOCALE = 'custom';

/**
 * I18n module - handles translations and locale management using i18next.
 *
 * Instance-based module that provides:
 * - Translation lookup with interpolation (via i18next)
 * - Lazy locale loading
 * - Browser locale detection
 * - RTL support
 * - Pluralization support (via i18next)
 */
export default class I18n extends Module {
  /**
   * i18next instance for this editor
   */
  private i18n: I18nextInstance;

  /**
   * Current locale code
   */
  private locale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Allowed locale codes for lazy loading.
   * If null, defaults to BASIC_LOCALE_CODES.
   */
  private allowedLocales: ReadonlySet<SupportedLocale> | null = null;

  /**
   * Default locale to fall back to
   */
  private defaultLocale: SupportedLocale = DEFAULT_LOCALE;

  /**
   * Constructor - creates a new i18next instance for this editor
   */
  constructor(...args: ConstructorParameters<typeof Module>) {
    super(...args);

    // Create a new i18next instance (not the global one) for isolation
    this.i18n = i18next.createInstance();
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
    return this.i18n.t(key, vars);
  }

  /**
   * Check if a translation exists for the given key
   *
   * @param key - Translation key to check
   * @returns True if translation exists
   */
  public has(key: string): boolean {
    return this.i18n.exists(key);
  }

  /**
   * Set the active locale, loading it if necessary.
   *
   * @param locale - Locale code to set
   * @returns Promise that resolves when locale is loaded and set
   */
  public async setLocale(locale: SupportedLocale): Promise<void> {
    const targetLocale = this.isLocaleAllowed(locale) ? locale : (() => {
      console.warn(
        `Locale "${locale}" is not allowed. Falling back to "${this.defaultLocale}". ` +
        `Allowed: ${this.getSupportedLocales().join(', ')}`
      );

      return this.defaultLocale;
    })();

    try {
      const config = await loadLocale(targetLocale);

      // Add resources to i18next if not already added
      if (!this.i18n.hasResourceBundle(targetLocale, 'translation')) {
        this.i18n.addResourceBundle(targetLocale, 'translation', config.dictionary);
      }

      await this.i18n.changeLanguage(targetLocale);
      this.locale = targetLocale;
    } catch (error) {
      // Log warning but don't throw - graceful degradation to English
      // Note: If you need to track these failures, check browser console or add custom error monitoring
      console.warn(`Failed to load locale "${locale}". Falling back to English.`, error);
      await this.i18n.changeLanguage('en');
      this.locale = 'en';
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
    // Add as a custom namespace and switch to it
    this.i18n.addResourceBundle(this.locale, 'translation', dictionary, true, true);
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
   * Get list of allowed locale codes
   */
  public getSupportedLocales(): SupportedLocale[] {
    if (this.allowedLocales !== null) {
      return [...this.allowedLocales];
    }

    return [...BASIC_LOCALE_CODES];
  }

  /**
   * Module preparation - called during editor initialization.
   * Initializes i18next and resolves locale from configuration.
   */
  public async prepare(): Promise<void> {
    const i18nConfig = this.config.i18n;

    // Set allowed locales if configured
    if (i18nConfig?.allowedLocales !== undefined) {
      this.allowedLocales = new Set(i18nConfig.allowedLocales);
    }

    // Set default locale if configured
    this.applyDefaultLocale(i18nConfig?.defaultLocale);

    // Initialize i18next with English as the fallback
    await this.i18n.init({
      lng: 'en',
      fallbackLng: this.defaultLocale,
      resources: {
        en: {
          translation: enLocale.dictionary,
        },
      },
      interpolation: {
        // Use single braces {var} to match existing format
        prefix: '{',
        suffix: '}',
        escapeValue: false, // React/DOM handles escaping
      },
      // Return key if translation is missing (consistent behavior)
      returnNull: false,
      returnEmptyString: false,
      // Don't parse keys as nested objects - we use flat keys with dots
      keySeparator: false,
      nsSeparator: false,
    });

    // Handle custom messages (highest priority)
    if (i18nConfig?.messages !== undefined) {
      this.i18n.addResourceBundle(CUSTOM_MESSAGES_LOCALE, 'translation', i18nConfig.messages, true, true);
      await this.i18n.changeLanguage(CUSTOM_MESSAGES_LOCALE);
      // Set direction from config or default to 'ltr' for custom messages
      this.updateConfigDirection(i18nConfig.direction ?? 'ltr');

      return;
    }

    const requestedLocale = i18nConfig?.locale;

    if (requestedLocale === undefined || requestedLocale === 'auto') {
      await this.detectAndSetLocale();
    } else {
      await this.setLocale(requestedLocale);
    }

    // Update config.i18n.direction so other modules can access it via isRtl getter
    this.updateConfigDirection(i18nConfig?.direction ?? this.getDirection());
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
   * Apply default locale from config if valid
   */
  private applyDefaultLocale(defaultLocale: SupportedLocale | undefined): void {
    if (defaultLocale === undefined) {
      return;
    }

    if (!this.isLocaleAllowed(defaultLocale)) {
      console.warn(
        `Default locale "${defaultLocale}" is not in allowed locales. Using "en".`
      );

      return;
    }

    this.defaultLocale = defaultLocale;
  }

  /**
   * Check if a locale is in the allowed list
   */
  private isLocaleAllowed(locale: string): locale is SupportedLocale {
    if (this.allowedLocales !== null) {
      return this.allowedLocales.has(locale as SupportedLocale);
    }

    // Default: allow basic locales
    return BASIC_LOCALE_CODES.includes(locale as SupportedLocale);
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
   * Match a browser language tag to an allowed locale
   *
   * @param languageTag - BCP 47 language tag (e.g., 'en-US', 'ru')
   */
  private matchLanguageTag(languageTag: string): SupportedLocale | null {
    const normalized = languageTag.toLowerCase();

    // Try exact match (e.g., 'ru')
    if (this.isLocaleAllowed(normalized)) {
      return normalized;
    }

    // Try base language (e.g., 'en-US' -> 'en')
    const baseLang = normalized.split('-')[0];

    if (baseLang !== undefined && this.isLocaleAllowed(baseLang)) {
      return baseLang;
    }

    return null;
  }
}
