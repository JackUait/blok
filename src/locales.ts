/**
 * Public entry point for locale imports with tree-shaking support.
 *
 * @example
 * // Import only the locales you need
 * import { enLocale, frLocale, deLocale } from '@jackuait/blok/locales';
 *
 * new Blok({
 *   i18n: {
 *     locales: { en: enLocale, fr: frLocale, de: deLocale },
 *     locale: 'auto',
 *   }
 * });
 *
 * @example
 * // Import all locales (no tree-shaking benefit)
 * import { allLocales } from '@jackuait/blok/locales';
 *
 * new Blok({
 *   i18n: {
 *     locales: allLocales,
 *     locale: 'auto',
 *   }
 * });
 */

// Re-export individual locales for tree-shaking
export {
  amLocale,
  arLocale,
  azLocale,
  bgLocale,
  bnLocale,
  bsLocale,
  csLocale,
  daLocale,
  deLocale,
  dvLocale,
  elLocale,
  enLocale,
  esLocale,
  etLocale,
  faLocale,
  fiLocale,
  filLocale,
  frLocale,
  guLocale,
  heLocale,
  hiLocale,
  hrLocale,
  huLocale,
  hyLocale,
  idLocale,
  itLocale,
  jaLocale,
  kaLocale,
  kmLocale,
  knLocale,
  koLocale,
  kuLocale,
  loLocale,
  ltLocale,
  lvLocale,
  mkLocale,
  mlLocale,
  mnLocale,
  mrLocale,
  msLocale,
  myLocale,
  neLocale,
  nlLocale,
  noLocale,
  paLocale,
  plLocale,
  psLocale,
  ptLocale,
  roLocale,
  ruLocale,
  sdLocale,
  siLocale,
  skLocale,
  slLocale,
  sqLocale,
  srLocale,
  svLocale,
  swLocale,
  taLocale,
  teLocale,
  thLocale,
  trLocale,
  ugLocale,
  ukLocale,
  urLocale,
  viLocale,
  yiLocale,
  zhLocale,
} from './components/i18n/locales/exports';

// Export the full registry for backwards compatibility (no tree-shaking)
export { localeRegistry as allLocales } from './components/i18n/locales';

// Re-export types
export type { LocaleConfig, LocaleRegistry, SupportedLocale } from '../types/configs/i18n-config';
