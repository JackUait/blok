/**
 * Public entry point for locale imports.
 * Only English is bundled by default - other locales are loaded on-demand.
 * @see README.md#localization for usage examples
 */

import type { LocaleConfig, LocaleRegistry, SupportedLocale } from './configs/i18n-config';

// ============================================================================
// Constants
// ============================================================================

/** Default locale code ('en') */
export declare const DEFAULT_LOCALE: SupportedLocale;

/** Basic preset locale codes (14 languages) */
export declare const BASIC_LOCALE_CODES: readonly SupportedLocale[];

/** Extended preset locale codes (26 languages) */
export declare const EXTENDED_LOCALE_CODES: readonly SupportedLocale[];

/** All supported locale codes (68 languages) */
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

/** Load all basic preset locales (14 languages) */
export declare const loadBasicLocales: () => Promise<LocaleRegistry>;

/** Load all extended preset locales (26 languages) */
export declare const loadExtendedLocales: () => Promise<LocaleRegistry>;

/** Load all locales (68 languages) */
export declare const loadAllLocales: () => Promise<LocaleRegistry>;

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
 * Clear the locale cache.
 * Primarily useful for testing to ensure test isolation.
 * @internal
 */
export declare const clearLocaleCache: () => void;

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale };
