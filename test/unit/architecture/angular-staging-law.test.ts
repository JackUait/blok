/**
 * Architectural enforcement: every module the Angular adapter reaches via
 * relative imports must be staged by `scripts/build-angular.mjs`.
 *
 * ng-packagr cannot build against `src/` directly (rootDir constraints — see
 * the header comment in `scripts/build-angular.mjs`), so the build script
 * copies the adapter plus a HAND-MAINTAINED allowlist of shared modules into
 * `dist/.angular-build`. When an adapter file gains a relative import into
 * `src/components/...` (or any other tree outside `src/angular` / `src/shared`)
 * without the allowlist being updated, the staged compilation fails in CI with
 * TS2307 "Cannot find module" — while every local gate stays green, because
 * Vite-based builds and Vitest resolve straight from `src/`.
 *
 * That is exactly what happened when `blok-editor.component.ts` gained
 * `import { normalizeReadOnlyConfig } from '../components/utils/readonly-config'`:
 * unit tests, lint, and the React/Vue builds all passed, and only the
 * ng-packagr step in CI exploded.
 *
 * The law: walk the adapter's relative-import graph transitively. Every module
 * it reaches must be one of:
 *   - inside `src/angular/` or `src/shared/` (staged wholesale), or
 *   - under the repo-root `types/` tree or `src/markdown/` (the build script
 *     rewrites those imports to the flattened `@blok/core` alias), or
 *   - explicitly named in `scripts/build-angular.mjs` by its repo-relative path.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ANGULAR_DIR = join(REPO_ROOT, 'src', 'angular');
const SHARED_DIR = join(REPO_ROOT, 'src', 'shared');
const TYPES_DIR = join(REPO_ROOT, 'types');
const MARKDOWN_DIR = join(REPO_ROOT, 'src', 'markdown');
const BUILD_SCRIPT = join(REPO_ROOT, 'scripts', 'build-angular.mjs');

/** Recursively collect every `.ts` source file under a directory. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);

    if (statSync(abs).isDirectory()) {
      out.push(...collectTsFiles(abs));
    } else if (abs.endsWith('.ts')) {
      out.push(abs);
    }
  }

  return out;
}

/** Extract every relative import/export specifier from a TypeScript source. */
function relativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/** Resolve a relative specifier to an existing `.ts`/`.d.ts` file, or null. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);

  for (const candidate of [base, `${base}.ts`, `${base}.d.ts`, join(base, 'index.ts'), join(base, 'index.d.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function isUnder(dir: string, file: string): boolean {
  return !relative(dir, file).startsWith('..');
}

/**
 * Check every relative import of one file: record violations and return the
 * imported files the walk should continue into.
 */
function checkFileImports(file: string, buildScript: string, violations: string[]): string[] {
  const next: string[] = [];
  const source = readFileSync(file, 'utf8');

  for (const specifier of relativeSpecifiers(source)) {
    const target = resolveSpecifier(file, specifier);

    if (target === null) {
      violations.push(
        `${relative(REPO_ROOT, file)} imports '${specifier}' which does not resolve to a file`
      );
      continue;
    }

    // Rewritten by the build script to the flattened `@blok/core` alias.
    if (isUnder(TYPES_DIR, target) || isUnder(MARKDOWN_DIR, target)) {
      continue;
    }

    // Staged wholesale by the build script — but its own imports must
    // still resolve inside the staging tree, so keep walking.
    if (isUnder(ANGULAR_DIR, target) || isUnder(SHARED_DIR, target)) {
      next.push(target);
      continue;
    }

    const repoRelative = relative(REPO_ROOT, target);

    if (!buildScript.includes(repoRelative)) {
      violations.push(
        `${relative(REPO_ROOT, file)} imports '${specifier}' (${repoRelative}), ` +
        `which is not staged by scripts/build-angular.mjs — add a copyAndRewrite() ` +
        `entry for it or the ng-packagr build fails in CI with TS2307`
      );
      continue;
    }

    next.push(target);
  }

  return next;
}

describe('Angular staging law', () => {
  it('stages every module the adapter reaches via relative imports', () => {
    const buildScript = readFileSync(BUILD_SCRIPT, 'utf8');
    const visited = new Set<string>();
    const queue = collectTsFiles(ANGULAR_DIR);
    const violations: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop() as string;

      if (visited.has(file)) {
        continue;
      }
      visited.add(file);

      queue.push(...checkFileImports(file, buildScript, violations));
    }

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
