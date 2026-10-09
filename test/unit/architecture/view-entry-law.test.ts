import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(__dirname, '../../../');
const srcDir = resolve(repoRoot, 'src');

export const entryOffenders = (files: Array<{ path: string; text: string }>, src: string): string[] => {
  const inside = (file: string, dir: string): boolean => file.startsWith(`${src}${sep}${dir}${sep}`);
  const importsDir = (file: { path: string; text: string }, dir: string): boolean =>
    [...file.text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)]
      .some((match) => {
        const specifier = match[1];

        return specifier !== undefined && `${resolve(dirname(file.path), specifier)}${sep}`.startsWith(`${src}${sep}${dir}${sep}`);
      });

  return files.filter(file =>
    (!inside(file.path, 'view') && !inside(file.path, 'migrate') && !inside(file.path, 'mcp') &&
      (/from\s+['"](?:[^'"]*\/)?view(?:\/[^'"]*)?['"]/.test(file.text) || importsDir(file, 'view'))) ||
    (!inside(file.path, 'mcp') && importsDir(file, 'mcp'))).map(file => file.path);
};

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
 * parse5 — into an editor bundle). The exceptions are `src/migrate/` and
 * `src/mcp/`, separate bundle entries which no other module may import.
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still catches forbidden view imports and keeps the view and migrate exemptions', () => {
    const src = resolve('/repo/src');
    const component = join(src, 'components', 'x.ts');
    const shared = join(src, 'shared', 'x.ts');

    expect(entryOffenders([
      { path: component, text: "import { ports } from '../view/agent-runtime';" },
      { path: shared, text: "export { ports } from '@/view/agent-runtime';" },
      { path: join(src, 'view', 'x.ts'), text: "import { ports } from './agent-runtime';" },
      { path: join(src, 'migrate', 'x.ts'), text: "import { ports } from '../view/agent-runtime';" },
    ], src)).toEqual([component, shared]);
  });

  it('rejects a components module importing the MCP entry', () => {
    const src = resolve('/repo/src');
    const component = join(src, 'components', 'x.ts');

    expect(entryOffenders([
      { path: component, text: "import { start } from '../mcp/server';" },
    ], src)).toEqual([component]);
  });

  it('allows src/mcp to import the headless view ports', () => {
    const src = resolve('/repo/src');

    expect(entryOffenders([
      { path: join(src, 'mcp', 'server.ts'), text: "import { ports } from '../view/agent-runtime';" },
    ], src)).toEqual([]);
  });

  it('does not let view or migrate modules import MCP modules', () => {
    const src = resolve('/repo/src');
    const view = join(src, 'view', 'x.ts');
    const migrate = join(src, 'migrate', 'x.ts');

    expect(entryOffenders([
      { path: view, text: "import { start } from '../mcp/server';" },
      { path: migrate, text: "export { start } from '../mcp/server';" },
    ], src)).toEqual([view, migrate]);
  });

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
    const offenders = entryOffenders(
      sourceFiles.map(path => ({ path, text: readFileSync(path, 'utf-8') })),
      srcDir
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
