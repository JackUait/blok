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
 *     rewrites those imports to the flattened `@bloklabs/core` alias), or
 *   - explicitly named in `scripts/build-angular.mjs` by its repo-relative path.
 *
 * The adapter no longer reaches core only through relative paths: it imports the
 * shared utilities through the BARE `@bloklabs/core/adapters` specifier, which
 * the build script rewrites to a staged `adapters-contract.ts` re-exporting the
 * staged copies. A bare specifier is invisible to a relative-import walk, so the
 * whole contract graph became a blind spot in this law — which is how
 * `src/tools/nested-blocks.ts` gaining `import … from '../components/utils/html'`
 * and `src/adapters.ts` gaining `export { BlockChildrenMounted } …` both reached
 * CI with a green `yarn test` and a red ng-packagr build. Hence the second law
 * below, which seeds the same walk from `src/adapters.ts`'s re-export list.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ANGULAR_DIR = join(REPO_ROOT, 'packages', 'angular', 'src');
const SHARED_DIR = join(REPO_ROOT, 'src', 'shared');
const TYPES_DIR = join(REPO_ROOT, 'types');
const MARKDOWN_DIR = join(REPO_ROOT, 'src', 'markdown');
const BUILD_SCRIPT = join(REPO_ROOT, 'scripts', 'build-angular.mjs');
const ADAPTERS_ENTRY = join(REPO_ROOT, 'src', 'adapters.ts');

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

/** Does the build script stage this module — wholesale, or by explicit name? */
function isStaged(target: string, buildScript: string): boolean {
  if (isUnder(ANGULAR_DIR, target) || isUnder(SHARED_DIR, target)) {
    return true;
  }

  return buildScript.includes(relative(REPO_ROOT, target));
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

    // Rewritten by the build script to the flattened `@bloklabs/core` alias.
    if (isUnder(TYPES_DIR, target) || isUnder(MARKDOWN_DIR, target)) {
      continue;
    }

    if (!isStaged(target, buildScript)) {
      violations.push(
        `${relative(REPO_ROOT, file)} imports '${specifier}' (${relative(REPO_ROOT, target)}), ` +
        `which is not staged by scripts/build-angular.mjs — add a copyAndRewrite() ` +
        `entry for it or the ng-packagr build fails in CI with TS2307`
      );
      continue;
    }

    // Its own imports must still resolve inside the staging tree, so keep walking.
    next.push(target);
  }

  return next;
}

/** Walk a seed set transitively, recording every unstaged module reached. */
function walkStagingGraph(seeds: string[], buildScript: string, violations: string[]): void {
  const visited = new Set<string>();
  const queue = [...seeds];

  while (queue.length > 0) {
    const file = queue.pop();

    if (file === undefined || visited.has(file)) {
      continue;
    }
    visited.add(file);

    queue.push(...checkFileImports(file, buildScript, violations));
  }
}

/**
 * Modules the build script deliberately keeps OUT of the staged contract
 * (ng-packagr flattens without tree-shaking, so a staged module ships whole).
 * Read from the script rather than duplicated here — a second copy of the list
 * is the very drift this law exists to stop.
 */
