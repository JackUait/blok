import ledger from './lastmod-ledger.json';

/**
 * Route -> the fingerprint of the page's own content and the day it last
 * changed. `date` is null where no page-specific evidence exists; consumers
 * then omit the date rather than invent one.
 */
export type Ledger = Record<string, { hash: string; date: string | null }>;

/** Written by docs/scripts/update-lastmod-ledger.mjs; checked by lastmod-ledger.test.ts. */
export const LASTMOD_LEDGER = ledger as Ledger;

/** One record behind sitemap lastmod, mirror lastmod and TechArticle dateModified. */
export const lastModified = (route: string): string | undefined => LASTMOD_LEDGER[route]?.date ?? undefined;

/**
 * Carries a date forward while the page's fingerprint is unchanged, so a
 * rebuild with no content change cannot move it. Routes no longer built drop out.
 */
export const mergeLedger = (
  previous: Ledger,
  fingerprints: Record<string, string>,
  today: string,
): Ledger =>
  Object.fromEntries(
    Object.keys(fingerprints)
      .sort()
      .map((route) => {
        const hash = fingerprints[route];
        const prior = previous[route];
        return [route, prior?.hash === hash ? prior : { hash, date: today }];
      }),
  );
