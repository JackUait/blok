import type { I18nDictionary } from '../../../../types/configs';
import type { SupportedLocale } from '../../../../types/configs/i18n-config';
import arMessages from './ar/messages.json';
import azMessages from './az/messages.json';
import bnMessages from './bn/messages.json';
import csMessages from './cs/messages.json';
import deMessages from './de/messages.json';
import dvMessages from './dv/messages.json';
import elMessages from './el/messages.json';
import enMessages from './en/messages.json';
import esMessages from './es/messages.json';
import faMessages from './fa/messages.json';
import frMessages from './fr/messages.json';
import heMessages from './he/messages.json';
import hiMessages from './hi/messages.json';
import huMessages from './hu/messages.json';
import hyMessages from './hy/messages.json';
import idMessages from './id/messages.json';
import itMessages from './it/messages.json';
import jaMessages from './ja/messages.json';
import koMessages from './ko/messages.json';
import kuMessages from './ku/messages.json';
import nlMessages from './nl/messages.json';
import plMessages from './pl/messages.json';
import psMessages from './ps/messages.json';
import ptMessages from './pt/messages.json';
import roMessages from './ro/messages.json';
import ruMessages from './ru/messages.json';
import sdMessages from './sd/messages.json';
import svMessages from './sv/messages.json';
import thMessages from './th/messages.json';
import trMessages from './tr/messages.json';
import ugMessages from './ug/messages.json';
import ukMessages from './uk/messages.json';
import urMessages from './ur/messages.json';
import viMessages from './vi/messages.json';
import yiMessages from './yi/messages.json';
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
  ar: {
    dictionary: arMessages,
    direction: 'rtl',
  },
  az: {
    dictionary: azMessages,
    direction: 'ltr',
  },
  bn: {
    dictionary: bnMessages,
    direction: 'ltr',
  },
  cs: {
    dictionary: csMessages,
    direction: 'ltr',
  },
  de: {
    dictionary: deMessages,
    direction: 'ltr',
  },
  dv: {
    dictionary: dvMessages,
    direction: 'rtl',
  },
  el: {
    dictionary: elMessages,
    direction: 'ltr',
  },
  en: {
    dictionary: enMessages,
    direction: 'ltr',
  },
  es: {
    dictionary: esMessages,
    direction: 'ltr',
  },
  fa: {
    dictionary: faMessages,
    direction: 'rtl',
  },
  fr: {
    dictionary: frMessages,
    direction: 'ltr',
  },
  he: {
    dictionary: heMessages,
    direction: 'rtl',
  },
  hi: {
    dictionary: hiMessages,
    direction: 'ltr',
  },
  hu: {
    dictionary: huMessages,
    direction: 'ltr',
  },
  hy: {
    dictionary: hyMessages,
    direction: 'ltr',
  },
  id: {
    dictionary: idMessages,
    direction: 'ltr',
  },
  it: {
    dictionary: itMessages,
    direction: 'ltr',
  },
  ja: {
    dictionary: jaMessages,
    direction: 'ltr',
  },
  ko: {
    dictionary: koMessages,
    direction: 'ltr',
  },
  ku: {
    dictionary: kuMessages,
    direction: 'rtl',
  },
  nl: {
    dictionary: nlMessages,
    direction: 'ltr',
  },
  pl: {
    dictionary: plMessages,
    direction: 'ltr',
  },
  ps: {
    dictionary: psMessages,
    direction: 'rtl',
  },
  pt: {
    dictionary: ptMessages,
    direction: 'ltr',
  },
  ro: {
    dictionary: roMessages,
    direction: 'ltr',
  },
  ru: {
    dictionary: ruMessages,
    direction: 'ltr',
  },
  sd: {
    dictionary: sdMessages,
    direction: 'rtl',
  },
  sv: {
    dictionary: svMessages,
    direction: 'ltr',
  },
  th: {
    dictionary: thMessages,
    direction: 'ltr',
  },
  tr: {
    dictionary: trMessages,
    direction: 'ltr',
  },
  ug: {
    dictionary: ugMessages,
    direction: 'rtl',
  },
  uk: {
    dictionary: ukMessages,
    direction: 'ltr',
  },
  ur: {
    dictionary: urMessages,
    direction: 'rtl',
  },
  vi: {
    dictionary: viMessages,
    direction: 'ltr',
  },
  yi: {
    dictionary: yiMessages,
    direction: 'rtl',
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
