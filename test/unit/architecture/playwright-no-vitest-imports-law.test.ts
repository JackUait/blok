/**
 * Nothing Playwright loads may import vitest.
 *
 * Playwright compiles specs to CommonJS, and vitest throws when it is loaded
 * through require(). One such import anywhere in the graph crashes
 * `playwright test --list`, so every E2E shard fails before a single test runs.
 *
 * Shared helpers (e.g. the server-conformance harness) take per-test hooks by
 * injection instead; test/unit/vitest.setup.ts wires vitest's in.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const ROOTS = [
  join(REPO_ROOT, 'playwright.config.ts'),
  join(REPO_ROOT, 'test/playwright'),
  join(REPO_ROOT, 'test/evals/agent/playwright.evals.config.ts'),
  join(REPO_ROOT, 'test/evals/agent/runner/browser.eval.ts'),
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

// Whole-statement `import type` / `export type` is erased, so it is skipped.
const SPECIFIER = /(?:^|\n)\s*(import|export)(\s+type\b)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const isVitest = (specifier: string): boolean =>
  specifier === 'vitest' || specifier.startsWith('vitest/') || specifier.startsWith('@vitest/');

const collectFiles = (path: string): string[] => {
  if (!statSync(path).isDirectory()) {
    return [path];
  }

  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);

    if (statSync(full).isDirectory()) {
      return collectFiles(full);
    }

    return SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !entry.endsWith('.d.ts') ? [full] : [];
  });
};

const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    base.replace(/\.js$/, '.ts'),
    join(base, 'index.ts'),
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

const specifiersOf = (file: string): string[] => {
  const specifiers: string[] = [];

  for (const match of readFileSync(file, 'utf-8').matchAll(SPECIFIER)) {
    if (match[2] !== undefined) {
      continue;
    }

    const specifier = match[3] ?? match[4] ?? match[5];

    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
};

describe('Playwright never loads vitest', () => {
  it('finds no vitest import in any file reachable from a Playwright root', () => {
    const violations: string[] = [];
    const parentOf = new Map<string, string | undefined>();
    const queue = ROOTS.flatMap(collectFiles);

    for (const file of queue) {
      parentOf.set(file, undefined);
    }

    const chainTo = (file: string): string => {
      const chain = [relative(REPO_ROOT, file)];

      for (let parent = parentOf.get(file); parent !== undefined; parent = parentOf.get(parent)) {
        chain.unshift(relative(REPO_ROOT, parent));
      }

      return chain.join(' -> ');
    };

    const visit = (file: string, specifier: string): void => {
      if (isVitest(specifier)) {
        violations.push(`${chainTo(file)} imports '${specifier}'`);

        return;
      }

      const target = specifier.startsWith('.') ? resolveRelative(file, specifier) : undefined;

      if (target !== undefined && !parentOf.has(target)) {
        parentOf.set(target, file);
        queue.push(target);
      }
    };

    for (let index = 0; index < queue.length; index++) {
      for (const specifier of specifiersOf(queue[index])) {
        visit(queue[index], specifier);
      }
    }

    expect(
      violations,
      `Playwright compiles to CommonJS and vitest refuses require(), so this crashes ` +
      `\`playwright test --list\`. Inject the vitest hook from test/unit/vitest.setup.ts instead:\n` +
      violations.join('\n')
    ).toEqual([]);
    expect(queue.length).toBeGreaterThan(100);
  });
});
