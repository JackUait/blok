import ledger from './lastmod-ledger.json';
import { splitLocalePath } from './locales';

/**
 * Route -> the fingerprint of the page's own content and the day it last
 * changed. `date` is null where no page-specific evidence exists; consumers
 * then omit the date rather than invent one.
 */
export type Ledger = Record<string, { hash: string; date: string | null }>;

/** Written by docs/scripts/update-lastmod-ledger.mjs; checked by lastmod-ledger.test.ts. */
export const LASTMOD_LEDGER = ledger as Ledger;

/** The date on the newest release heading: `## [1.2.0](...) (2026-09-17)`. */
export const latestReleaseDate = (markdown: string): string | undefined =>
  /^## \[[^\]]+\]\([^)]*\) \((\d{4}-\d{2}-\d{2})\)/m.exec(markdown)?.[1];

/**
 * One record behind sitemap lastmod, mirror lastmod, TechArticle dateModified
 * and the visible "Last updated" line. Both changelog trees render
 * CHANGELOG.md, so their release date counts too; the ledger covers their chrome.
 * The release date comes in as an argument (release-lastmod.ts): importing
 * CHANGELOG.md here would preload it on every page.
 */
export const lastModified = (route: string, releaseDate?: string): string | undefined => {
  const recorded = LASTMOD_LEDGER[route]?.date ?? undefined;
  if (splitLocalePath(route).path !== '/changelog') return recorded;
  return [recorded, releaseDate].filter((date): date is string => date !== undefined).sort().at(-1);
};

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
