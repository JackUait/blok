// src/tools/callout/emoji-picker/emoji-locale.ts

/**
 * Entry shape for a single emoji in a locale file.
 * `n` = translated name, `k` = translated keywords (optional).
 */
export interface EmojiLocaleEntry {
  n: string;
  k?: string[];
}

/**
 * Map from native emoji character to its locale entry.
 */
export type EmojiLocaleData = Record<string, EmojiLocaleEntry>;

/**
 * Module-level cache: locale code -> loaded data.
 */
const cache = new Map<string, EmojiLocaleData>();

/**
 * Dynamic importers for each locale JSON file.
 * Only includes locales that have generated files (65 locales — all Blok locales except dv and yi).
 */
const importers: Record<string, () => Promise<{ default: EmojiLocaleData }>> = {
  am: () => import('./locales/am.json'),
  ar: () => import('./locales/ar.json'),
  az: () => import('./locales/az.json'),
  bg: () => import('./locales/bg.json'),
  bn: () => import('./locales/bn.json'),
  bs: () => import('./locales/bs.json'),
  cs: () => import('./locales/cs.json'),
  da: () => import('./locales/da.json'),
  de: () => import('./locales/de.json'),
  el: () => import('./locales/el.json'),
  es: () => import('./locales/es.json'),
  et: () => import('./locales/et.json'),
  fa: () => import('./locales/fa.json'),
  fi: () => import('./locales/fi.json'),
  fil: () => import('./locales/fil.json'),
  fr: () => import('./locales/fr.json'),
  gu: () => import('./locales/gu.json'),
  he: () => import('./locales/he.json'),
  hi: () => import('./locales/hi.json'),
  hr: () => import('./locales/hr.json'),
  hu: () => import('./locales/hu.json'),
  hy: () => import('./locales/hy.json'),
  id: () => import('./locales/id.json'),
  it: () => import('./locales/it.json'),
  ja: () => import('./locales/ja.json'),
  ka: () => import('./locales/ka.json'),
  km: () => import('./locales/km.json'),
  kn: () => import('./locales/kn.json'),
  ko: () => import('./locales/ko.json'),
  ku: () => import('./locales/ku.json'),
  lo: () => import('./locales/lo.json'),
  lt: () => import('./locales/lt.json'),
  lv: () => import('./locales/lv.json'),
  mk: () => import('./locales/mk.json'),
  ml: () => import('./locales/ml.json'),
  mn: () => import('./locales/mn.json'),
  mr: () => import('./locales/mr.json'),
  ms: () => import('./locales/ms.json'),
  my: () => import('./locales/my.json'),
  ne: () => import('./locales/ne.json'),
  nl: () => import('./locales/nl.json'),
  no: () => import('./locales/no.json'),
  pa: () => import('./locales/pa.json'),
  pl: () => import('./locales/pl.json'),
  ps: () => import('./locales/ps.json'),
  pt: () => import('./locales/pt.json'),
  ro: () => import('./locales/ro.json'),
  ru: () => import('./locales/ru.json'),
  sd: () => import('./locales/sd.json'),
  si: () => import('./locales/si.json'),
  sk: () => import('./locales/sk.json'),
  sl: () => import('./locales/sl.json'),
  sq: () => import('./locales/sq.json'),
  sr: () => import('./locales/sr.json'),
  sv: () => import('./locales/sv.json'),
  sw: () => import('./locales/sw.json'),
  ta: () => import('./locales/ta.json'),
  te: () => import('./locales/te.json'),
  th: () => import('./locales/th.json'),
  tr: () => import('./locales/tr.json'),
  ug: () => import('./locales/ug.json'),
  uk: () => import('./locales/uk.json'),
  ur: () => import('./locales/ur.json'),
  vi: () => import('./locales/vi.json'),
  zh: () => import('./locales/zh.json'),
};

/**
 * Lazy-load and cache locale data.
 * Returns null for 'en' (no translation needed) or unsupported locales.
 */
export async function loadEmojiLocale(locale: string): Promise<EmojiLocaleData | null> {
  if (locale === 'en') {
    return null;
  }

  const cached = cache.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  const importer = importers[locale];

  if (importer === undefined) {
    return null;
  }

  try {
    const module = await importer();
    const data = module.default;

    cache.set(locale, data);

    return data;
  } catch {
    return null;
  }
}

/**
 * Look up a translated name from the cache.
 * Returns null if the locale isn't loaded or the emoji isn't in the data.
 */
export function getTranslatedName(native: string, locale: string): string | null {
  const data = cache.get(locale);

  if (data === undefined) {
    return null;
  }

  const entry = data[native];

  if (entry === undefined) {
    return null;
  }

  return entry.n;
}

/**
 * Look up translated keywords from the cache.
 * Returns null if the locale isn't loaded, the emoji isn't in the data, or no keywords exist.
 */
export function getTranslatedKeywords(native: string, locale: string): string[] | null {
  const data = cache.get(locale);

  if (data === undefined) {
    return null;
  }

  const entry = data[native];

  if (entry === undefined) {
    return null;
  }

  return entry.k ?? null;
}
