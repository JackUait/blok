// Shared by harvest.mjs, record.mjs and audit.mjs.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(FIXTURE_DIR, '../../..');
export const README_BASE = 'https://github.com/owner/repo/blob/main/README.md';

export const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

export const readGz = (file) => JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));

/** One row per line, so a diff of the unzipped file reads case by case. */
export const writeGz = (file, head, rows) => {
  const body = `{\n"meta": ${JSON.stringify(head)},\n"cases": [\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n}\n`;

  writeFileSync(file, gzipSync(body, { level: 9 }));
};

/** jsdom globals must exist before the bundle loads: DOMPurify binds to `window` when its module runs. */
export const installDom = () => {
  const { JSDOM } = requireFromRoot('jsdom');
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');

  for (const key of ['window', 'document', 'Document', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'NodeFilter', 'navigator']) {
    Object.defineProperty(globalThis, key, { value: window[key === 'window' ? 'self' : key], configurable: true, writable: true });
  }

  return window;
};

/**
 * Bundle with the repo's esbuild into a temp CJS file and load it.
 * @param source - TS source of the entry; imports resolve from the repo root
 */
export const bundle = async (source, plugins = []) => {
  const esbuild = requireFromRoot('esbuild');
  const outfile = path.join(mkdtempSync(path.join(tmpdir(), 'md-sanitize-')), 'bundle.cjs');

  await esbuild.build({
    stdin: { contents: source, resolveDir: ROOT, loader: 'ts', sourcefile: 'entry.ts' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    logLevel: 'error',
    plugins,
  });

  return createRequire(outfile)(outfile);
};
