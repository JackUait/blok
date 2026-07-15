/**
 * Architectural enforcement: published declarations must never reach into `src/`.
 *
 * The `types/` directory is the package's HAND-AUTHORED public type surface —
 * the `exports` map points every subpath's `types` at a file under `types/`,
 * and the build emits only JS bundles (no `.d.ts` generation). A consumer that
 * imports `@dodopizza/blok` (or any subpath) has their `tsc` follow the
 * declaration graph starting from `types/*.d.ts`.
 *
 * The law: NO file under `types/` may re-export from, import from, or otherwise
 * reference a module that resolves into `src/`. The moment a published `.d.ts`
 * names raw `../src/...`, `tsc` pulls the implementation `.ts` graph into the
 * CONSUMER's program as real source. That source then depends on packages blok
 * never declares as runtime `dependencies` (transitive type-only deps like
 * `micromark-util-types` / `@types/mdast`), so the consumer's build explodes
 * with TS2307 / TS7006 errors that have nothing to do with their code.
 *
 * This is exactly what shipped in @dodopizza/blok@0.24.0: `types/react.d.ts`
 * gained `import type { MarkdownImportConfig } from './markdown'`, which dragged
 * in `types/markdown.d.ts`'s `export { markdownToBlocks } from '../src/markdown/index'`,
 * which dragged `src/markdown/**.ts` → undeclared `micromark-util-types` /
 * `mdast` → 5 build errors in every consumer. `types/icons.d.ts` carried the
 * same `export * from '../src/icons/index'` landmine; it stayed dormant only
 * because `src/icons` happens to have no external type deps — a coincidence,
 * not a guarantee.
 *
 * Root-cause fix + this guard: keep `types/` self-contained. To expose a value
 * whose implementation lives in `src/`, hand-author its signature in `types/`
 * (see `types/markdown.d.ts`) or generate a self-contained declaration
 * (see `types/icons.d.ts` + `scripts/generate-icons-dts.mjs`) — never
 * re-export from `../src/`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TYPES_DIR = join(REPO_ROOT, 'types');
const SRC_DIR = join(REPO_ROOT, 'src');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const ICONS_SOURCE = join(SRC_DIR, 'components', 'icons', 'index.ts');
const ICONS_DTS = join(TYPES_DIR, 'icons.d.ts');

/** Recursively collect every `.d.ts` file under `types/`. */
function collectDeclarationFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);

    if (statSync(abs).isDirectory()) {
      out.push(...collectDeclarationFiles(abs));
    } else if (abs.endsWith('.d.ts')) {
      out.push(abs);
    }
  }

  return out;
}

/**
 * Extract every module specifier a declaration file references — the string in
 * `from '…'`, `import('…')`, and bare `import '…'` / `export '…'` forms.
 */
function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/** Icon constant names exported by a source/declaration file. */
function extractExportedConstNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /\bexport\s+(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    names.push(match[1]);
  }

  return names;
}

/** `types/` directories of every workspace package under `packages/`. */
function collectWorkspaceTypesDirs(): string[] {
  const dirs: string[] = [];

  const isDir = (dir: string): boolean => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false; // workspace without a types/ dir (e.g. cli) — nothing to scan
    }
  };

  for (const entry of readdirSync(PACKAGES_DIR)) {
    const typesDir = join(PACKAGES_DIR, entry, 'types');

    if (isDir(typesDir)) {
      dirs.push(typesDir);
    }
  }

  return dirs;
}

describe('published types never reference src/', () => {
  const declarationFiles = [TYPES_DIR, ...collectWorkspaceTypesDirs()].flatMap(collectDeclarationFiles);

  it('finds declaration files to scan (guards against a broken glob)', () => {
    expect(declarationFiles.length).toBeGreaterThan(0);
  });

  it.each(declarationFiles.map((file) => [relative(REPO_ROOT, file), file] as const))(
    '%s resolves no specifier into src/',
    (_rel, file) => {
      const offenders: string[] = [];

      for (const specifier of extractModuleSpecifiers(readFileSync(file, 'utf-8'))) {
        if (!specifier.startsWith('.')) {
          continue; // bare package specifiers can't reach into our src/
        }

        const resolved = resolve(dirname(file), specifier);
        // Both the core `src/` tree and any workspace's own `src/` are raw
        // implementation source — published declarations may reference neither.
        const isSrc = resolved === SRC_DIR
          || resolved.startsWith(SRC_DIR + sep)
          || /[\\/]packages[\\/][^\\/]+[\\/]src([\\/]|$)/.test(resolved);

        if (isSrc) {
          offenders.push(specifier);
        }
      }

      expect(
        offenders,
        `${relative(REPO_ROOT, file)} re-exports/imports from raw source: ${offenders.join(', ')}. ` +
          'Published declarations must be self-contained — hand-author or generate the signature in types/ instead.',
      ).toEqual([]);
    },
  );
});

describe('types/icons.d.ts stays in sync with src icon exports', () => {
  it('declares exactly the icon constants exported by src/components/icons', () => {
    const sourceNames = new Set(extractExportedConstNames(readFileSync(ICONS_SOURCE, 'utf-8')));
    const declaredNames = new Set(extractExportedConstNames(readFileSync(ICONS_DTS, 'utf-8')));

    const missing = [...sourceNames].filter((name) => !declaredNames.has(name)).sort();
    const stale = [...declaredNames].filter((name) => !sourceNames.has(name)).sort();

    expect(
      { missing, stale },
      'types/icons.d.ts drifted from src/components/icons/index.ts. ' +
        'Run `node scripts/generate-icons-dts.mjs` to regenerate it.',
    ).toEqual({ missing: [], stale: [] });
  });
});
