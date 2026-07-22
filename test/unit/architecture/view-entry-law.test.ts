import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../');
const srcDir = resolve(repoRoot, 'src');

/** Recursively list every .ts source file under a directory. */
function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      return listTsFiles(full);
    }

    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * LAW: parse5 is a bundled dependency of the `./view` subpath ONLY.
 *
 * The editor bundles (blok/full/tools/iife/umd) must never pay its weight, and
 * the view graph must stay DOM-free (see test/unit/view/index.purity.test.ts
 * for the runtime half of this contract). Enforced statically: no module
 * outside `src/view/` may import parse5, and no module outside `src/view/`
 * may import from `src/view/` (which would splice the view graph — and
 * parse5 — into an editor bundle).
 */
describe('view entry law', () => {
  const sourceFiles = listTsFiles(srcDir);
  const isViewModule = (file: string): boolean => file.startsWith(`${srcDir}${sep}view${sep}`);

  it('scans a non-trivial source tree (non-vacuity floor)', () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(sourceFiles.some(isViewModule)).toBe(true);
  });

  it('only src/view/ imports parse5', () => {
    const offenders = sourceFiles.filter(
      (file) => !isViewModule(file) && /from\s+['"]parse5['"]/.test(readFileSync(file, 'utf-8'))
    );

    expect(offenders).toEqual([]);
  });

  it('no module outside src/view/ imports from src/view/', () => {
    const offenders = sourceFiles.filter(
      (file) =>
        !isViewModule(file) &&
        /from\s+['"](?:[^'"]*\/)?view(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf-8'))
    );

    expect(offenders).toEqual([]);
  });
});
