// Pure helpers for verify-live-docs.mjs, kept apart so tests can import them
// without running its top-level checks.

const VERSIONED_PREFIXES = ['/next/', '/v/'];

/** Sitemap URLs that point into /next/ or an archive. Only the root is indexed. */
export const versionedSitemapUrls = (sitemap) =>
  [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map(([, loc]) => loc)
    .filter((loc) => VERSIONED_PREFIXES.some((prefix) => new URL(loc).pathname.startsWith(prefix)));

/** Path of the newest archived snapshot in versions.json, or null. */
export const firstArchivePath = (manifest) =>
  manifest.versions.find((version) => version.path.startsWith('/v/'))?.path ?? null;
