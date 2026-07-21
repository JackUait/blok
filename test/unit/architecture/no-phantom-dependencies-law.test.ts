import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * LAW: every bare import in first-party code must resolve to a package this
 * repo DECLARES.
 *
 * A "phantom dependency" is a bare import that works only because a transitive
 * dependency happens to hoist the package into the root node_modules. It is
 * invisible until the dependency that supplied it moves, bumps, or drops the
 * package — and then it fails at IMPORT time, not at assert time. An import
 * that dies at load takes its whole file with it, which is how a guard stops
 * guarding while still looking like a passing suite.
 *
 * This repo has already been bitten twice:
 *   - `@tailwindcss/node`, imported by the Tailwind class-emits law, resolved
 *     only via `@tailwindcss/vite`.
 *   - `scripts/**` runs in CI jobs that never `yarn install`, so a phantom
 *     import there is a live break, not a latent one.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Directories whose imports are first-party and must be declared. */
const SCANNED_DIRS = ['src', 'scripts', 'test', 'packages'];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs']);

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'storybook-static']);

/**
 * Bare specifiers that are not npm packages and must not be treated as such:
 * Node builtins (with and without the `node:` prefix) and virtual modules that
 * a bundler supplies at build time.
 */
const NON_PACKAGE_PREFIXES = [/^node:/, /^bun:/, /^virtual:/, /^\0/];

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * Collects every file under `dir` whose extension we scan.
 *
 * @param dir - absolute directory to walk
 * @returns absolute file paths
 */
function collectFiles(dir: string): string[] {
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    if (IGNORED_DIRS.has(entry)) {
      return [];
    }

    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      return collectFiles(full);
    }

    return SCANNED_EXTENSIONS.has(path.extname(full)) ? [full] : [];
  });
}

/**
 * Reduces an import specifier to its package name.
 * `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`.
 *
 * @param specifier - the raw import specifier
 * @returns the package name, or null if it is not a bare package specifier
 */
function toPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return null;
  }

  if (NON_PACKAGE_PREFIXES.some((pattern) => pattern.test(specifier))) {
    return null;
  }

  const segments = specifier.split('/');
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];

  // Reject anything that is not a legal npm package name. Without this, a test
  // title like `it('rejects import ... from "x"', () => {})` is scraped as an
  // import and reported as a phantom.
  if (!/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i.test(name)) {
    return null;
  }

  return NODE_BUILTINS.has(name) ? null : name;
}

/**
 * Path-alias prefixes declared in tsconfig `paths` (e.g. `@/types`). These look
 * like bare specifiers but resolve to first-party source, not to a package.
 *
 * @returns alias roots, with any trailing `/*` removed
 */
function tsconfigAliases(): string[] {
  const file = path.join(REPO_ROOT, 'tsconfig.json');
  // TypeScript's own JSONC parser, not a regex: tsconfig allows comments and
  // trailing commas, AND contains path values like "@/*" whose `/*` a naive
  // block-comment strip would treat as a comment opener.
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf-8'));

  if (error !== undefined) {
    throw new Error(`Could not parse tsconfig.json: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`);
  }

  const paths = (config as { compilerOptions?: { paths?: Record<string, string[]> } })
    .compilerOptions?.paths ?? {};

  return Object.keys(paths).map((alias) => alias.replace(/\/\*$/, ''));
}

const ALIASES = tsconfigAliases();

const IMPORT_PATTERNS = [
  /(?:^|[\s;}])import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;}])export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Extracts bare package names imported by a source file.
 *
 * Deliberately excludes dynamic `import()` with a non-literal argument — those
 * cannot be resolved statically, and a false positive here would be worse than
 * a miss.
 *
 * @param source - file contents
 * @returns package names imported by the file
 */
