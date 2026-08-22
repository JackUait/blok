/**
 * Architectural enforcement: `@bloklabs/presets`' hand-mirrored uploader
 * types must not drift from their sources.
 *
 * `packages/presets/types/index.d.ts` hand-copies `AssetKind`,
 * `UploadedAsset`, `UploadContext` and `BlokUploader` instead of importing
 * them, because a published `.d.ts` may not reach outside its own tarball
 * (`files: ["dist", "types"]` — see published-types-no-src-refs.test.ts) and
 * this package declares zero runtime dependencies, so it cannot import
 * `@bloklabs/core`'s published types either. That leaves the mirror correct
 * only until someone edits the source and forgets the copy — exactly what
 * happened to `types/data-attributes.d.ts`, which silently lost 17 of its
 * ~110 attributes (plus one phantom key) through hand transcription before it
 * was caught (see the `types/data-attributes.d.ts stays in sync` describe
 * block in published-types-no-src-refs.test.ts).
 *
 * The law: for each mirrored declaration, its STRUCTURE — member names,
 * optionality, and member types, as checked by the TypeScript compiler
 * itself — must equal its source's. Doc comments, whitespace, and member
 * order are irrelevant: comparison goes through `ts.TypeChecker`, not text,
 * so reformatting a comment or reordering fields cannot fail this test —
 * only a real structural difference (a renamed/added/removed field, a
 * changed type, or a flipped `?`) can.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MIRROR_FILE = join(REPO_ROOT, 'packages', 'presets', 'types', 'index.d.ts');
const UPLOADER_SOURCE = join(REPO_ROOT, 'types', 'configs', 'uploader.d.ts');
const BLOCK_TOOL_SOURCE = join(REPO_ROOT, 'types', 'tools', 'block-tool.d.ts');

const MIRROR_LABEL = 'packages/presets/types/index.d.ts';
const UPLOADER_LABEL = 'types/configs/uploader.d.ts';
const BLOCK_TOOL_LABEL = 'types/tools/block-tool.d.ts';

interface MemberFingerprint {
  name: string;
  optional: boolean;
  type: string;
}

const createProgram = (): ts.Program => ts.createProgram([ MIRROR_FILE, UPLOADER_SOURCE, BLOCK_TOOL_SOURCE ], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});

function loadSource(program: ts.Program, file: string): ts.SourceFile {
  const source = program.getSourceFile(file);

  if (source === undefined) {
    throw new Error(`Could not load ${file}`);
  }

  return source;
}

/**
 * Find a top-level `interface Name { … }`, whether exported or not — the
 * mirrors in packages/presets/types/index.d.ts are deliberately unexported
 * (see that file's header comment).
 */
function findInterface(source: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  const found = source.statements.find(
    (stmt): stmt is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(stmt) && stmt.name.text === name
  );

  if (found === undefined) {
    throw new Error(`Could not find \`interface ${name}\` in ${source.fileName}`);
  }

  return found;
}

/** Find a top-level `type Name = …`, whether exported or not. */
function findTypeAlias(source: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  const found = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name
  );

  if (found === undefined) {
    throw new Error(`Could not find \`type ${name}\` in ${source.fileName}`);
  }

  return found;
}

/** Structural fingerprint of an interface's own members: name, optionality, checked type. */
function fingerprintInterface(checker: ts.TypeChecker, decl: ts.InterfaceDeclaration): MemberFingerprint[] {
  const symbol = checker.getSymbolAtLocation(decl.name);

  if (symbol === undefined) {
    throw new Error(`\`${decl.name.text}\` in ${decl.getSourceFile().fileName} has no symbol`);
  }

  const type = checker.getDeclaredTypeOfSymbol(symbol);

  return checker.getPropertiesOfType(type)
    .map((member) => ({
      name: member.getName(),
      optional: (member.flags & ts.SymbolFlags.Optional) !== 0,
      type: checker.typeToString(checker.getTypeOfSymbol(member)),
    }))
    // Member order in an object type carries no meaning, so sort before
    // comparing — reordering a mirror's fields must not read as drift.
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Structural fingerprint of a union type alias: its member types, order-independent. */
function fingerprintUnion(checker: ts.TypeChecker, decl: ts.TypeAliasDeclaration): string[] {
  const symbol = checker.getSymbolAtLocation(decl.name);

  if (symbol === undefined) {
    throw new Error(`\`${decl.name.text}\` in ${decl.getSourceFile().fileName} has no symbol`);
  }

  const type = checker.getDeclaredTypeOfSymbol(symbol);

  if (!type.isUnion()) {
    throw new Error(`\`${decl.name.text}\` in ${decl.getSourceFile().fileName} is not a union type`);
  }

  return type.types.map((member) => checker.typeToString(member)).sort();
}

describe('presets uploader-type mirrors stay in sync with their sources', () => {
  const program = createProgram();
  const checker = program.getTypeChecker();
  const mirrorSource = loadSource(program, MIRROR_FILE);
  const uploaderSource = loadSource(program, UPLOADER_SOURCE);
  const blockToolSource = loadSource(program, BLOCK_TOOL_SOURCE);

  // sourceLabel comes before sourceFile: it.each's `%s` title placeholders
  // consume tuple entries positionally, and a raw ts.SourceFile stringifies
  // into an unreadable AST dump if a placeholder lands on it.
  const interfaceCases: ReadonlyArray<readonly [ name: string, sourceLabel: string, sourceFile: ts.SourceFile ]> = [
    [ 'UploadedAsset', UPLOADER_LABEL, uploaderSource ],
    [ 'UploadContext', UPLOADER_LABEL, uploaderSource ],
    [ 'BlokUploader', UPLOADER_LABEL, uploaderSource ],
  ];

  it.each(interfaceCases)('`%s` mirrors its declaration in %s', (name, sourceLabel, sourceFile) => {
    const mirrorFingerprint = fingerprintInterface(checker, findInterface(mirrorSource, name));
    const sourceFingerprint = fingerprintInterface(checker, findInterface(sourceFile, name));

    expect(
      mirrorFingerprint,
      `\`${name}\` in ${MIRROR_LABEL} has drifted from its source in ${sourceLabel} — ` +
        'compare both copies and update the mirror to match.'
    ).toEqual(sourceFingerprint);
  });

  it('`AssetKind` mirrors its declaration in types/tools/block-tool.d.ts', () => {
    const mirrorFingerprint = fingerprintUnion(checker, findTypeAlias(mirrorSource, 'AssetKind'));
    const sourceFingerprint = fingerprintUnion(checker, findTypeAlias(blockToolSource, 'AssetKind'));

    expect(
      mirrorFingerprint,
      `\`AssetKind\` in ${MIRROR_LABEL} has drifted from its source in ${BLOCK_TOOL_LABEL} — ` +
        'compare both copies and update the mirror to match.'
    ).toEqual(sourceFingerprint);
  });
});
