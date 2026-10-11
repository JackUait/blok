import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'types', 'tools-entry.d.ts');
const CONSUMER = join(REPO_ROOT, 'types', 'database-csv-public-types.consumer.ts');
const CONSUMER_SOURCE = `
import type { Database } from '@bloklabs/core/tools';

export function exportRows(database: Database): string {
  return database.exportCsv();
}
`;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: [],
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  paths: { '@bloklabs/core/tools': [ENTRY] },
};

describe('Database CSV public types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a package consumer export CSV as a string without implementation source', () => {
    const baseHost = ts.createCompilerHost(COMPILER_OPTIONS);
    const consumerHost: ts.CompilerHost = {
      ...baseHost,
      fileExists: (fileName) => fileName === CONSUMER || baseHost.fileExists(fileName),
      readFile: (fileName) => fileName === CONSUMER ? CONSUMER_SOURCE : baseHost.readFile(fileName),
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
        fileName === CONSUMER
          ? ts.createSourceFile(fileName, CONSUMER_SOURCE, languageVersion, true)
          : baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
    };
    const program = ts.createProgram([ENTRY, CONSUMER], COMPILER_OPTIONS, consumerHost);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const formatted = ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => REPO_ROOT,
      getNewLine: () => '\n',
    });

    expect(diagnostics.length, formatted).toBe(0);
    const implementationFiles = program.getSourceFiles()
      .filter((file) => !file.isDeclarationFile
        && file.fileName !== CONSUMER
        && !resolve(file.fileName).startsWith(join(REPO_ROOT, 'types') + sep))
      .map((file) => file.fileName);

    expect(implementationFiles).toEqual([]);
  });
});
