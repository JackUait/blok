/**
 * Public entry point for locale imports.
 * Only English is bundled by default; the other 68 locale variants load on demand.
 * @see README.md#localization for usage examples
 */

import type { LocaleConfig, LocaleRegistry, SupportedLocale } from './configs/i18n-config';

// ============================================================================
// Constants
// ============================================================================

/** Default locale code ('en') */
export declare const DEFAULT_LOCALE: SupportedLocale;

/** All 69 supported locale codes, available for lazy loading */
export declare const ALL_LOCALE_CODES: readonly SupportedLocale[];

// ============================================================================
// English locale - always bundled (default/fallback)
// ============================================================================

export declare const enLocale: LocaleConfig;

// ============================================================================
// Lazy loading functions
// ============================================================================

/** Load a single locale on-demand */
export declare const loadLocale: (code: SupportedLocale) => Promise<LocaleConfig>;

/** Preload multiple locales */
export declare const preloadLocales: (codes: readonly SupportedLocale[]) => Promise<void>;

/** Build a registry from locale codes (async) */
export declare const buildRegistry: (codes: readonly SupportedLocale[]) => Promise<LocaleRegistry>;

/** Get a loaded locale synchronously (returns undefined if not loaded) */
export declare const getLocaleSync: (code: SupportedLocale) => LocaleConfig | undefined;

// ============================================================================
// Utility functions
// ============================================================================

/** Get text direction for a locale code */
export declare const getDirection: (code: SupportedLocale) => 'ltr' | 'rtl';

/**
 * Normalize an arbitrary BCP-47 language tag to a supported Blok locale.
 *
 * Accepts region-tagged (`'en-US'`, `'ru-RU'`), script-tagged (`'zh-Hant'`)
 * and aliased (`'nb'` → `'no'`, `'ckb'` → `'ku'`) tags. The same normalizer
 * runs on browser detection and on explicit `config.i18n.locale` /
 * `i18n.update({ locale })`.
 *
 * @param tag - any language tag
 * @returns the matching supported locale, or `null` when unsupported. A `null`
 *   result is the observable "unsupported locale" signal — call this to check
 *   whether a locale will be honored before applying it.
 */
export declare const normalizeLocale: (tag: string) => SupportedLocale | null;

/**
 * Clear the locale cache.
 * Primarily useful for testing to ensure test isolation.
 * @internal
 */
export declare const clearLocaleCache: () => void;

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale };
