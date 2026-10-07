// Usage (from repo root, after the library `yarn build`):
//   node docs/scripts/build-snapshot.mjs --version <id> --base <base> --out <file.tgz> [--root-pages <pages.json>]
// --root-pages is the stable root's route list (assemble-site.mjs --root-pages writes it).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { injectNoindex, listPages, relocateBuild, snapshotBuildEnv } from './docs-versions.mjs';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    base: { type: 'string' },
    out: { type: 'string' },
    'root-pages': { type: 'string' },
  },
});
if (!values.version || !values.base || !values.out) {
  console.error('Usage: build-snapshot.mjs --version <id> --base <base> --out <file.tgz>');
  process.exit(1);
}

const { version, base } = values;
const buildEnv = snapshotBuildEnv({
  base,
  version,
  rootPages: values['root-pages'] && readFileSync(resolve(values['root-pages']), 'utf8'),
});
const out = resolve(values.out);
const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = join(docsDir, 'dist', 'client');
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: docsDir,
    stdio: 'inherit',
    env: { ...process.env, ...buildEnv },
  });

// A stale dist would leak the previous snapshot's tree into this tarball.
rmSync(join(docsDir, 'dist'), { recursive: true, force: true });

if (base === '/') {
  // The full build: also writes 404.html, sitemap and llms files. Only the root is indexed.
  run('yarn', ['build']);
} else {
  run('npx', ['tsc']);
  run('npx', ['react-router', 'build']);
}

relocateBuild(clientDir, base);
const baseDir = join(clientDir, ...base.split('/').filter(Boolean));

if (base !== '/') {
  const marked = injectNoindex(baseDir);
  // 0 means the head markup changed and the snapshot would be indexed as a duplicate.
  if (marked === 0) {
    console.error(`injectNoindex marked 0 pages under ${baseDir}; refusing to ship an indexable snapshot.`);
    process.exit(1);
  }
  console.log(`noindex added to ${marked} pages`);
}

const pages = listPages(baseDir);
writeFileSync(join(baseDir, 'pages.json'), `${JSON.stringify(pages)}\n`);
console.log(`pages.json lists ${pages.length} pages`);

mkdirSync(dirname(out), { recursive: true });
// COPYFILE_DISABLE stops macOS tar from adding ._ AppleDouble entries.
execFileSync('tar', ['-czf', out, '-C', clientDir, '.'], {
  stdio: 'inherit',
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
console.log(`wrote ${out}`);
