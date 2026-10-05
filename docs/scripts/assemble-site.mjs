// Usage: node docs/scripts/assemble-site.mjs --next <next.tgz> --out <dir> [--local-dir <dir>] [--tags a,b]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildVersionsManifest, dirBytes, pruneToBudget, selectSnapshots, snapshotAssetNames } from './docs-versions.mjs';

const { values } = parseArgs({
  options: {
    next: { type: 'string' },
    out: { type: 'string' },
    'local-dir': { type: 'string' },
    tags: { type: 'string' },
  },
});
if (!values.next || !values.out) {
  console.error('Usage: assemble-site.mjs --next <next.tgz> --out <dir> [--local-dir <dir>] [--tags a,b]');
  process.exit(1);
}

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const listTags = () => {
  if (values.tags) return values.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  const json = execFileSync(
    'gh',
    ['release', 'list', '--exclude-pre-releases', '--exclude-drafts', '--limit', '200', '--json', 'tagName'],
    { encoding: 'utf8' },
  );
  return JSON.parse(json).map((release) => release.tagName);
};

const downloadDir = values['local-dir'] ? null : mkdtempSync(join(tmpdir(), 'docs-snapshots-'));

const fetchAsset = (tag, asset) => {
  if (values['local-dir']) {
    const path = resolve(values['local-dir'], tag, asset);
    if (!existsSync(path)) fail(`Missing docs snapshot ${asset} for ${tag} (looked in ${path}).`);
    return path;
  }
  const dir = join(downloadDir, tag);
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('gh', ['release', 'download', tag, '-p', asset, '-D', dir], { stdio: 'inherit' });
  } catch {
    fail(`Missing docs snapshot ${asset} for ${tag} (gh release download failed).`);
  }
  return join(dir, asset);
};

const selection = selectSnapshots(listTags());
const nextTarball = resolve(values.next);
if (!existsSync(nextTarball)) fail(`Missing next snapshot ${nextTarball}.`);

// Fetch everything before touching --out, so a missing asset leaves no half-built site.
const rootTarball = fetchAsset(selection.root.tag, snapshotAssetNames(selection.root.minor).root);
const archiveTarballs = selection.archives.map((archive) => ({
  ...archive,
  tarball: fetchAsset(archive.tag, snapshotAssetNames(archive.minor).archive),
}));

const out = resolve(values.out);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const unpack = (tarball) => execFileSync('tar', ['-xzf', tarball, '-C', out], { stdio: 'inherit' });

unpack(rootTarball);
unpack(nextTarball);
// Measured before archives land: the budget counts root + next as fixed.
const fixedBytes = dirBytes(out);

for (const { tarball } of archiveTarballs) unpack(tarball);
const kept = pruneToBudget(
  archiveTarballs.map(({ minor }) => ({ minor, bytes: dirBytes(join(out, 'v', minor)) })),
  fixedBytes,
);
for (const { minor } of archiveTarballs) {
  if (!kept.includes(minor)) rmSync(join(out, 'v', minor), { recursive: true, force: true });
}

const manifest = buildVersionsManifest({
  root: selection.root,
  archives: selection.archives.filter(({ minor }) => kept.includes(minor)),
});
writeFileSync(join(out, 'versions.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
