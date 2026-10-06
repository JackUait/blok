import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/;

const compareMinor = (a, b) => {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return bMajor - aMajor || bMinor - aMinor;
};

export const selectSnapshots = (tags, { oldest = '1.7' } = {}) => {
  const newestPerMinor = new Map();
  for (const tag of tags) {
    const match = STABLE.exec(tag);
    if (!match) continue;
    const minor = `${match[1]}.${match[2]}`;
    const patch = Number(match[3]);
    const seen = newestPerMinor.get(minor);
    if (!seen || patch > seen.patch) newestPerMinor.set(minor, { tag, minor, patch });
  }
  const minors = [...newestPerMinor.keys()].filter((minor) => compareMinor(minor, oldest) <= 0).sort(compareMinor);
  if (minors.length === 0) throw new Error('No stable release tag found; cannot pick the root docs version.');
  const pick = (minor) => ({ tag: newestPerMinor.get(minor).tag, minor });
  return { root: pick(minors[0]), archives: minors.slice(1).map(pick) };
};

export const buildVersionsManifest = ({ root, archives }) => ({
  latest: root.minor,
  versions: [
    { id: 'next', label: 'Next', path: '/next/' },
    { id: root.minor, label: root.minor, path: '/' },
    ...archives.map(({ minor }) => ({ id: minor, label: minor, path: `/v/${minor}/` })),
  ],
});

// An archive is unpacked over the site root, so any entry outside ./v/<minor>/
// would overwrite root files.
export const archiveEntriesConfined = (entries, minor) => {
  const own = `./v/${minor}/`;
  const allowedDirs = new Set(['./', './v/', own]);
  return entries.every((entry) => {
    if (entry.split('/').includes('..')) return false;
    const path = entry.endsWith('/') ? entry : `${entry}/`;
    return allowedDirs.has(path) || entry.startsWith(own);
  });
};

export const snapshotAssetNames = (minor) => ({ root: 'docs-root.tgz', archive: `docs-v${minor}.tgz` });

// React Router writes prerendered HTML under the base, but assets and public/
// files at the build root while referencing them as `<base>assets/...`.
export const relocateBuild = (clientDir, base) => {
  if (base === '/') return;
  const segments = base.split('/').filter(Boolean);
  const target = join(clientDir, ...segments);
  mkdirSync(target, { recursive: true });
  // The root index.html is the SPA fallback for `/`, which this snapshot does not own.
  rmSync(join(clientDir, 'index.html'), { force: true });
  for (const entry of readdirSync(clientDir)) {
    if (entry === segments[0]) continue;
    renameSync(join(clientDir, entry), join(target, entry));
  }
};

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

export const listPages = (snapshotDir) =>
  walk(snapshotDir)
    .filter((path) => path.endsWith(`${sep}index.html`) || path === join(snapshotDir, 'index.html'))
    .map((path) => `/${relative(snapshotDir, path).split(sep).slice(0, -1).join('/')}`)
    .filter((path) => path !== '/404')
    .sort();

const NOINDEX = '<meta name="robots" content="noindex, follow">';

export const injectNoindex = (snapshotDir) => {
  let changed = 0;
  for (const path of walk(snapshotDir)) {
    if (!path.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    if (html.includes(NOINDEX) || !html.includes('<head>')) continue;
    writeFileSync(path, html.replace('<head>', `<head>${NOINDEX}`));
    changed += 1;
  }
  return changed;
};

export const pruneToBudget = (entries, fixedBytes, budget = 900 * 1024 ** 2) => {
  const kept = [...entries];
  const total = () => fixedBytes + kept.reduce((sum, entry) => sum + entry.bytes, 0);
  while (kept.length > 0 && total() > budget) kept.pop();
  return kept.map((entry) => entry.minor);
};

export const dirBytes = (dir) => (existsSync(dir) ? walk(dir).reduce((sum, path) => sum + statSync(path).size, 0) : 0);