function excludedContractModules(buildScript: string): Set<string> {
  const declaration = /const CONTRACT_EXCLUDED_MODULES = new Set\(\[([^\]]*)\]\)/.exec(buildScript);

  if (declaration === null) {
    throw new Error(
      'scripts/build-angular.mjs no longer declares CONTRACT_EXCLUDED_MODULES — this law reads that ' +
      'list to know which contract modules may go unstaged, and cannot run without it'
    );
  }

  return new Set([...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

/**
 * The modules `src/adapters.ts` re-exports — the exact set the staged
 * `adapters-contract.ts` has to mirror, because every adapter import of
 * `@bloklabs/core/adapters` is rewritten to point at it.
 */
function adaptersContractModules(excluded: Set<string>): string[] {
  const source = readFileSync(ADAPTERS_ENTRY, 'utf8');
  const specifiers = [...source.matchAll(/from\s*'(\.[^']+)'/g)].map((match) => match[1]);

  expect(
    specifiers.length,
    'src/adapters.ts re-export scan found nothing — this law parses that file, so a ' +
    'change to its shape silently disarms the check'
  ).toBeGreaterThan(0);

  return specifiers.filter((specifier) => !excluded.has(specifier)).map((specifier) => {
    const target = resolveSpecifier(ADAPTERS_ENTRY, specifier);

    if (target === null) {
      throw new Error(`src/adapters.ts re-exports '${specifier}', which does not resolve to a file`);
    }

    return target;
  });
}

/** The symbols `src/adapters.ts` contributes from the excluded modules. */
function excludedContractSymbols(excluded: Set<string>): string[] {
  const source = readFileSync(ADAPTERS_ENTRY, 'utf8');
  const symbols: string[] = [];

  for (const [statement, specifier] of source.matchAll(/^export\s+(?:\*|\{[^}]*\})\s*from\s*'(\.[^']+)';$/gm)) {
    if (!excluded.has(specifier)) {
      continue;
    }

    const named = /^export\s+\{([^}]*)\}/.exec(statement);

    if (named === null) {
      throw new Error(
        `src/adapters.ts re-exports the excluded module '${specifier}' with 'export *' — its symbols ` +
        `cannot be enumerated, so the exclusion cannot be proven safe. Stage the module instead.`
      );
    }

    symbols.push(...named[1].split(',').map((clause) => clause.trim().split(/\s+as\s+/).pop() ?? ''));
  }

  return symbols.filter((symbol) => symbol.length > 0);
}

/** Symbols an adapter source pulls out of `@bloklabs/core/adapters`. */
function contractImports(source: string): string[] {
  const imported: string[] = [];

  for (const [, clauses] of source.matchAll(
    /(?:import|export)[^;]*?\{([^}]*)\}[^;]*?from '@bloklabs\/core\/adapters'/g
  )) {
    imported.push(
      ...clauses.split(',').map((clause) => clause.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    );
  }

  return imported;
}

describe('Angular staging law', () => {
  it('stages every module the adapter reaches via relative imports', () => {
    const buildScript = readFileSync(BUILD_SCRIPT, 'utf8');
    const violations: string[] = [];

    walkStagingGraph(collectTsFiles(ANGULAR_DIR), buildScript, violations);

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });

  it('stages every module reachable through the @bloklabs/core/adapters contract', () => {
    const buildScript = readFileSync(BUILD_SCRIPT, 'utf8');
    const violations: string[] = [];
    const contract = adaptersContractModules(excludedContractModules(buildScript));

    for (const module of contract) {
      if (!isStaged(module, buildScript)) {
        violations.push(
          `src/adapters.ts re-exports ${relative(REPO_ROOT, module)}, which ` +
          `scripts/build-angular.mjs does not stage — the staged adapters-contract.ts ` +
          `cannot re-export it and ng-packagr fails with TS2305/TS2307`
        );
      }
    }

    walkStagingGraph(contract, buildScript, violations);

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });

  it('never imports a symbol from a contract module the build excludes', () => {
    const excluded = new Set(excludedContractSymbols(excludedContractModules(readFileSync(BUILD_SCRIPT, 'utf8'))));
    const violations: string[] = [];

    for (const file of collectTsFiles(ANGULAR_DIR)) {
      const dropped = contractImports(readFileSync(file, 'utf8')).filter((symbol) => excluded.has(symbol));

      violations.push(
        ...dropped.map(
          (symbol) =>
            `${relative(REPO_ROOT, file)} imports '${symbol}' from '@bloklabs/core/adapters', whose ` +
            `module is in CONTRACT_EXCLUDED_MODULES — the staged contract will not re-export it and ` +
            `ng-packagr fails with TS2305. Stage that module instead of excluding it.`
        )
      );
    }

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
