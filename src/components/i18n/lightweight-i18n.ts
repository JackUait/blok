import type { I18nDictionary } from '../../../types/configs/i18n-dictionary';
import enMessages from './locales/en/messages.json';

/**
 * Lightweight i18n implementation for English-only usage.
 * Provides simple string interpolation without the overhead of i18next.
 *
 * For non-English locales, the full i18next-based implementation is loaded dynamically.
 *
 * @internal
 */
export class LightweightI18n {
  /**
   * Current dictionary (defaults to English)
   */
  private dictionary: I18nDictionary;

  /**
   * Custom overrides set via setDictionary
   */
  private overrides: I18nDictionary | null = null;

  constructor() {
    this.dictionary = enMessages;
  }

  /**
   * Translate a key with optional interpolation.
   *
   * @param key - Translation key
   * @param vars - Optional variables for interpolation
   * @returns Translated string, or the key if not found
   */
  public t(key: string, vars?: Record<string, string | number>): string {
    // Check overrides first, then fall back to base dictionary
    const value = this.overrides?.[key] ?? this.dictionary[key];

    if (value === undefined) {
      return key;
    }

    if (vars === undefined) {
      return value;
    }

    // Simple interpolation: replace {varName} with value
    return value.replace(/\{(\w+)\}/g, (match, varName: string) => {
      const replacement = vars[varName];

      return replacement !== undefined ? String(replacement) : match;
    });
  }

  /**
   * Check if a translation exists
   */
  public has(key: string): boolean {
    return (this.overrides?.[key] ?? this.dictionary[key]) !== undefined;
  }

  /**
   * Add custom dictionary overrides
   */
  public setDictionary(dictionary: I18nDictionary): void {
    this.overrides = { ...this.overrides, ...dictionary };
  }

  /**
   * Get the current locale
   */
  public getLocale(): 'en' {
    return 'en';
  }

  /**
   * Get text direction (always LTR for English)
   */
  public getDirection(): 'ltr' {
    return 'ltr';
  }
}

/**
 * English dictionary for synchronous access
 */
export const englishDictionary = enMessages;
