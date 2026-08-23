/**
 * Architectural enforcement: the editor-level uploader types must be reachable
 * from the package entry.
 *
 * `types/configs/uploader.d.ts` declares the three types a host needs to write
 * its own uploader: `BlokUploader` (what you assign to `BlokConfig.uploader`),
 * `UploadContext` (the second argument both methods receive) and
 * `UploadedAsset` (the resolved return shape). Declaring them is not enough —
 * `types/configs/index.d.ts` did not list `./uploader`, and `types/index.d.ts`
 * re-exports `./configs` through explicit named blocks rather than `export *`,
 * so `import type { BlokUploader } from '@bloklabs/core'` failed with TS2305
 * and hosts had to hand-copy the shape (which is what forced the mirror in
 * `packages/presets/types/index.d.ts` — see presets-uploader-mirror-law).
 *
 * The law: each of the three names must be in the export set of
 * `types/index.d.ts` AND resolve to the declaration in
 * `types/configs/uploader.d.ts` — a same-named decoy elsewhere in the graph
 * would satisfy membership while still typing consumers against the wrong
 * shape. Both facts come from the TypeScript checker walking the real
 * declaration graph, so a barrel line that exists but drops the name (a
 * shadowed `export *`, a stale named block) still fails.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'types', 'index.d.ts');
const UPLOADER_SOURCE = join(REPO_ROOT, 'types', 'configs', 'uploader.d.ts');

const UPLOADER_TYPE_NAMES = [ 'BlokUploader', 'UploadContext', 'UploadedAsset' ];

const createProgram = (): ts.Program => ts.createProgram([ ENTRY ], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});

describe('uploader types reachable from the package entry', () => {
  const program = createProgram();
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(ENTRY);

  if (source === undefined) {
    throw new Error(`Could not load ${ENTRY}`);
  }

  const moduleSymbol = checker.getSymbolAtLocation(source);

  if (moduleSymbol === undefined) {
    throw new Error('types/index.d.ts is not a module');
  }

  const exports = checker.getExportsOfModule(moduleSymbol);
  const exportedNames = new Set(exports.map((symbol) => symbol.getName()));

  it('exports BlokUploader, UploadContext and UploadedAsset', () => {
    const missing = UPLOADER_TYPE_NAMES.filter((name) => !exportedNames.has(name));

    expect(
      missing,
      'types/index.d.ts does not export these uploader types, so a consumer writing ' +
        '`import type { BlokUploader } from \'@bloklabs/core\'` gets TS2305 and has to ' +
        'hand-copy the shape: ' + missing.join(', ') + '. Add `export * from \'./uploader\';` ' +
        'to types/configs/index.d.ts AND the names to the `} from \'./configs\';` export block ' +
        'in types/index.d.ts — the barrel line alone is not enough, the entry uses named blocks.',
    ).toEqual([]);
  });

  it.each(UPLOADER_TYPE_NAMES)('resolves %s to types/configs/uploader.d.ts', (name) => {
    const exported = exports.find((symbol) => symbol.getName() === name);

    if (exported === undefined) {
      return; // absence is the first test's failure; don't report it twice
    }

    const resolved = (exported.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(exported)
      : exported;
    const declarations = resolved.getDeclarations();

    if (declarations === undefined || declarations.length === 0) {
      throw new Error(`Exported symbol \`${name}\` has no declaration`);
    }

    const declaringFiles = [ ...new Set(declarations.map((declaration) => declaration.getSourceFile().fileName)) ];

    expect(
      declaringFiles,
      `types/index.d.ts exports \`${name}\`, but it resolves to a declaration outside ` +
        'types/configs/uploader.d.ts — consumers would be typed against the wrong shape.',
    ).toEqual([ UPLOADER_SOURCE ]);
  });
});
