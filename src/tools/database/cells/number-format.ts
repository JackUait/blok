import type { NumberDisplay, NumberFormat } from '../types';

/** ISO 4217 code per currency format. Bitcoin has none and is drawn by hand. */
export const CURRENCY_CODES: Readonly<Partial<Record<NumberFormat, string>>> = {
  dollar: 'USD',
  australian_dollar: 'AUD',
  canadian_dollar: 'CAD',
  singapore_dollar: 'SGD',
  euro: 'EUR',
  pound: 'GBP',
  yen: 'JPY',
  ruble: 'RUB',
  rupee: 'INR',
  won: 'KRW',
  yuan: 'CNY',
  real: 'BRL',
  lira: 'TRY',
  rupiah: 'IDR',
  franc: 'CHF',
  hong_kong_dollar: 'HKD',
  new_zealand_dollar: 'NZD',
  krona: 'SEK',
  norwegian_krone: 'NOK',
  mexican_peso: 'MXN',
  rand: 'ZAR',
  new_taiwan_dollar: 'TWD',
  danish_krone: 'DKK',
  zloty: 'PLN',
  baht: 'THB',
  forint: 'HUF',
  koruna: 'CZK',
  shekel: 'ILS',
  chilean_peso: 'CLP',
  philippine_peso: 'PHP',
  dirham: 'AED',
  colombian_peso: 'COP',
  riyal: 'SAR',
  ringgit: 'MYR',
  leu: 'RON',
  argentine_peso: 'ARS',
  uruguayan_peso: 'UYU',
  peruvian_sol: 'PEN',
  vietnamese_dong: 'VND',
  pakistani_rupee: 'PKR',
  nigerian_naira: 'NGN',
};

/** Every format in the Notion API's order: the menu lists them in this order. */
export const NUMBER_FORMATS: readonly NumberFormat[] = [
  'number', 'number_with_commas', 'percent',
  ...(Object.keys(CURRENCY_CODES) as NumberFormat[]),
  'bitcoin',
];

/** Decimal places the menu offers. */
export const MAX_DECIMALS = 10;

const BITCOIN_DECIMALS = 8;

const fixed = (decimals: number | undefined): Intl.NumberFormatOptions =>
  typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS
    ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
    : {};

const optionsFor = (display: NumberDisplay): Intl.NumberFormatOptions | null => {
  const format = display.format ?? 'number';
  const digits = fixed(display.decimals);

  if (format === 'number') return { useGrouping: false, maximumFractionDigits: MAX_DECIMALS, ...digits };
  if (format === 'number_with_commas') return { maximumFractionDigits: MAX_DECIMALS, ...digits };
  if (format === 'percent') return { style: 'percent', maximumFractionDigits: MAX_DECIMALS, ...digits };
  if (format === 'bitcoin') return { maximumFractionDigits: BITCOIN_DECIMALS, ...digits };

  const currency = CURRENCY_CODES[format];

  return currency === undefined ? null : { style: 'currency', currency, ...digits };
};

/** A number as its property shows it. A format this build does not know shows the bare number. */
export const formatNumberValue = (value: number, display: NumberDisplay, locale: string): string => {
  const options = optionsFor(display);

  if (options === null) {
    return String(value);
  }

  try {
    const text = new Intl.NumberFormat(locale, options).format(value);

    return display.format === 'bitcoin' ? `₿${text}` : text;
  } catch {
    return String(value);
  }
};

/** How full a bar or ring is, 0 to 1. Percent divides by 1, everything else by 100, unless the property says otherwise. */
export const numberFill = (value: number, display: NumberDisplay): number => {
  const divideBy = display.divideBy ?? (display.format === 'percent' ? 1 : 100);

  if (!Number.isFinite(divideBy) || divideBy <= 0 || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value / divideBy));
};
