import type { I18nDictionary } from '../../../types/configs';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import { Module } from '../__module';
import { I18nChanged } from '../events';
import type { I18nextInitResult } from '../i18n/i18next-loader';
import { LightweightI18n } from '../i18n/lightweight-i18n';
import { repaintBlocks } from '../utils/repaint-blocks';
import {
  DEFAULT_LOCALE,
  loadLocale,
  getDirection,
  normalizeLocale,
  enMessages,
} from '../i18n/locales';

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
   * Host message overrides accumulated from `config.i18n.messages` and every
   * `update({ messages })` call.
   *
   * Retained because the overrides live *inside* whichever implementation was
   * active when they were set: `setDictionary` writes them either to the
   * lightweight instance or to the i18next resource bundle of the language
   * that was current at the time. Switching locale switches (or re-targets)
   * the implementation, so the overrides have to be replayed onto the new one
   * — otherwise a bare locale flip silently drops the host's custom strings.
   */
  private customMessages: I18nDictionary | null = null;

  /**
   * Serializes `update()` calls.
   *
   * Locale chunks are fetched lazily, so two overlapping updates would race
   * and the slower (earlier) fetch could land last. Chaining makes the last
   * call the winner, which is what a language switcher means.
   */
  private applyChain: Promise<void> = Promise.resolve();

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
   * All 69 supported locales are available for loading.
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
        // Copied for the same reason as in the loader: the locale cache is a
        // module-level singleton and setDictionary mutates the live bundle.
        this.i18nextWrapper.instance.addResourceBundle(locale, 'translation', { ...localeConfig.dictionary });
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
    this.customMessages = { ...this.customMessages, ...dictionary };

    if (this.usingI18next && this.i18nextWrapper !== null) {
      this.i18nextWrapper.setDictionary(dictionary);
    } else {
      this.lightweightI18n.setDictionary(dictionary);
    }
  }

  /**
   * Applies a new locale and/or message overrides in place (the runtime half
   * of `config.i18n`, reachable as `blok.i18n.update()`).
   *
   * Exposed as a single mutator rather than separate `setLocale`/
   * `setDictionary` entry points on purpose: those two must run in that order,
   * because switching locale switches the implementation that owns the host's
   * overrides. Exporting them separately would export that ordering trap.
   *
   * @param options - locale, message overrides and/or explicit direction
   * @returns promise resolving once the locale chunk is loaded and applied
   */
  public update(options: {
    locale?: string;
    messages?: I18nDictionary;
    direction?: 'ltr' | 'rtl';
  }): Promise<void> {
    const run = (): Promise<void> => this.applyUpdate(options);

    /*
     * Chain on both settlement paths so one rejected update cannot wedge the
     * queue for every later call.
     */
    this.applyChain = this.applyChain.then(run, run);

    return this.applyChain;
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
      const normalized = normalizeLocale(requestedLocale);

      if (normalized === null) {
        console.warn(
          `Unsupported locale "${requestedLocale}" in config.i18n.locale. Falling back to "${this.defaultLocale}".`
        );
        await this.setLocale(this.defaultLocale);
      } else {
        await this.setLocale(normalized);
      }
    }

    // Merge custom messages on top of base translations (if provided)
    if (i18nConfig?.messages !== undefined) {
      this.setDictionary(i18nConfig.messages);
    }

    // Update config.i18n.direction so other modules can access it via isRtl getter
    this.updateConfigDirection(i18nConfig?.direction ?? this.getDirection());
  }

  /**
   * One serialized `update()` step.
   * @param options - locale, message overrides and/or explicit direction
   */
  private async applyUpdate(options: {
    locale?: string;
    messages?: I18nDictionary;
    direction?: 'ltr' | 'rtl';
  }): Promise<void> {
    const { locale, messages, direction } = options;
    const localeChanged = locale === undefined
      ? false
      : await this.applyRequestedLocale(locale);

    if (messages !== undefined) {
      this.setDictionary(messages);
    }

    if (!localeChanged && direction === undefined && messages === undefined) {
      return;
    }

    if (localeChanged || direction !== undefined) {
      this.applyDirection(direction ?? this.getDirection());
    }

    this.Blok.Toolbar?.refreshI18n();

    /*
     * Chrome relabels itself; block content cannot. Tools resolve
     * `api.i18n.t(...)` while rendering and write the string into their own
     * DOM, so the strings only follow the locale if the blocks render again.
     * Repainting from data covers every tool — including ones that know
     * nothing about locale changes — which is why this is not a per-tool hook.
     */
    if (localeChanged || messages !== undefined) {
      await repaintBlocks(this.Blok);
    }

    this.eventsDispatcher.emit(I18nChanged, {
      locale: this.locale,
      direction: this.config.i18n?.direction ?? this.getDirection(),
    });
  }

  /**
   * Resolves and applies a requested locale, replaying the host's retained
   * message overrides onto whichever implementation now serves `t()`.
   *
   * @param locale - locale code, or 'auto' to re-run browser detection
   * @returns true when the active locale actually changed
   */
  private async applyRequestedLocale(locale: string): Promise<boolean> {
    const previous = this.locale;

    if (locale === 'auto') {
      await this.detectAndSetLocale();
    } else {
      const normalized = normalizeLocale(locale);

      if (normalized === null) {
        console.warn(`Unsupported locale "${locale}" passed to i18n.update(). Keeping "${previous}".`);

        return false;
      }

      await this.setLocale(normalized);
    }

    if (this.customMessages !== null) {
      this.setDictionary(this.customMessages);
    }

    return this.locale !== previous;
  }

  /**
   * Writes the direction into the shared config (read live by the `isRtl`
   * getter) and re-stamps the wrapper, so an LTR↔RTL locale flip lands on an
   * already-mounted editor instead of only on a freshly built one.
   *
   * @param direction - direction to apply
   */
  private applyDirection(direction: 'ltr' | 'rtl'): void {
    this.updateConfigDirection(direction);
    this.Blok.UI?.setDirection(direction);
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
   * Normalized through the shared BCP-47 normalizer so a region-tagged or
   * aliased default (`'en-US'`, `'nb'`) resolves instead of being stored raw.
   */
  private applyDefaultLocale(defaultLocale: string | undefined): void {
    if (defaultLocale === undefined) {
      return;
    }

    const normalized = normalizeLocale(defaultLocale);

    if (normalized === null) {
      console.warn(`Unsupported defaultLocale "${defaultLocale}". Keeping "${this.defaultLocale}".`);

      return;
    }

    this.defaultLocale = normalized;
  }

  /**
   * Detect best matching locale from browser settings, using the shared
   * normalizer so detection and explicit paths agree.
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

      const matched = normalizeLocale(lang);

      if (matched !== null) {
        return matched;
      }
    }

    return this.defaultLocale;
  }
}
