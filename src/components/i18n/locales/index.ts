import type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../../../../types/configs/i18n-config';
import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';
import amMessages from './am/messages.json';

/**
 * RTL (right-to-left) locale codes.
 * Single source of truth for text direction.
 */
const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set([
  'ar', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi',
]);

/**
 * Build a locale config from a dictionary.
 * Direction is determined automatically from RTL_LOCALES.
 */
const buildConfig = (code: SupportedLocale, dictionary: I18nDictionary): LocaleConfig => ({
  dictionary,
  direction: RTL_LOCALES.has(code) ? 'rtl' : 'ltr',
});

/**
 * Locale codes included in the Basic preset (14 languages).
 * Most commonly used languages covering major global markets.
 */
const BASIC_LOCALE_CODES: readonly SupportedLocale[] = [
  'en', 'zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ar', 'it', 'ru', 'hi', 'hy', 'id',
] as const;

/**
 * Additional locale codes for the Extended preset (12 languages).
 * Regional European and Asian language coverage.
 */
const EXTENDED_LOCALE_ADDITIONS: readonly SupportedLocale[] = [
  'tr', 'vi', 'pl', 'nl', 'th', 'ms', 'sv', 'no', 'da', 'fi', 'el', 'cs',
] as const;

/**
 * All locale codes in the Extended preset.
 */
const EXTENDED_LOCALE_CODES: readonly SupportedLocale[] = [
  ...BASIC_LOCALE_CODES,
  ...EXTENDED_LOCALE_ADDITIONS,
];
import arMessages from './ar/messages.json';
import azMessages from './az/messages.json';
import bgMessages from './bg/messages.json';
import bnMessages from './bn/messages.json';
import bsMessages from './bs/messages.json';
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
import kaMessages from './ka/messages.json';
import kmMessages from './km/messages.json';
import knMessages from './kn/messages.json';
import koMessages from './ko/messages.json';
import kuMessages from './ku/messages.json';
import loMessages from './lo/messages.json';
import ltMessages from './lt/messages.json';
import lvMessages from './lv/messages.json';
import mkMessages from './mk/messages.json';
import mlMessages from './ml/messages.json';
import mnMessages from './mn/messages.json';
import mrMessages from './mr/messages.json';
import msMessages from './ms/messages.json';
import myMessages from './my/messages.json';
import nlMessages from './nl/messages.json';
import noMessages from './no/messages.json';
import paMessages from './pa/messages.json';
import plMessages from './pl/messages.json';
import psMessages from './ps/messages.json';
import ptMessages from './pt/messages.json';
import roMessages from './ro/messages.json';
import ruMessages from './ru/messages.json';
import neMessages from './ne/messages.json';
import sdMessages from './sd/messages.json';
import siMessages from './si/messages.json';
import skMessages from './sk/messages.json';
import slMessages from './sl/messages.json';
import sqMessages from './sq/messages.json';
import srMessages from './sr/messages.json';
import svMessages from './sv/messages.json';
import swMessages from './sw/messages.json';
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
 * Registry of all available locales with their configurations.
 * Direction is derived from RTL_LOCALES - single source of truth.
 */
export const localeRegistry = {
  am: buildConfig('am', amMessages),
  ar: buildConfig('ar', arMessages),
  az: buildConfig('az', azMessages),
  bg: buildConfig('bg', bgMessages),
  bn: buildConfig('bn', bnMessages),
  bs: buildConfig('bs', bsMessages),
  cs: buildConfig('cs', csMessages),
  da: buildConfig('da', daMessages),
  de: buildConfig('de', deMessages),
  dv: buildConfig('dv', dvMessages),
  el: buildConfig('el', elMessages),
  en: buildConfig('en', enMessages),
  es: buildConfig('es', esMessages),
  et: buildConfig('et', etMessages),
  fa: buildConfig('fa', faMessages),
  fi: buildConfig('fi', fiMessages),
  fil: buildConfig('fil', filMessages),
  fr: buildConfig('fr', frMessages),
  gu: buildConfig('gu', guMessages),
  he: buildConfig('he', heMessages),
  hi: buildConfig('hi', hiMessages),
  hr: buildConfig('hr', hrMessages),
  hu: buildConfig('hu', huMessages),
  hy: buildConfig('hy', hyMessages),
  id: buildConfig('id', idMessages),
  it: buildConfig('it', itMessages),
  ja: buildConfig('ja', jaMessages),
  ka: buildConfig('ka', kaMessages),
  km: buildConfig('km', kmMessages),
  kn: buildConfig('kn', knMessages),
  ko: buildConfig('ko', koMessages),
  ku: buildConfig('ku', kuMessages),
  lo: buildConfig('lo', loMessages),
  lt: buildConfig('lt', ltMessages),
  lv: buildConfig('lv', lvMessages),
  mk: buildConfig('mk', mkMessages),
  ml: buildConfig('ml', mlMessages),
  mn: buildConfig('mn', mnMessages),
  mr: buildConfig('mr', mrMessages),
  ms: buildConfig('ms', msMessages),
  my: buildConfig('my', myMessages),
  ne: buildConfig('ne', neMessages),
  nl: buildConfig('nl', nlMessages),
  no: buildConfig('no', noMessages),
  pa: buildConfig('pa', paMessages),
  pl: buildConfig('pl', plMessages),
  ps: buildConfig('ps', psMessages),
  pt: buildConfig('pt', ptMessages),
  ro: buildConfig('ro', roMessages),
  ru: buildConfig('ru', ruMessages),
  sd: buildConfig('sd', sdMessages),
  si: buildConfig('si', siMessages),
  sk: buildConfig('sk', skMessages),
  sl: buildConfig('sl', slMessages),
  sq: buildConfig('sq', sqMessages),
  sr: buildConfig('sr', srMessages),
  sv: buildConfig('sv', svMessages),
  sw: buildConfig('sw', swMessages),
  ta: buildConfig('ta', taMessages),
  te: buildConfig('te', teMessages),
  th: buildConfig('th', thMessages),
  tr: buildConfig('tr', trMessages),
  ug: buildConfig('ug', ugMessages),
  uk: buildConfig('uk', ukMessages),
  ur: buildConfig('ur', urMessages),
  vi: buildConfig('vi', viMessages),
  yi: buildConfig('yi', yiMessages),
  zh: buildConfig('zh', zhMessages),
} satisfies Record<SupportedLocale, LocaleConfig>;

/**
 * Default locale to use when detection fails or locale is not supported
 */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Build a locale registry from an array of locale codes.
 */
const buildRegistry = (codes: readonly SupportedLocale[]): LocaleRegistry => {
  const registry: LocaleRegistry = {};

  for (const code of codes) {
    registry[code] = localeRegistry[code];
  }

  return registry;
};

/**
 * Basic locale preset - the default for Blok.
 * Contains the most commonly used languages.
 */
export const basicLocales: LocaleRegistry = buildRegistry(BASIC_LOCALE_CODES);

/**
 * Extended locale preset.
 * Contains Basic languages plus additional European and Asian languages.
 */
export const extendedLocales: LocaleRegistry = buildRegistry(EXTENDED_LOCALE_CODES);