function importedPackages(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments, but never the `//` inside a URL (`https://…`), which would
    // truncate the line and let a stray apostrophe swallow the rest of the file.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = new Set<string>();

  const isAlias = (name: string): boolean =>
    ALIASES.some((alias) => name === alias || name.startsWith(`${alias}/`));

  for (const pattern of IMPORT_PATTERNS) {
    const names = [...withoutComments.matchAll(pattern)]
      .map((match) => toPackageName(match[1]))
      .filter((name): name is string => name !== null && !isAlias(name));

    names.forEach((name) => found.add(name));
  }

  return [...found];
}

/**
 * Reads the union of every dependency field a package.json declares.
 *
 * @param manifestPath - absolute path to a package.json
 * @returns declared package names
 */
function declaredIn(manifestPath: string): Set<string> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

/**
 * Names of the workspace packages this repo publishes (packages/react, /vue,
 * /angular, /cli). Build scripts and e2e fixtures import these by name.
 */
const WORKSPACE_PACKAGE_NAMES = readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(REPO_ROOT, 'packages', entry.name, 'package.json'), 'utf-8')
      ) as { name?: string };

      return manifest.name === undefined ? [] : [manifest.name];
    } catch {
      return [];
    }
  });

/**
 * Finds the nearest package.json at or above a file, stopping at the repo root.
 * Workspace packages (packages/react, packages/vue…) declare their own deps, so
 * an import there may legitimately be satisfied by the workspace manifest.
 *
 * @param file - absolute file path
 * @returns declared package names from that manifest plus the root manifest
 */
function declaredFor(file: string): Set<string> {
  const declared = declaredIn(path.join(REPO_ROOT, 'package.json'));

  // A workspace package this repo builds itself is never a phantom — it is
  // produced by the build, not resolved from the registry.
  for (const name of WORKSPACE_PACKAGE_NAMES) {
    declared.add(name);
  }

  let dir = path.dirname(file);

  while (dir.startsWith(REPO_ROOT) && dir !== REPO_ROOT) {
    const candidate = path.join(dir, 'package.json');
    const names = existsSync(candidate) ? declaredIn(candidate) : null;

    if (names !== null) {
      names.forEach((name) => declared.add(name));
      break;
    }

    dir = path.dirname(dir);
  }

  return declared;
}

describe('LAW: no phantom dependencies', () => {
  const files = SCANNED_DIRS
    .flatMap((dir) => collectFiles(path.join(REPO_ROOT, dir)))
    // This file carries a deliberately-undeclared specifier inside its own
    // mutation guard, so scanning it would flag the fixture as a real finding.
    .filter((file) => file !== __filename);

  it('scans a meaningful number of first-party files', () => {
    // Non-vacuity floor: a broken walker would make every assertion below pass
    // by finding nothing. Same failure class this law exists to prevent.
    expect(files.length).toBeGreaterThan(500);
  });

  it('every bare import resolves to a declared dependency', () => {
    const violations = files.flatMap((file) => {
      const declared = declaredFor(file);
      const relative = path.relative(REPO_ROOT, file);

      return importedPackages(readFileSync(file, 'utf-8'))
        // `import type { Root } from 'mdast'` is satisfied by `@types/mdast`:
        // the module name comes from the types package, not a runtime one.
        .filter((name) => !declared.has(name) && !declared.has(`@types/${name}`))
        .map((name) => `${relative}: imports undeclared "${name}"`);
    });

    expect(violations, `Phantom dependencies found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('detects a phantom import when one exists', () => {
    // Mutation guard: proves the detector actually fires. Uses a synthetic
    // package name that can never become a real declared dependency, rather
    // than a real package whose declared status could legitimately change.
    const synthetic = `import { x } from 'zz-blok-law-not-a-real-package';`;
    const declared = declaredIn(path.join(REPO_ROOT, 'package.json'));
    const found = importedPackages(synthetic).filter((name) => !declared.has(name));

    expect(found).toEqual(['zz-blok-law-not-a-real-package']);
  });
});
