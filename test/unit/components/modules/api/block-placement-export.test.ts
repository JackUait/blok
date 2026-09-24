/**
 * `BlockPlacementError` is public: hosts catch it by class from the core and
 * full entries, and the published declarations name it.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as core from '../../../../../src/blok';
import * as full from '../../../../../src/full';
import { BlockPlacementError } from '../../../../../src/components/modules/api/block-placement';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

const exportedNamesOf = (entry: string): Set<string> => {
  const program = ts.createProgram([ entry ], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(entry);
  const checker = program.getTypeChecker();
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);

  return new Set(moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.getName()));
};

describe('BlockPlacementError is public', () => {
  it.each([
    [ 'core', core ],
    [ 'full', full ],
  ])('the %s entry exports the class the API throws', (_name, entry) => {
    expect(entry.BlockPlacementError).toBe(BlockPlacementError);
    expect(new entry.BlockPlacementError('x').name).toBe('BlockPlacementError');
  });

  it.each([ 'index.d.ts', 'full.d.ts' ])('types/%s declares it and the placement types', (file) => {
    const names = exportedNamesOf(join(REPO_ROOT, 'types', file));

    expect([ 'BlockPlacementError', 'BlockPosition', 'InsertAtOptions', 'MoveToTarget' ].filter(name => !names.has(name))).toEqual([]);
  });
});
