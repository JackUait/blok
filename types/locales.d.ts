/**
 * Public entry point for locale imports.
 * @see README.md#localization for usage examples
 */

import type { LocaleConfig, LocaleRegistry, SupportedLocale } from './configs/i18n-config';

// Individual locale exports
export declare const amLocale: LocaleConfig;
export declare const arLocale: LocaleConfig;
export declare const azLocale: LocaleConfig;
export declare const bgLocale: LocaleConfig;
export declare const bnLocale: LocaleConfig;
export declare const bsLocale: LocaleConfig;
export declare const csLocale: LocaleConfig;
export declare const daLocale: LocaleConfig;
export declare const deLocale: LocaleConfig;
export declare const dvLocale: LocaleConfig;
export declare const elLocale: LocaleConfig;
export declare const enLocale: LocaleConfig;
export declare const esLocale: LocaleConfig;
export declare const etLocale: LocaleConfig;
export declare const faLocale: LocaleConfig;
export declare const fiLocale: LocaleConfig;
export declare const filLocale: LocaleConfig;
export declare const frLocale: LocaleConfig;
export declare const guLocale: LocaleConfig;
export declare const heLocale: LocaleConfig;
export declare const hiLocale: LocaleConfig;
export declare const hrLocale: LocaleConfig;
export declare const huLocale: LocaleConfig;
export declare const hyLocale: LocaleConfig;
export declare const idLocale: LocaleConfig;
export declare const itLocale: LocaleConfig;
export declare const jaLocale: LocaleConfig;
export declare const kaLocale: LocaleConfig;
export declare const kmLocale: LocaleConfig;
export declare const knLocale: LocaleConfig;
export declare const koLocale: LocaleConfig;
export declare const kuLocale: LocaleConfig;
export declare const loLocale: LocaleConfig;
export declare const ltLocale: LocaleConfig;
export declare const lvLocale: LocaleConfig;
export declare const mkLocale: LocaleConfig;
export declare const mlLocale: LocaleConfig;
export declare const mnLocale: LocaleConfig;
export declare const mrLocale: LocaleConfig;
export declare const msLocale: LocaleConfig;
export declare const myLocale: LocaleConfig;
export declare const neLocale: LocaleConfig;
export declare const nlLocale: LocaleConfig;
export declare const noLocale: LocaleConfig;
export declare const paLocale: LocaleConfig;
export declare const plLocale: LocaleConfig;
export declare const psLocale: LocaleConfig;
export declare const ptLocale: LocaleConfig;
export declare const roLocale: LocaleConfig;
export declare const ruLocale: LocaleConfig;
export declare const sdLocale: LocaleConfig;
export declare const siLocale: LocaleConfig;
export declare const skLocale: LocaleConfig;
export declare const slLocale: LocaleConfig;
export declare const sqLocale: LocaleConfig;
export declare const srLocale: LocaleConfig;
export declare const svLocale: LocaleConfig;
export declare const swLocale: LocaleConfig;
export declare const taLocale: LocaleConfig;
export declare const teLocale: LocaleConfig;
export declare const thLocale: LocaleConfig;
export declare const trLocale: LocaleConfig;
export declare const ugLocale: LocaleConfig;
export declare const ukLocale: LocaleConfig;
export declare const urLocale: LocaleConfig;
export declare const viLocale: LocaleConfig;
export declare const yiLocale: LocaleConfig;
export declare const zhLocale: LocaleConfig;

/** All supported locales. Use for complete language coverage. */
export declare const completeLocales: LocaleRegistry;

/** Default preset: 14 most common languages. */
export declare const basicLocales: LocaleRegistry;

/** Extended preset: 26 languages (Basic + European/Asian additions). */
export declare const extendedLocales: LocaleRegistry;

// Re-export types for convenience
export type { LocaleConfig, LocaleRegistry, SupportedLocale };
