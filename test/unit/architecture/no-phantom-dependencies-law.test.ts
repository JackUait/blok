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
  /(?:^|[\s;}`])import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;}`])import\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;}`])export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// One left-to-right pass over comments AND string literals, so whichever
// starts first wins: a `/*` inside a `//` comment (a glob like `src/yjs/*`)
// or inside a string cannot open a block comment and hide the code after it.
const COMMENT_OR_STRING = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g;

/**
 * Drops comments. Keeps template literals whole (bundler input), and keeps a
 * quoted string only if it could be a specifier: one with a space or a
 * bracket is prose or sample code, like `'import x from "y"'` in a test.
 *
 * @param token - one COMMENT_OR_STRING match
 * @returns what the import patterns should see in its place
 */
const keepCodeAndSpecifiers = (token: string): string => {
  if (token.startsWith('/')) {
    return '';
  }

  return token.startsWith('`') || !/[\s()]/.test(token) ? token : "''";
};

/**
 * Extracts bare package names imported by a source file: static imports and
 * re-exports, `require('x')` and `import('x')` with a literal argument.
 *
 * Strings are kept, so the code build scripts hand to a bundler in a template
 * literal (esbuild `stdin.contents`) is checked too. Regexes, not the
 * TypeScript scanner: `ts.preProcessFile` over the whole repo is about ten
 * times slower, and on CI it took 14s of this test's budget.
 *
 * @param source - file contents
 * @returns package names imported by the file
 */
function importedPackages(source: string): string[] {
  const withoutComments = source.replace(COMMENT_OR_STRING, keepCodeAndSpecifiers);
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

/**
 * Undeclared packages a few named files may still import. Each entry names the
 * declared dependency that installs the package, and why the file needs it.
 * The tests below fail once a listed file stops importing the package, or the
 * supplier stops depending on it, so an entry cannot outlive its reason.
 */
const ALLOWED_UNDECLARED: Record<string, { suppliedBy: string; reason: string; files: string[] }> = {
  lib0: {
    suppliedBy: 'yjs',
    reason: 'Blok writes lib0\'s wire format and runs its text diff with its own code. ' +
      'These files use lib0 only as the reference that code and the server fixtures are checked against.',
    files: [
      'scripts/generate-sync-frames.mjs',
      'scripts/generate-yjs-engine-fixtures.mjs',
      'test/unit/server-conformance/lib0-parity.test.ts',
      'test/unit/server-conformance/sync-frames.freshness.test.ts',
      'test/unit/server-conformance/yjs-engine-fixtures.freshness.test.ts',
    ],
  },
};

const isAllowedUndeclared = (name: string, relative: string): boolean =>
  ALLOWED_UNDECLARED[name]?.files.includes(relative) ?? false;

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
        // A type-only import of `x` is satisfied by `@types/x`: the module
        // name comes from the types package, not a runtime one.
        .filter((name) => !declared.has(name) && !declared.has(`@types/${name}`))
        .filter((name) => !isAllowedUndeclared(name, relative))
        .map((name) => `${relative}: imports undeclared "${name}"`);
    });

    expect(violations, `Phantom dependencies found:\n${violations.join('\n')}`).toEqual([]);
  }, 30_000);

  it.each(Object.entries(ALLOWED_UNDECLARED))('%s is still undeclared and installed by the dependency named for it', (name, { suppliedBy }) => {
    const declared = declaredIn(path.join(REPO_ROOT, 'package.json'));
    const supplier = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'node_modules', suppliedBy, 'package.json'), 'utf-8')
    ) as { dependencies?: Record<string, string> };

    // Declared again, the entry is dead weight: drop it.
    expect(declared.has(name)).toBe(false);
    expect(declared.has(suppliedBy)).toBe(true);
    expect(Object.keys(supplier.dependencies ?? {})).toContain(name);
    // The listed files import it by bare name, so it must sit at the root.
    expect(existsSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'))).toBe(true);
  });

  it.each(Object.entries(ALLOWED_UNDECLARED).flatMap(([name, { files }]) => files.map((file) => [name, file])))(
    '%s is still imported by %s, the file allowed to import it',
    (name, file) => {
      const absolute = path.join(REPO_ROOT, file);

      expect(existsSync(absolute)).toBe(true);
      expect(importedPackages(readFileSync(absolute, 'utf-8'))).toContain(name);
    }
  );

  it('detects a phantom import when one exists', () => {
    // Mutation guard: proves the detector actually fires. Uses a synthetic
    // package name that can never become a real declared dependency, rather
    // than a real package whose declared status could legitimately change.
    const synthetic = `import { x } from 'zz-blok-law-not-a-real-package';`;
    const declared = declaredIn(path.join(REPO_ROOT, 'package.json'));
    const found = importedPackages(synthetic).filter((name) => !declared.has(name));

    expect(found).toEqual(['zz-blok-law-not-a-real-package']);
  });

  it('still sees imports after a line comment that contains a glob like a/*', () => {
    const source = [
      '// lives in src/modules/*',
      `import { x } from 'zz-blok-law-not-a-real-package';`,
      `const y = require('zz-blok-law-required');`,
      '/** a real block comment */',
    ].join('\n');

    expect(importedPackages(source).sort()).toEqual(['zz-blok-law-not-a-real-package', 'zz-blok-law-required']);
  });

  it('sees imports inside a template literal handed to a bundler', () => {
    const source = [
      'await build({ stdin: { contents: `import React from \'zz-blok-law-in-template\';',
      'export const x = ${value};',
      '` } });',
    ].join('\n');

    expect(importedPackages(source)).toEqual(['zz-blok-law-in-template']);
  });
});
