import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type LifecycleCategory =
  | 'executable-literal'
  | 'finite-dynamic'
  | 'registered-namespace-compatible'
  | 'catalog-only';

const SRC_DIR = resolve(__dirname, '../../../../src');
const ENGLISH_PATH = join(SRC_DIR, 'components/i18n/locales/en/messages.json');
const CATALOG_ONLY_KEYS = new Set([
  'blockSettings.convertWithChildrenWarning',
  'tools.columns.turnInto',
]);

const sourceFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || entry.name.endsWith('.d.ts')) return [];

    return /\.(?:ts|tsx|js|mjs)$/u.test(entry.name) ? [path] : [];
  }).sort();
};

const unwrap = (node: ts.Expression | undefined): ts.Expression | undefined => {
  let current = node;

  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }

  return current;
};

const literalText = (node: ts.Node | undefined): string | undefined => {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
};

const named = (node: ts.PropertyName, expected: string): boolean => {
  return (ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === expected;
};

const parseSource = (path: string): ts.SourceFile => {
  const source = readFileSync(path, 'utf-8');
  let kind = ts.ScriptKind.TS;

  if (path.endsWith('.tsx')) {
    kind = ts.ScriptKind.TSX;
  } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
    kind = ts.ScriptKind.JS;
  }

  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
};

