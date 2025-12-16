import type { I18nDictionary } from '../../../../types/configs';
import type { SupportedLocale } from '../../../../types/configs/i18n-config';
import enMessages from './en/messages.json';
import esMessages from './es/messages.json';
import frMessages from './fr/messages.json';
import hyMessages from './hy/messages.json';
import ruMessages from './ru/messages.json';
import zhMessages from './zh/messages.json';

/**
 * Configuration for a locale including its dictionary and text direction
 */
interface LocaleConfig {
  dictionary: I18nDictionary;
  direction: 'ltr' | 'rtl';
}

/**
 * Registry of all available locales with their configurations
 */
export const localeRegistry: Record<SupportedLocale, LocaleConfig> = {
  en: {
    dictionary: enMessages,
    direction: 'ltr',
  },
  es: {
    dictionary: esMessages,
    direction: 'ltr',
  },
  fr: {
    dictionary: frMessages,
    direction: 'ltr',
  },
  hy: {
    dictionary: hyMessages,
    direction: 'ltr',
  },
  ru: {
    dictionary: ruMessages,
    direction: 'ltr',
  },
  zh: {
    dictionary: zhMessages,
    direction: 'ltr',
  },
};

/**
 * Default locale to use when detection fails or locale is not supported
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * List of all supported locale codes
 */
export const supportedLocales: SupportedLocale[] = Object.keys(localeRegistry) as SupportedLocale[];

/**
 * Check if a locale code is supported
 * @param locale - Locale code to check
 * @returns True if the locale is supported
 */
export const isLocaleSupported = (locale: string): locale is SupportedLocale => {
  return supportedLocales.includes(locale as SupportedLocale);
};

/**
 * Get locale config by locale code
 * @param locale - Locale code
 * @returns Locale config or undefined if not found
 */
export const getLocaleConfig = (locale: SupportedLocale): LocaleConfig => {
  return localeRegistry[locale];
};
