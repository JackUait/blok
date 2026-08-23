/**
 * Architectural enforcement: `@bloklabs/presets`' hand-mirrored uploader
 * types must not drift from their sources.
 *
 * `packages/presets/types/index.d.ts` hand-copies `AssetKind`,
 * `UploadedAsset`, `UploadContext`, `BlokUploader`, and each preset's own
 * option interfaces (`FetchStorageOptions`, `SupabaseLike`,
 * `SupabaseStorageOptions`, `SignRequest`, `SignedTarget`,
 * `PresignedStorageOptions`, `CloudinaryStorageOptions`,
 * `IndexedDBStorageOptions`) instead of importing them, because a published
 * `.d.ts` may not reach outside its own tarball (`files: ["dist", "types"]`
 * — see published-types-no-src-refs.test.ts) and this package declares zero
 * runtime dependencies, so it cannot import `@bloklabs/core`'s published
 * types either. That leaves the mirror correct only until someone edits the
 * source and forgets the copy — exactly what happened to
 * `types/data-attributes.d.ts`, which silently lost 17 of its ~110
 * attributes (plus one phantom key) through hand transcription before it was
 * caught (see the `types/data-attributes.d.ts stays in sync` describe block
 * in published-types-no-src-refs.test.ts).
 *
 * The law: for each mirrored declaration, its STRUCTURE — member names,
 * optionality, and member types, as checked by the TypeScript compiler
 * itself — must equal its source's. Doc comments, whitespace, and member
 * order are irrelevant: comparison goes through `ts.TypeChecker`, not text,
 * so reformatting a comment or reordering fields cannot fail this test —
 * only a real structural difference (a renamed/added/removed field, a
 * changed type, or a flipped `?`) can.
 *
 * A second law: every value `packages/presets/src/index.ts` exports at
 * runtime must have a matching `export function` in the mirror — otherwise
 * a new preset can ship with CI green while every consumer's `tsc` fails
 * with TS2305 on the missing declaration.
 *
 * A third law guards the first one against its own hand-curation: every
 * interface and type alias declared in the mirror file must appear in one of
 * the case lists below, or in `COVERAGE_OPT_OUTS` with a reason. Without it a
 * ninth preset's options interface ships unguarded and is free to drift
 * forever with CI green — the same silent transcription rot that cost
 * `types/data-attributes.d.ts` 17 keys. The case lists stay hand-written on
 * purpose: a mirror's name cannot be resolved to its source file without
 * guessing among the six candidates below, and a wrong guess would pair a
 * mirror with the wrong source and check nothing. So the failure is loud and
 * names the type; a human adds the entry with the correct source.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PRESETS_SRC = join(REPO_ROOT, 'packages', 'presets', 'src');
const MIRROR_FILE = join(REPO_ROOT, 'packages', 'presets', 'types', 'index.d.ts');
const UPLOADER_SOURCE = join(REPO_ROOT, 'types', 'configs', 'uploader.d.ts');
const BLOCK_TOOL_SOURCE = join(REPO_ROOT, 'types', 'tools', 'block-tool.d.ts');
const FETCH_ENDPOINT_SOURCE = join(PRESETS_SRC, 'fetch-endpoint.ts');
const SUPABASE_SOURCE = join(PRESETS_SRC, 'supabase.ts');
const PRESIGNED_SOURCE = join(PRESETS_SRC, 'presigned.ts');
const CLOUDINARY_SOURCE = join(PRESETS_SRC, 'cloudinary.ts');
const INDEXEDDB_SOURCE = join(PRESETS_SRC, 'indexeddb.ts');
const INDEX_SOURCE = join(PRESETS_SRC, 'index.ts');

const MIRROR_LABEL = 'packages/presets/types/index.d.ts';
const UPLOADER_LABEL = 'types/configs/uploader.d.ts';
const BLOCK_TOOL_LABEL = 'types/tools/block-tool.d.ts';
const FETCH_ENDPOINT_LABEL = 'packages/presets/src/fetch-endpoint.ts';
const SUPABASE_LABEL = 'packages/presets/src/supabase.ts';
const PRESIGNED_LABEL = 'packages/presets/src/presigned.ts';
const CLOUDINARY_LABEL = 'packages/presets/src/cloudinary.ts';
const INDEXEDDB_LABEL = 'packages/presets/src/indexeddb.ts';
const INDEX_LABEL = 'packages/presets/src/index.ts';

interface CoverageOptOut {
  name: string;
  reason: string;
}

/**
 * Types the mirror file declares that mirror nothing — the presets package
 * owns them outright, so there is no source declaration to drift from. Every
 * entry must say WHY: opting out a type that IS copied from somewhere else
 * silences the law instead of satisfying it. Empty today, because every type
 * currently declared in the mirror file is a copy of one declared elsewhere.
 */
const COVERAGE_OPT_OUTS: readonly CoverageOptOut[] = [];

interface MemberFingerprint {
  name: string;
  optional: boolean;
  type: string;
}

