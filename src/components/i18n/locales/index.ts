import type { I18nDictionary } from '../../../../types/configs';
import type { SupportedLocale } from '../../../../types/configs/i18n-config';
import arMessages from './ar/messages.json';
import azMessages from './az/messages.json';
import bgMessages from './bg/messages.json';
import bnMessages from './bn/messages.json';
import csMessages from './cs/messages.json';
import daMessages from './da/messages.json';
import deMessages from './de/messages.json';
import dvMessages from './dv/messages.json';
import elMessages from './el/messages.json';
import enMessages from './en/messages.json';
import esMessages from './es/messages.json';
import etMessages from './et/messages.json';
import faMessages from './fa/messages.json';
import fiMessages from './fi/messages.json';
import filMessages from './fil/messages.json';
import frMessages from './fr/messages.json';
import guMessages from './gu/messages.json';
import heMessages from './he/messages.json';
import hiMessages from './hi/messages.json';
import hrMessages from './hr/messages.json';
import huMessages from './hu/messages.json';
import hyMessages from './hy/messages.json';
import idMessages from './id/messages.json';
import itMessages from './it/messages.json';
import jaMessages from './ja/messages.json';
import knMessages from './kn/messages.json';
import koMessages from './ko/messages.json';
import kuMessages from './ku/messages.json';
import ltMessages from './lt/messages.json';
import lvMessages from './lv/messages.json';
import mlMessages from './ml/messages.json';
import mrMessages from './mr/messages.json';
import msMessages from './ms/messages.json';
import nlMessages from './nl/messages.json';
import noMessages from './no/messages.json';
import paMessages from './pa/messages.json';
import plMessages from './pl/messages.json';
import psMessages from './ps/messages.json';
import ptMessages from './pt/messages.json';
import roMessages from './ro/messages.json';
import ruMessages from './ru/messages.json';
import sdMessages from './sd/messages.json';
import skMessages from './sk/messages.json';
import slMessages from './sl/messages.json';
import srMessages from './sr/messages.json';
import svMessages from './sv/messages.json';
import taMessages from './ta/messages.json';
import teMessages from './te/messages.json';
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
  bg: {
    dictionary: bgMessages,
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
  da: {
    dictionary: daMessages,
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
  et: {
    dictionary: etMessages,
    direction: 'ltr',
  },
  fa: {
    dictionary: faMessages,
    direction: 'rtl',
  },
  fi: {
    dictionary: fiMessages,
    direction: 'ltr',
  },
  fil: {
    dictionary: filMessages,
    direction: 'ltr',
  },
  fr: {
    dictionary: frMessages,
    direction: 'ltr',
  },
  gu: {
    dictionary: guMessages,
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
  hr: {
    dictionary: hrMessages,
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
  kn: {
    dictionary: knMessages,
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
  lt: {
    dictionary: ltMessages,
    direction: 'ltr',
  },
  lv: {
    dictionary: lvMessages,
    direction: 'ltr',
  },
  ml: {
    dictionary: mlMessages,
    direction: 'ltr',
  },
  mr: {
    dictionary: mrMessages,
    direction: 'ltr',
  },
  ms: {
    dictionary: msMessages,
    direction: 'ltr',
  },
  nl: {
    dictionary: nlMessages,
    direction: 'ltr',
  },
  no: {
    dictionary: noMessages,
    direction: 'ltr',
  },
  pa: {
    dictionary: paMessages,
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
  sk: {
    dictionary: skMessages,
    direction: 'ltr',
  },
  sl: {
    dictionary: slMessages,
    direction: 'ltr',
  },
  sr: {
    dictionary: srMessages,
    direction: 'ltr',
  },
  sv: {
    dictionary: svMessages,
    direction: 'ltr',
  },
  ta: {
    dictionary: taMessages,
    direction: 'ltr',
  },
  te: {
    dictionary: teMessages,
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
