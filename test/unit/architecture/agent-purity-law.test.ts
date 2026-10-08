// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ReadSource = (file: string) => string | undefined;

interface ValueEdge {
  specifier: string;
  line: number;
}

interface ImportClosure {
  modules: string[];
  forbidden: string[];
  problems: string[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const valueEdges = (file: string, text: string): { edges: ValueEdge[]; problems: string[] } => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edges: ValueEdge[] = [];
  const problems: string[] = [];

  const addEdge = (specifier: ts.Node | undefined, node: ts.Node): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    if (specifier === undefined
      || (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier))) {
      problems.push(file + ':' + line + ' computed or missing value edge: ' + node.getText(source));

      return;
    }

    edges.push({ specifier: specifier.text, line });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node)) {
      return;
    }

    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;

      if (clause?.isTypeOnly) {
        return;
      }

      if (clause?.name === undefined && named !== undefined && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)) {
        return;
      }

      addEdge(node.moduleSpecifier, node);

      return;
    }

    if (ts.isExportDeclaration(node)) {
      const named = node.exportClause;

      if (node.isTypeOnly || node.moduleSpecifier === undefined) {
        return;
      }

      if (named !== undefined && ts.isNamedExports(named)
        && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)) {
        return;
      }

      addEdge(node.moduleSpecifier, node);

      return;
    }

    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        addEdge(node.moduleReference.expression, node);
      }

      return;
    }

    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      addEdge(node.arguments[0], node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { edges, problems };
};

const resolveValueEdge = (file: string, specifier: string, readSource: ReadSource): string | undefined => {
  if (/^\.\.?(?:\/|$)/.exec(specifier) === null) {
    return undefined;
  }

  const target = posix.normalize(posix.join(posix.dirname(file), specifier));
  const extension = posix.extname(target);

  if (extension !== '' && !SOURCE_EXTENSIONS.includes(extension)) {
    return undefined;
  }

  const candidates = extension === ''
    ? [
      ...SOURCE_EXTENSIONS.map(suffix => target + suffix),
      ...SOURCE_EXTENSIONS.map(suffix => posix.join(target, 'index' + suffix)),
    ]
    : [target];

  return candidates.find(candidate =>
    !/\.d\.(?:ts|mts|cts)$/.test(candidate) && readSource(candidate) !== undefined
  );
};

const scanClosure = (root: string, readSource: ReadSource): ImportClosure => {
  const modules = new Set<string>();
  const problems: string[] = [];

  const visit = (file: string): void => {
    if (modules.has(file)) {
      return;
    }

    const text = readSource(file);

    if (text === undefined) {
      problems.push(file + ': unresolved entry module');

      return;
    }

    modules.add(file);

    const scanned = valueEdges(file, text);

    problems.push(...scanned.problems);

    for (const edge of scanned.edges) {
      const target = resolveValueEdge(file, edge.specifier, readSource);

      if (target === undefined) {
        problems.push(file + ':' + edge.line + ' unresolved value edge: ' + edge.specifier);
      } else {
        visit(target);
      }
    }
  };

  visit(root);

  const reached = [...modules].sort();

  return {
    modules: reached,
    forbidden: reached.filter(file => file.startsWith('src/components/') || file.startsWith('src/tools/')),
    problems: problems.sort(),
  };
};

