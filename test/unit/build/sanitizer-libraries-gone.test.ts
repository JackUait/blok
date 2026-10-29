import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lockfile = readFileSync(resolve(ROOT, 'yarn.lock'), 'utf8');

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);

  return statSync(path).isDirectory() ? sourceFiles(path) : [ path ];
});

// Blok cleans HTML with src/components/utils/html-cleaner.ts and src/markdown/sanitize-html.ts.
describe('html-janitor and DOMPurify are gone', () => {
  it.each([ 'html-janitor', 'dompurify' ])('declares no %s dependency', (name) => {
    expect(manifest.dependencies?.[name]).toBeUndefined();
    expect(manifest.devDependencies?.[name]).toBeUndefined();
  });

  it('locks no html-janitor, and dompurify only for mermaid', () => {
    expect(lockfile).not.toContain('"html-janitor@');
    expect(lockfile).not.toContain('dompurify@npm:^3.4.17');
  });

  it('imports neither library from src', () => {
    const importers = sourceFiles(resolve(ROOT, 'src'))
      .filter((path) => /\.(ts|tsx|js|mjs|vue)$/.test(path))
      .filter((path) => /(from|import\()\s*['"](html-janitor|dompurify)['"]/.test(readFileSync(path, 'utf8')));

    expect(importers).toEqual([]);
    expect(existsSync(resolve(ROOT, 'src/types-internal/html-janitor.d.ts'))).toBe(false);
  });
});
