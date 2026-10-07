import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SECTION_TRANSLATION_KEYS } from '../hooks/useApiTranslations';
import { translations } from '../i18n';
import { API_EXTRA_CATALOG, API_PAGE_FILES, STATIC_PAGES } from './page-fingerprint';

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
  'docs/src/hooks/': 'overlays over data modules; the catalogue keys they read are checked below',
  'docs/src/lib/': 'analytics and class helpers',
  'docs/src/seo/': 'route copy, fingerprinted per route',
  'docs/src/utils/': 'shared helpers and constants',
  'docs/src/i18n/': 'catalogues, fingerprinted per namespace',
  'docs/src/types/': 'types only',
  'docs/src/assets/': 'images; a page is dated by its text',
  'package.json': 'only the version is read, and it is normalised out',
  'CHANGELOG.md': 'the changelog is dated by its newest release heading instead',
};

/** Modules a page fingerprints as resolved data rather than as files. */
const AS_DATA: Record<string, string> = {
  'docs/src/components/api/docs-hub-summaries.ts': 'the hub hashes only its own locale\'s summaries',
};

// Page content that happens to live in a shared folder.
const NOT_SHARED = new Set(['docs/src/components/common/framework-snippets.ts']);

const isShared = (file: string): boolean =>
  file in AS_DATA || (!NOT_SHARED.has(file) && Object.keys(SHARED).some((prefix) => file.startsWith(prefix)));

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

const HOOKS = 'docs/src/hooks/';
const TOP_LEVEL_KEYS = new Set(Object.keys(translations.en));
const CATALOG_KEY = /^[A-Za-z]\w*(\.[\w-]+)+\.?$/;

/** Every module reached from the inputs, following only imports `follow` accepts. */
const reached = (inputs: string[], follow: (target: string) => boolean): string[] => {
  const seen = new Set<string>();
  const queue = inputs.flatMap(filesUnder);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const target of importsOf(file)) if (follow(target)) queue.push(target);
  }
  return [...seen].filter((file) => /\.[jt]sx?$/.test(file) && !/\.test\./.test(file)).sort();
};

/**
 * Translation hooks (hooks reading the i18n context) a page's own modules call,
 * also through another hook.
 */
const translationHooks = (inputs: string[]): string[] =>
  reached(inputs, (target) => !isShared(target) || target.startsWith(HOOKS)).filter(
    (file) => file.startsWith(HOOKS) && importsOf(file).includes('docs/src/contexts/I18nContext.tsx'),
  );

/**
 * Catalogue keys a module names: whole literals ('tools.sections.blockTools')
 * and the fixed head of a template (`api.sections.${key}` -> 'api.sections').
 */
const catalogKeysOf = (file: string): string[] => {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'), ts.ScriptTarget.Latest);
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.head.text;
    if (text !== undefined && CATALOG_KEY.test(text) && TOP_LEVEL_KEYS.has(text.split('.')[0])) {
      keys.add(text.replace(/\.$/, ''));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...keys].sort();
};

/** Keys a page names but never prerenders, with the reason. */
const UNRENDERED_KEYS: Record<string, string> = {
  'common.unknownError': 'shown only when the demo editor fails to load in the browser',
};

/** Keys the modules name that no catalogue namespace of the page covers. */
const undeclaredKeys = (modules: string[], catalog: string[]): string[] =>
  modules.flatMap((file) =>
    catalogKeysOf(file)
      .filter((key) => !(key in UNRENDERED_KEYS))
      .filter((key) => !catalog.some((namespace) => key === namespace || key.startsWith(`${namespace}.`)))
      .map((key) => `${file}: ${key}`),
  );

const apiCatalog = (id: string): string[] => [
  ...(SECTION_TRANSLATION_KEYS[id] ? [SECTION_TRANSLATION_KEYS[id]] : []),
  ...(API_EXTRA_CATALOG[id] ?? []),
];

describe('page fingerprint inputs', () => {
  // A hook renders catalogue strings the page's files never name, so its keys
  // must be in the page's catalogue or a renamed label never re-dates the page.
  it.each(Object.entries(STATIC_PAGES))('declare every catalogue key a translation hook renders on %s', (_route, page) => {
    expect(undeclaredKeys(translationHooks(page.files), page.catalog)).toEqual([]);
  });

  it.each(Object.entries(API_PAGE_FILES))('declare every catalogue key a translation hook renders on the %s page', (id, files) => {
    expect(undeclaredKeys(translationHooks(files), apiCatalog(id))).toEqual([]);
  });

  it.each(Object.entries(STATIC_PAGES))('declare every catalogue key the modules of %s name', (_route, page) => {
    expect(undeclaredKeys(reached(page.files, (target) => !isShared(target)), page.catalog)).toEqual([]);
  });

  it.each(Object.entries(API_PAGE_FILES))('declare every catalogue key the modules of the %s page name', (id, files) => {
    expect(undeclaredKeys(reached(files, (target) => !isShared(target)), apiCatalog(id))).toEqual([]);
  });

  it('sees the keys of a hook a page calls', () => {
    expect(translationHooks(['docs/src/pages/PresetsPage.tsx'])).toEqual(['docs/src/hooks/usePresetsTranslations.ts']);
    expect(catalogKeysOf('docs/src/hooks/usePresetsTranslations.ts')).toEqual(['presets.items']);
  });

  it('sees a hook that another hook calls', () => {
    expect(translationHooks(['docs/src/components/api/ApiModuleBody.tsx'])).toEqual([
      'docs/src/hooks/useApiTranslations.ts',
      'docs/src/hooks/useDocsSidebarSections.ts',
      'docs/src/hooks/useToolsTranslations.ts',
    ]);
  });

  it.each(Object.entries(STATIC_PAGES))('cover every local module %s renders', (_route, page) => {
    expect(unfingerprinted(page.files)).toEqual([]);
  });

  it.each(Object.entries(API_PAGE_FILES))('cover every local module the %s page renders', (_id, files) => {
    expect(unfingerprinted(files)).toEqual([]);
  });
});

/** Every module reached from the inputs through static imports, non-code files included. */
const staticImportGraph = (inputs: string[]): string[] => {
  const seen = new Set<string>();
  const queue = [...inputs];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return [...seen].sort();
};

// The site root and every page's head reach these, so whatever they import
// statically is preloaded on every route.
const SHARED_ENTRIES = [
  'docs/src/root.tsx',
  'docs/src/seo/lastmod.ts',
  'docs/src/seo/meta-descriptors.ts',
  'docs/src/seo/route-metadata.ts',
  'docs/src/seo/jsonld.ts',
];

describe('shared metadata', () => {
  it('never imports the changelog text, which only the changelog page needs', () => {
    expect(staticImportGraph(SHARED_ENTRIES)).not.toContain('CHANGELOG.md');
  });

  it('sees a ?raw import of the changelog', () => {
    expect(staticImportGraph(['docs/src/pages/ChangelogPage.tsx'])).toContain('CHANGELOG.md');
  });
});
