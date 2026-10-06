import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
 * parse5 — into an editor bundle). The one exception is `src/migrate/`, the
 * `./migrate` subpath, which no other module may import.
 */
describe('view entry law', () => {
  const sourceFiles = listTsFiles(srcDir);
  const isViewModule = (file: string): boolean => file.startsWith(`${srcDir}${sep}view${sep}`);
  const migrateDir = `${srcDir}${sep}migrate${sep}`;
  // src/migrate is its own Node-side bundle entry and may read HTML with parse5.
  // It stays out of the editor bundles only while no other module imports it.
  const isMigrateModule = (file: string): boolean => file.startsWith(migrateDir);

  /** Relative import specifiers of a file, resolved to absolute paths. */
  const relativeImports = (file: string): string[] =>
    [...readFileSync(file, 'utf-8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)]
      .map((match) => resolve(dirname(file), match[1]));

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
        !isMigrateModule(file) &&
        /from\s+['"](?:[^'"]*\/)?view(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf-8'))
    );

    expect(offenders).toEqual([]);
  });

  it('no module outside src/migrate/ imports from src/migrate/', () => {
    const offenders = sourceFiles.filter(
      (file) =>
        !isMigrateModule(file) &&
        relativeImports(file).some((target) => `${target}${sep}`.startsWith(migrateDir))
    );

    expect(sourceFiles.some(isMigrateModule)).toBe(true);
    expect(offenders).toEqual([]);
  });
});
