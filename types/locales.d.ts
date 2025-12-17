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

/** Set of RTL locale codes */
export declare const RTL_LOCALES: ReadonlySet<SupportedLocale>;

/** Basic preset locale codes (14 languages) */
export declare const BASIC_LOCALE_CODES: readonly SupportedLocale[];

/** Extended preset locale codes (26 languages) */
export declare const EXTENDED_LOCALE_CODES: readonly SupportedLocale[];

/** Additional codes in extended preset beyond basic */
export declare const EXTENDED_LOCALE_ADDITIONS: readonly SupportedLocale[];

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

/** Check if a locale is loaded */
export declare const isLocaleLoaded: (code: SupportedLocale) => boolean;

// ============================================================================
// Utility functions
// ============================================================================

/** Get text direction for a locale code */
export declare const getDirection: (code: SupportedLocale) => 'ltr' | 'rtl';

/** Build a locale config from a dictionary */
export declare const buildConfig: (code: SupportedLocale, dictionary: Record<string, string>) => LocaleConfig;

// ============================================================================
// Re-export types
// ============================================================================

export type { LocaleConfig, LocaleRegistry, SupportedLocale };