const deriveLifecycle = (): {
  lifecycle: Map<string, LifecycleCategory>;
  directLiteralCalls: Set<string>;
} => {
  const english = JSON.parse(readFileSync(ENGLISH_PATH, 'utf-8')) as Record<string, string>;
  const catalog = new Set(Object.keys(english));
  const literal = new Set<string>();
  const dynamic = new Set<string>();
  const directLiteralCalls = new Set<string>();
  const parsed = new Map<string, ts.SourceFile>();
  const files = sourceFiles(SRC_DIR);
  const addDynamic = (key: string): void => {
    if (catalog.has(key)) dynamic.add(key);
  };
  const addSearchTerms = (elements: ts.NodeArray<ts.Expression>): void => {
    for (const element of elements) {
      const suffix = literalText(element);

      if (suffix !== undefined) addDynamic(`searchTerms.${suffix}`);
    }
  };

  for (const path of files) {
    const sourceFile = parseSource(path);
    const relative = path.slice(SRC_DIR.length + 1).replaceAll('\\', '/');
    const toolHelperNames = new Set(
      sourceFile.statements.flatMap((statement) => {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.endsWith('/i18n') ||
          statement.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          return [];
        }

        return statement.importClause.namedBindings.elements.flatMap(specifier =>
          (specifier.propertyName ?? specifier.name).text === 'tr'
            ? [specifier.name.text]
            : []
        );
      })
    );

    parsed.set(relative, sourceFile);

    const visit = (node: ts.Node): void => {
      const value = literalText(node);

      if (value !== undefined && catalog.has(value)) literal.add(value);

      if (ts.isCallExpression(node)) {
        const isMethodCall =
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 't';
        const isToolHelperCall =
          ts.isIdentifier(node.expression) &&
          toolHelperNames.has(node.expression.text);
        let argument: ts.Expression | undefined;

        if (isMethodCall) {
          argument = node.arguments[0];
        } else if (isToolHelperCall) {
          argument = node.arguments[1];
        }
        const directKey = literalText(argument === undefined ? undefined : unwrap(argument));

        if (directKey !== undefined && catalog.has(directKey)) {
          directLiteralCalls.add(directKey);
        }
      }

      if (
        (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
        named(node.name, 'titleKey') &&
        node.initializer !== undefined
      ) {
        const titleKey = literalText(unwrap(node.initializer));

        if (titleKey !== undefined) {
          addDynamic(titleKey.includes('.') ? titleKey : `toolNames.${titleKey}`);
        }
      }

      if (
        ts.isPropertyAssignment(node) &&
        named(node.name, 'searchTermKeys') &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        addSearchTerms(node.initializer.elements);
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'i18nLabel'
      ) {
        const suffix = literalText(node.arguments[0]);

        if (suffix !== undefined && relative.startsWith('tools/audio/')) {
          addDynamic(`tools.audio.${suffix}`);
        }
        if (suffix !== undefined && relative.startsWith('tools/video/')) {
          addDynamic(`tools.video.${suffix}`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  for (const color of ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']) {
    addDynamic(`tools.colorPicker.color.${color}`);
  }
  for (const count of [2, 3, 4, 5]) addDynamic(`tools.columns.col${count}`);
  for (const level of [1, 2, 3, 4, 5, 6]) addDynamic(`tools.header.toggleHeading${level}`);
  addDynamic('tools.image.errorRetry');
  addDynamic('tools.image.errorReplace');

  for (const key of literal) dynamic.delete(key);

  const registeredNamespaces = new Set<string>();
  const registryFile = parsed.get('tools/index.ts');

  if (registryFile === undefined) throw new Error('missing default tool registry');

  const findRegistry = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'defaultBlockTools'
    ) {
      const registry = unwrap(node.initializer);

      if (registry === undefined || !ts.isObjectLiteralExpression(registry)) {
        throw new Error('defaultBlockTools must remain an object literal');
      }

      const namespaceNames = registry.properties.flatMap((property) => {
        if (!('name' in property) || property.name === undefined) return [];

        return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? [property.name.text]
          : [];
      });

      namespaceNames.forEach(name => registeredNamespaces.add(name));
    }

    ts.forEachChild(node, findRegistry);
  };

  findRegistry(registryFile);

  const result = new Map<string, LifecycleCategory>();

  for (const key of catalog) {
    if (literal.has(key)) {
      result.set(key, 'executable-literal');
    } else if (dynamic.has(key)) {
      result.set(key, 'finite-dynamic');
    } else if (CATALOG_ONLY_KEYS.has(key)) {
      result.set(key, 'catalog-only');
    } else if (key.startsWith('tools.') && registeredNamespaces.has(key.split('.')[1] ?? '')) {
      result.set(key, 'registered-namespace-compatible');
    } else {
      throw new Error(`unclassified English catalog key: ${key}`);
    }
  }

  return { lifecycle: result, directLiteralCalls };
};

let cachedLifecycle: ReturnType<typeof deriveLifecycle> | undefined;
const getLifecycle = (): ReturnType<typeof deriveLifecycle> => {
  cachedLifecycle ??= deriveLifecycle();

  return cachedLifecycle;
};

describe('current English catalog lifecycle coverage', () => {
  it('rebuilds a disjoint 405 + 122 + 25 + 2 closure for all 554 keys', () => {
    const { lifecycle } = getLifecycle();
    const counts = Object.fromEntries(
      ([
        'executable-literal',
        'finite-dynamic',
        'registered-namespace-compatible',
        'catalog-only',
      ] as const).map(category => [
        category,
        [...lifecycle.values()].filter(value => value === category).length,
      ])
    );

    expect(lifecycle.size).toBe(554);
    expect(counts).toEqual({
      'executable-literal': 405,
      'finite-dynamic': 122,
      'registered-namespace-compatible': 25,
      'catalog-only': 2,
    });
    expect(
      [...lifecycle.entries()]
        .filter(([, category]) => category === 'catalog-only')
        .map(([key]) => key)
        .sort()
    ).toEqual([...CATALOG_ONLY_KEYS].sort());
  }, 15_000);

  it('classifies every new migration key as an executable literal with a direct caller', () => {
    const { lifecycle, directLiteralCalls } = getLifecycle();
    const migrationKeys = [
      'tools.video.statsResolution',
      'tools.video.statsDroppedFrames',
      'tools.video.statsBufferHealth',
      'tools.video.statsViewport',
      'tools.video.statsUnavailable',
      'tools.database.moreViews',
      'tools.video.errorNotMediaUrl',
      'tools.video.errorUnplayable',
    ];

    expect(migrationKeys.map(key => lifecycle.get(key)))
      .toEqual(Array.from({ length: migrationKeys.length }, () => 'executable-literal'));
    expect(migrationKeys.filter(key => !directLiteralCalls.has(key))).toEqual([]);
  }, 15_000);
});