const createProgram = (): ts.Program => ts.createProgram([
  MIRROR_FILE,
  UPLOADER_SOURCE,
  BLOCK_TOOL_SOURCE,
  FETCH_ENDPOINT_SOURCE,
  SUPABASE_SOURCE,
  PRESIGNED_SOURCE,
  CLOUDINARY_SOURCE,
  INDEXEDDB_SOURCE,
  INDEX_SOURCE,
], {
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
      // NoTruncation matters here: `SupabaseLike`'s nested callback shape is
      // long enough that the default printer collapses its tail to `{ ... }`
      // — both sides would still fingerprint identically with a field
      // renamed inside that tail, which is a drift test that cannot fail.
      type: checker.typeToString(checker.getTypeOfSymbol(member), undefined, ts.TypeFormatFlags.NoTruncation),
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
  const fetchEndpointSource = loadSource(program, FETCH_ENDPOINT_SOURCE);
  const supabaseSource = loadSource(program, SUPABASE_SOURCE);
  const presignedSource = loadSource(program, PRESIGNED_SOURCE);
  const cloudinarySource = loadSource(program, CLOUDINARY_SOURCE);
  const indexeddbSource = loadSource(program, INDEXEDDB_SOURCE);

  // sourceLabel comes before sourceFile: it.each's `%s` title placeholders
  // consume tuple entries positionally, and a raw ts.SourceFile stringifies
  // into an unreadable AST dump if a placeholder lands on it.
  const interfaceCases: ReadonlyArray<readonly [ name: string, sourceLabel: string, sourceFile: ts.SourceFile ]> = [
    [ 'UploadedAsset', UPLOADER_LABEL, uploaderSource ],
    [ 'UploadContext', UPLOADER_LABEL, uploaderSource ],
    [ 'BlokUploader', UPLOADER_LABEL, uploaderSource ],
    [ 'FetchStorageOptions', FETCH_ENDPOINT_LABEL, fetchEndpointSource ],
    [ 'SupabaseLike', SUPABASE_LABEL, supabaseSource ],
    [ 'SupabaseStorageOptions', SUPABASE_LABEL, supabaseSource ],
    [ 'SignRequest', PRESIGNED_LABEL, presignedSource ],
    [ 'SignedTarget', PRESIGNED_LABEL, presignedSource ],
    [ 'PresignedStorageOptions', PRESIGNED_LABEL, presignedSource ],
    [ 'CloudinaryStorageOptions', CLOUDINARY_LABEL, cloudinarySource ],
    [ 'IndexedDBStorageOptions', INDEXEDDB_LABEL, indexeddbSource ],
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

  const unionCases: ReadonlyArray<readonly [ name: string, sourceLabel: string, sourceFile: ts.SourceFile ]> = [
    [ 'AssetKind', BLOCK_TOOL_LABEL, blockToolSource ],
  ];

  it.each(unionCases)('`%s` mirrors its declaration in %s', (name, sourceLabel, sourceFile) => {
    const mirrorFingerprint = fingerprintUnion(checker, findTypeAlias(mirrorSource, name));
    const sourceFingerprint = fingerprintUnion(checker, findTypeAlias(sourceFile, name));

    expect(
      mirrorFingerprint,
      `\`${name}\` in ${MIRROR_LABEL} has drifted from its source in ${sourceLabel} — ` +
        'compare both copies and update the mirror to match.'
    ).toEqual(sourceFingerprint);
  });

  // Guards the two case lists above, which are hand-curated: a mirror nobody
  // listed is a mirror nothing checks.
  it('every type the mirror file declares is covered by a case above', () => {
    const covered = new Set<string>([
      ...interfaceCases.map(([ name ]) => name),
      ...unionCases.map(([ name ]) => name),
      ...COVERAGE_OPT_OUTS.map((optOut) => optOut.name),
    ]);

    const uncovered = mirrorSource.statements
      .filter((stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
        ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
      )
      .map((stmt) => stmt.name.text)
      .filter((name) => !covered.has(name));

    expect(
      uncovered,
      `${MIRROR_LABEL} declares ${uncovered.join(', ')}, which this law neither checks for drift nor ` +
        'exempts. Add an entry to `interfaceCases` or `unionCases` naming the file the type is mirrored ' +
        'FROM, or — if the presets package owns the type outright and there is no source to drift from — ' +
        'add a `COVERAGE_OPT_OUTS` entry with a reason.'
    ).toEqual([]);
  });

  it('every function exported at runtime from src/index.ts is declared in the published types, and vice versa', () => {
    const indexSource = loadSource(program, INDEX_SOURCE);
    const indexModule = checker.getSymbolAtLocation(indexSource);
    const mirrorModule = checker.getSymbolAtLocation(mirrorSource);

    if (indexModule === undefined) {
      throw new Error(`${INDEX_LABEL} has no module symbol`);
    }
    if (mirrorModule === undefined) {
      throw new Error(`${MIRROR_LABEL} has no module symbol`);
    }

    const runtimeExports = checker.getExportsOfModule(indexModule).map((symbol) => symbol.getName()).sort();

    // Filtered to FunctionDeclaration exports: the mirror also exports the
    // eight option interfaces, which have no runtime counterpart in
    // src/index.ts and would otherwise break a plain set comparison.
    const publishedFunctionExports = checker.getExportsOfModule(mirrorModule)
      .filter((symbol) => symbol.declarations?.some((declaration) => ts.isFunctionDeclaration(declaration)) ?? false)
      .map((symbol) => symbol.getName())
      .sort();

    expect(
      publishedFunctionExports,
      `${INDEX_LABEL}'s runtime exports and ${MIRROR_LABEL}'s declared functions have drifted — ` +
        'a preset added to one and not the other leaves CI green while consumers hit TS2305.'
    ).toEqual(runtimeExports);
  });
});
