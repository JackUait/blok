/**
 * Architectural enforcement: ESM source must never statically import `.cjs`.
 *
 * The published package ships `src/` and consumers' dev tooling can serve that
 * graph directly (e.g. a linked/aliased package under a Vite dev server). In
 * that mode there is NO CommonJS interop: a `.cjs` file is served to the
 * browser as-is, evaluates as an ES module with zero exports, and every named
 * import from it throws at module-parse time:
 *
 *   Uncaught SyntaxError: The requested module
 *   '/src/components/migration/legacy-grammar.cjs?import' does not provide an
 *   export named 'analyzeLegacyFormat'
 *
 * Blok's own Rollup build masks the problem (its commonjs plugin synthesizes
 * named exports into the bundle), so `dist/` works while the source graph is
 * broken — the failure only appears in downstream dev servers, long after the
 * import landed.
 *
 * The law: NO ESM source file under `src/` may statically import a `.cjs`
 * module. A module that must be shared with a CommonJS consumer (like the
 * zero-dep codemod) is authored as ESM (`.mjs`); the CJS side loads it with
 * `require(esm)`, native on Node >= 20.19 — the package's own engines floor.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'src');

const ESM_SOURCE_EXTENSIONS = ['.ts', '.mts', '.mjs', '.tsx'];

const STATIC_CJS_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+\.cjs)['"]/g;

const collectEsmSourceFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      files.push(...collectEsmSourceFiles(fullPath));
    } else if (ESM_SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts') && !entry.endsWith('.d.mts')) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('ESM source must not statically import .cjs modules', () => {
  it('finds no static .cjs imports anywhere under src/', () => {
    const violations: string[] = [];

    for (const file of collectEsmSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf-8');

      for (const match of content.matchAll(STATIC_CJS_IMPORT)) {
        violations.push(`${relative(REPO_ROOT, file)} imports '${match[1]}'`);
      }
    }

    expect(
      violations,
      `Static .cjs imports found in ESM source. These break consumers whose dev server ` +
      `serves blok's src/ graph (no CJS interop outside the bundler). Author the shared ` +
      `module as ESM (.mjs) and let CJS consumers load it via require(esm) instead:\n` +
      violations.join('\n')
    ).toEqual([]);
  });
});
