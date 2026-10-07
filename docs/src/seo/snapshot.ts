// docs/src/seo/snapshot.ts
import { SITE_URL } from './locales';

/**
 * A `/next/` or `/v/<minor>/` build. Its pages are noindex copies of another
 * version, and any URL its head names is a ROOT URL.
 */
export interface SnapshotContext {
  isSnapshot: boolean;
  /** The stable root's routes, slashless as its `pages.json` lists them. */
  rootRoutes: ReadonlySet<string>;
}

/** Bad or missing input yields no routes: no twin is better than a 404 twin. */
export const parseRootRoutes = (json: string | undefined): Set<string> => {
  if (!json) return new Set();
  try {
    const parsed: unknown = JSON.parse(json);
    return new Set(Array.isArray(parsed) ? parsed.filter((route): route is string => typeof route === 'string') : []);
  } catch {
    return new Set();
  }
};

/**
 * Read at build time, so prerender and the client bundle agree; React re-adds
 * any head `<link>` that post-processing removed. `VITE_DOCS_ROOT_ROUTES` is
 * set by `scripts/build-snapshot.mjs --root-pages`; archives get none, since a
 * later root may drop their routes.
 */
export const SNAPSHOT_CONTEXT: SnapshotContext = {
  isSnapshot: import.meta.env.BASE_URL !== '/',
  rootRoutes: parseRootRoutes(import.meta.env.VITE_DOCS_ROOT_ROUTES),
};

/** Whether an absolute root URL names a route the stable root ships. */
export const rootHasUrl = (url: string, context: SnapshotContext): boolean => {
  if (!url.startsWith(`${SITE_URL}/`)) return false;
  const path = url.slice(SITE_URL.length);
  const route = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return context.rootRoutes.has(route);
};
