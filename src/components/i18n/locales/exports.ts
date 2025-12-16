/**
 * Individual locale exports for tree-shaking support.
 * These exports derive from the main localeRegistry to avoid duplication.
 *
 * @example
 * import { enLocale, frLocale } from '@jackuait/blok/locales';
 *
 * new Blok({
 *   i18n: {
 *     locales: { en: enLocale, fr: frLocale },
 *     locale: 'auto',
 *   }
 * });
 */
import { localeRegistry } from './index';

// Export individual locales derived from the registry
export const amLocale = localeRegistry.am;
export const arLocale = localeRegistry.ar;
export const azLocale = localeRegistry.az;
export const bgLocale = localeRegistry.bg;
export const bnLocale = localeRegistry.bn;
export const bsLocale = localeRegistry.bs;
export const csLocale = localeRegistry.cs;
export const daLocale = localeRegistry.da;
export const deLocale = localeRegistry.de;
export const dvLocale = localeRegistry.dv;
export const elLocale = localeRegistry.el;
export const enLocale = localeRegistry.en;
export const esLocale = localeRegistry.es;
export const etLocale = localeRegistry.et;
export const faLocale = localeRegistry.fa;
export const fiLocale = localeRegistry.fi;
export const filLocale = localeRegistry.fil;
export const frLocale = localeRegistry.fr;
export const guLocale = localeRegistry.gu;
export const heLocale = localeRegistry.he;
export const hiLocale = localeRegistry.hi;
export const hrLocale = localeRegistry.hr;
export const huLocale = localeRegistry.hu;
export const hyLocale = localeRegistry.hy;
export const idLocale = localeRegistry.id;
export const itLocale = localeRegistry.it;
export const jaLocale = localeRegistry.ja;
export const kaLocale = localeRegistry.ka;
export const kmLocale = localeRegistry.km;
export const knLocale = localeRegistry.kn;
export const koLocale = localeRegistry.ko;
export const kuLocale = localeRegistry.ku;
export const loLocale = localeRegistry.lo;
export const ltLocale = localeRegistry.lt;
export const lvLocale = localeRegistry.lv;
export const mkLocale = localeRegistry.mk;
export const mlLocale = localeRegistry.ml;
export const mnLocale = localeRegistry.mn;
export const mrLocale = localeRegistry.mr;
export const msLocale = localeRegistry.ms;
export const myLocale = localeRegistry.my;
export const neLocale = localeRegistry.ne;
export const nlLocale = localeRegistry.nl;
export const noLocale = localeRegistry.no;
export const paLocale = localeRegistry.pa;
export const plLocale = localeRegistry.pl;
export const psLocale = localeRegistry.ps;
export const ptLocale = localeRegistry.pt;
export const roLocale = localeRegistry.ro;
export const ruLocale = localeRegistry.ru;
export const sdLocale = localeRegistry.sd;
export const siLocale = localeRegistry.si;
export const skLocale = localeRegistry.sk;
export const slLocale = localeRegistry.sl;
export const sqLocale = localeRegistry.sq;
export const srLocale = localeRegistry.sr;
export const svLocale = localeRegistry.sv;
export const swLocale = localeRegistry.sw;
export const taLocale = localeRegistry.ta;
export const teLocale = localeRegistry.te;
export const thLocale = localeRegistry.th;
export const trLocale = localeRegistry.tr;
export const ugLocale = localeRegistry.ug;
export const ukLocale = localeRegistry.uk;
export const urLocale = localeRegistry.ur;
export const viLocale = localeRegistry.vi;
export const yiLocale = localeRegistry.yi;
export const zhLocale = localeRegistry.zh;
