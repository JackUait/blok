// Blok shipped as @jackuait/blok (0.1.1 – 1.1.0) before moving to
// @bloklabs/core (1.1.1+); "every version that ever existed" is the union.
export const KNOWN_PACKAGES = ['@bloklabs/core', '@jackuait/blok'];

const parse = (version) => {
  const [core, prerelease = null] = version.split('-');
  const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return { nums, prerelease };
};

const comparePrerelease = (a, b) => {
  if (a === b) {
    return 0;
  }
  if (a === null || b === null) {
    return a === null ? 1 : -1;
  }
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const av = as[i] ?? '';
    const bv = bs[i] ?? '';
    if (av === bv) {
      continue;
    }
    const an = Number.parseInt(av, 10);
    const bn = Number.parseInt(bv, 10);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return an - bn;
    }
    return av < bv ? -1 : 1;
  }
  return 0;
};

export function compareSemverDesc(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pb.nums[i] ?? 0) - (pa.nums[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return comparePrerelease(pb.prerelease, pa.prerelease);
}

export function mergeVersionCatalog(byPackage) {
  const entries = [];
  for (const pkg of KNOWN_PACKAGES) {
    for (const version of byPackage[pkg] ?? []) {
      entries.push({ pkg, version });
    }
  }
  return entries.sort((a, b) => compareSemverDesc(a.version, b.version));
}

export function cdnPrefixFor(pkg, version) {
  return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/dist/`;
}

export function formatAgo(iso, nowMs) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes = Math.round((nowMs - then) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (minutes < 24 * 60) {
    return `${Math.round(minutes / 60)}h ago`;
  }
  return `${Math.round(minutes / (24 * 60))}d ago`;
}

export function shouldRefreshCatalog(cache, nowMs, ttlMs) {
  return !cache || nowMs - cache.fetchedAt > ttlMs;
}
