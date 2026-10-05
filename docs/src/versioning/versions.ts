// Copied verbatim into old tags by apply-versioning-overlay.mjs. Import only
// react, react-router, lucide-react and @/lib/utils from this folder.

export interface DocsVersion {
  id: string;
  label: string;
  /** Site-absolute, with a trailing slash: `/`, `/next/`, `/v/1.14/`. */
  path: string;
}

export interface VersionsManifest {
  latest: string;
  versions: DocsVersion[];
}

/** Served from the site root by every version, so old snapshots see new entries. */
export const VERSIONS_URL = '/versions.json';

export const currentVersionId = (): string => import.meta.env.VITE_DOCS_VERSION || 'next';

// The path becomes an href and a fetch URL. An allow-list, because URL parsing
// treats "\" as "/" and drops tabs and newlines, so "/\evil.com/" leaves the site.
const SITE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*$/;

const isSitePath = (path: unknown): path is string => typeof path === 'string' && SITE_PATH.test(path);

const isVersion = (value: unknown): value is DocsVersion => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.label === 'string' && isSitePath(record.path);
};

export const parseVersionsManifest = (json: unknown): VersionsManifest | null => {
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  if (typeof record.latest !== 'string' || !Array.isArray(record.versions)) return null;
  if (!record.versions.every(isVersion)) return null;
  return { latest: record.latest, versions: record.versions };
};

const trimSlash = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

const localeHome = (routerPath: string): string => (routerPath === '/ru' || routerPath.startsWith('/ru/') ? '/ru' : '/');

export const versionHref = (
  target: DocsVersion,
  routerPath: string,
  targetPages: readonly string[] | null,
): string => {
  const path = trimSlash(routerPath) || '/';
  const exists = targetPages === null || targetPages.includes(path);
  const page = exists ? path : localeHome(path);
  return page === '/' ? target.path : `${target.path}${page.slice(1)}/`;
};