const fixtureClosure = (source: string, modules: Record<string, string> = {}): ImportClosure => {
  const files = new Map(Object.entries({ 'src/shared/entry.ts': source, ...modules }));

  return scanClosure('src/shared/entry.ts', file => files.get(file));
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless import-boundary scanner', () => {
  it('excludes explicit type-only imports, re-exports and import types', () => {
    const graph = fixtureClosure([
      "import type { Shape } from '../components/shape';",
      "import type DefaultShape from '../tools/default';",
      "import type * as Shapes from '../components/namespace';",
      "import { type NamedShape } from '../tools/named';",
      "import type LegacyShape = require('../components/legacy');",
      "export type { Shape } from '../tools/exported';",
      "export type * from '../components/star';",
      "export type * as Shapes from '../tools/namespace';",
      "export { type NamedShape } from '../components/named';",
      "type ImportedShape = import('../tools/import-type').Shape;",
      "type ImportedValue = typeof import('../components/import-query');",
    ].join('\n'));

    expect(graph).toEqual({ modules: ['src/shared/entry.ts'], forbidden: [], problems: [] });
  });

  it('does not treat comments or strings as import edges', () => {
    const graph = fixtureClosure([
      "// import '../components/comment';",
      'const text = "require(\'../tools/string\')";',
    ].join('\n'));

    expect(graph).toEqual({ modules: ['src/shared/entry.ts'], forbidden: [], problems: [] });
  });

  it.each([
    "import { value } from '../components/leaf';",
    "import { type Shape, value } from '../components/leaf';",
    "import value, { type Shape } from '../components/leaf';",
    "import value from '../components/leaf';",
    "import * as values from '../components/leaf';",
    "import {} from '../components/leaf';",
    "import '../components/leaf';",
    "export { value } from '../components/leaf';",
    "export { type Shape, value } from '../components/leaf';",
    "export * from '../components/leaf';",
    "export * as values from '../components/leaf';",
    "export {} from '../components/leaf';",
    "void import('../components/leaf');",
    "void import(`../components/leaf`);",
    "const value = require('../components/leaf');",
    "const value = require(`../components/leaf`);",
    "import values = require('../components/leaf');",
  ])('follows a value edge in %s', source => {
    const graph = fixtureClosure(source, {
      'src/components/leaf.ts': 'export const value = 1;',
    });

    expect(graph.forbidden).toEqual(['src/components/leaf.ts']);
    expect(graph.problems).toEqual([]);
    expect(graph.modules).toEqual(['src/components/leaf.ts', 'src/shared/entry.ts']);
  });

  it('finds forbidden modules behind a shared barrel and an indirect import', () => {
    const graph = fixtureClosure("import { value } from './bridge';", {
      'src/shared/bridge/index.ts': "export { value } from '../../tools/widget';",
      'src/tools/widget.ts': "import '../components/editor'; export const value = 1;",
      'src/components/editor.ts': 'export const editor = 1;',
    });

    expect(graph.forbidden).toEqual(['src/components/editor.ts', 'src/tools/widget.ts']);
    expect(graph.problems).toEqual([]);
    expect(graph.modules).toContain('src/shared/bridge/index.ts');
  });

  it('finishes a relative-import cycle without dropping its reachable modules', () => {
    const graph = fixtureClosure("import './leaf.ts';", {
      'src/shared/leaf.ts': "export * from './entry';",
    });

    expect(graph).toEqual({
      modules: ['src/shared/entry.ts', 'src/shared/leaf.ts'],
      forbidden: [],
      problems: [],
    });
  });

  it.each([
    { source: "import './missing';", specifier: './missing' },
    { source: "export * from './missing';", specifier: './missing' },
    { source: "void import('./missing');", specifier: './missing' },
    { source: "const value = require('./missing');", specifier: './missing' },
    { source: "import value = require('./missing');", specifier: './missing' },
    { source: "import './missing.css';", specifier: './missing.css' },
    { source: "import './declaration.d.ts';", specifier: './declaration.d.ts' },
    { source: "import 'unresolved-package';", specifier: 'unresolved-package' },
  ])('reports an unresolved value edge in $source', ({ source, specifier }) => {
    const graph = fixtureClosure(source, {
      'src/shared/declaration.d.ts': 'export declare const value: number;',
    });

    expect(graph.problems).toEqual(['src/shared/entry.ts:1 unresolved value edge: ' + specifier]);
    expect(graph.modules).toEqual(['src/shared/entry.ts']);
  });

  it.each([
    'void import(path);',
    "void import('./' + name);",
    'void import(`./${name}`);',
    'const value = require(path);',
    "const value = require('./' + name);",
    'const value = require(`./${name}`);',
  ])('reports a computed value edge in %s', source => {
    const graph = fixtureClosure(source);

    expect(graph.problems).toHaveLength(1);
    expect(graph.problems[0]).toContain('src/shared/entry.ts:1 computed or missing value edge:');
  });

  it('reports a missing entry instead of accepting an empty graph', () => {
    expect(scanClosure('src/shared/missing.ts', () => undefined)).toEqual({
      modules: [],
      forbidden: [],
      problems: ['src/shared/missing.ts: unresolved entry module'],
    });
  });
});

// Relative to the intended test/unit/architecture install path.
const repoRoot = resolve(__dirname, '../../..');
const readRepositorySource: ReadSource = file => {
  const absolute = join(repoRoot, file);

  return existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, 'utf8') : undefined;
};

describe('headless snapshot and custom-tools import boundary', () => {
  it.each([
    'src/shared/built-in-snapshot.ts',
    'src/shared/custom-tools-file.ts',
  ])('%s reaches runtime sanitizers without editor or tool modules', root => {
    const graph = scanClosure(root, readRepositorySource);

    expect({ forbidden: graph.forbidden, problems: graph.problems }, root).toEqual({
      forbidden: [],
      problems: [],
    });
    expect(graph.modules).toContain(root);
    expect(graph.modules).toContain('src/shared/tool-actions/runtime.ts');
    expect(graph.modules).toContain('src/shared/tool-descriptions/sanitize/inline.ts');
    expect(graph.modules).toContain('src/shared/inline-text-sanitize.ts');
  });
});
