import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_PAGE_FILES, STATIC_PAGES } from './page-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SRC = 'docs/src/';

/**
 * Modules a page may import without fingerprinting them, with the reason. These
 * are shared by many pages, so an edit there is not one page's content change.
 */
const SHARED: Record<string, string> = {
  'docs/src/components/common/': 'site-wide UI building blocks',
  'docs/src/components/ui/': 'site-wide UI primitives',
  'docs/src/components/layout/': 'nav and footer chrome',
  'docs/src/contexts/': 'app state, no copy',
  'docs/src/hooks/': 'overlays over data modules that the pages fingerprint themselves',
  'docs/src/lib/': 'analytics and class helpers',
  'docs/src/seo/': 'route copy, fingerprinted per route',
  'docs/src/utils/': 'shared helpers and constants',
  'docs/src/i18n/': 'catalogues, fingerprinted per namespace',
  'docs/src/types/': 'types only',
  'docs/src/assets/': 'images; a page is dated by its text',
  'package.json': 'only the version is read, and it is normalised out',
  'CHANGELOG.md': 'the changelog is dated by its newest release heading instead',
};

// Page content that happens to live in a shared folder.
const NOT_SHARED = new Set(['docs/src/components/common/framework-snippets.ts']);

const isShared = (file: string): boolean =>
  !NOT_SHARED.has(file) && Object.keys(SHARED).some((prefix) => file.startsWith(prefix));

const covers = (inputs: string[], file: string): boolean =>
  inputs.some((input) => file === input || file.startsWith(`${input}/`));

const resolveImport = (from: string, spec: string): string | undefined => {
  const bare = spec.replace(/\?.*$/, '');
  let base: string;
  if (bare.startsWith('.')) base = path.join(path.dirname(from), bare);
  else if (bare.startsWith('@/')) base = `${SRC}${bare.slice(2)}`;
  else return undefined;
  return ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
    .map((suffix) => path.normalize(`${base}${suffix}`))
    .find((candidate) => fs.existsSync(path.join(REPO_ROOT, candidate)) && fs.statSync(path.join(REPO_ROOT, candidate)).isFile());
};

const filesUnder = (input: string): string[] => {
  const absolute = path.join(REPO_ROOT, input);
  if (!fs.statSync(absolute).isDirectory()) return [input];
  return fs.readdirSync(absolute).flatMap((name) => filesUnder(path.join(input, name)));
};

// Static imports only: code samples in template strings are not imports, and a
// lazy import() is a panel behind ?view=, not the prerendered page.
const importsOf = (file: string): string[] => {
  if (!/\.[jt]sx?$/.test(file) || /\.test\./.test(file)) return [];
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'), ts.ScriptTarget.Latest);
  return source.statements
    .flatMap((statement) =>
      ((ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(statement) && !statement.isTypeOnly)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    )
    .map((spec) => resolveImport(file, spec))
    .filter((resolved): resolved is string => resolved !== undefined);
};

/** Local modules a page reaches that are neither in its inputs nor shared. */
const unfingerprinted = (inputs: string[]): string[] => {
  const seen = new Set<string>();
  const missing = new Set<string>();
  const queue = inputs.flatMap(filesUnder);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const target of importsOf(file)) {
      if (isShared(target)) continue;
      if (!covers(inputs, target)) missing.add(target);
      queue.push(target);
    }
  }
  return [...missing].sort();
};

describe('page fingerprint inputs', () => {
  it.each(Object.entries(STATIC_PAGES))('cover every local module %s renders', (_route, page) => {
    expect(unfingerprinted(page.files)).toEqual([]);
  });

  it.each(Object.entries(API_PAGE_FILES))('cover every local module the %s page renders', (_id, files) => {
    expect(unfingerprinted(files)).toEqual([]);
  });
});
