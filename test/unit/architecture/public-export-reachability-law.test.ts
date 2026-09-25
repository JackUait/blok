/**
 * Architectural enforcement: three surfaces hosts were hand-copying must stay
 * reachable from the PUBLISHED declaration entries, not just from `src/`.
 *
 * The build emits no `.d.ts` (see the Published-types law), so a runtime export
 * added in `src/` is invisible to a consumer's `tsc` until the matching
 * hand-authored declaration lands in `types/`. This law walks the real
 * declaration graph with the TypeScript checker, so a barrel line that exists
 * but drops the name still fails.
 *
 * `EMBED_SERVICES` is deliberately absent: the ~1700-line registry data is an
 * implementation detail whose keys, regexes and embed templates track provider
 * changes. `matchEmbedService` + `buildEmbedUrl` give a host the same result a
 * live paste produces without freezing the data shape as public API.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

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

  if (source === undefined) {
    throw new Error(`Could not load ${entry}`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);

  if (moduleSymbol === undefined) {
    throw new Error(`${entry} is not a module`);
  }

  return new Set(checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName()));
};

/** Literal members of a `type X = 'a' | 'b'` union declared in a file, sorted. */
const unionMembers = (file: string, typeName: string): string[] => {
  const program = ts.createProgram([ file ], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(file);

  if (source === undefined) {
    throw new Error(`Could not load ${file}`);
  }

  const checker = program.getTypeChecker();
  const declaration = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName
  );

  if (declaration === undefined) {
    throw new Error(`${file} declares no type alias \`${typeName}\``);
  }

  const type = checker.getTypeAtLocation(declaration.type);

  return (type.isUnion() ? type.types : [ type ])
    .map((member) => checker.typeToString(member))
    .sort();
};

describe('embed registry declared on the ./tools entry', () => {
  const exported = exportedNamesOf(join(REPO_ROOT, 'types', 'tools-entry.d.ts'));

  it.each([ 'matchEmbedService', 'buildEmbedUrl', 'EmbedMatch', 'EmbedServiceType' ])(
    'types/tools-entry.d.ts exports %s',
    (name) => {
      expect(exported.has(name)).toBe(true);
    }
  );

  it('does NOT publish the EMBED_SERVICES data structure', () => {
    expect(exported.has('EMBED_SERVICES')).toBe(false);
  });

  // EmbedServiceType is hand-transcribed into types/ (the Published-types law
  // forbids re-exporting from src/), so pin both copies against each other.
  it('keeps the published EmbedServiceType union identical to the registry one', () => {
    const published = unionMembers(
      join(REPO_ROOT, 'types', 'tools', 'embed.d.ts'),
      'EmbedServiceType'
    );
    const source = unionMembers(
      join(REPO_ROOT, 'src', 'tools', 'link', 'registry.ts'),
      'EmbedServiceType'
    );

    expect(published).toEqual(source);
  });
});

describe('emoji picker preload declared on the ./tools entry', () => {
  it('types/tools-entry.d.ts exports preloadEmojiData', () => {
    expect(exportedNamesOf(join(REPO_ROOT, 'types', 'tools-entry.d.ts')).has('preloadEmojiData')).toBe(true);
  });
});

describe('mutation-type constants declared on the core entry', () => {
  const exported = exportedNamesOf(join(REPO_ROOT, 'types', 'index.d.ts'));

  it.each([
    'BlockAddedMutationType',
    'BlockRemovedMutationType',
    'BlockMovedMutationType',
    'BlockChangedMutationType',
  ])('types/index.d.ts exports %s', (name) => {
    expect(exported.has(name)).toBe(true);
  });
});

describe('USE_BLOK_CONFIG_KEYS declared on the @bloklabs/react entry', () => {
  const exported = exportedNamesOf(join(REPO_ROOT, 'packages', 'react', 'types', 'index.d.ts'));

  it('packages/react/types/index.d.ts exports USE_BLOK_CONFIG_KEYS', () => {
    expect(exported.has('USE_BLOK_CONFIG_KEYS')).toBe(true);
  });
});
