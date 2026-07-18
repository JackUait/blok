/**
 * JSON default-import law.
 *
 * The build pipeline rewrites every imported JSON module to
 * `export default JSON.parse("…")` via scripts/vite-plugin-json-as-string.mjs
 * (dist-weight fix: giant JSON object literals OOMed consumer CI builds).
 * The plugin emits a DEFAULT EXPORT ONLY and runs in the dev server too, so a
 * named import from a .json module (`import { version } from './package.json'`)
 * throws "does not provide an export named …" the moment the page loads.
 *
 * Regression: index.html:944 used `import { version } from './package.json'`
 * and the dev playground crashed on load after the plugin landed.
 *
 * Every JSON consumer transformed by vite (src/ and the playground index.html)
 * must use a default import (or `.default` on a dynamic import).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.html']);

/** `import { a, b } from './x.json'` — named imports from a JSON module. */
const NAMED_JSON_IMPORT = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+\.json(?:\?[^'"]*)?['"]/g;

const listFiles = (dir: string): string[] => {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      return listFiles(full);
    }

    return SCANNED_EXTENSIONS.has(extname(full)) ? [full] : [];
  });
};

describe('JSON default-import law (vite json-as-string plugin emits default export only)', () => {
  it('no named imports from .json modules in vite-transformed entry points', () => {
    const files = [
      join(REPO_ROOT, 'index.html'),
      ...listFiles(join(REPO_ROOT, 'src')),
    ];

    const violations = files.flatMap(file => {
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(NAMED_JSON_IMPORT) ?? [];

      return matches.map(m => `${relative(REPO_ROOT, file)}: ${m.trim()}`);
    });

    expect(violations, 'named JSON imports break under the json-as-string plugin — use a default import').toEqual([]);
  });
});
