/**
 * Architectural enforcement: the published `Blok` class type must expose the
 * whole `API` surface.
 *
 * At runtime `Blok.exportAPI()` does `Object.setPrototypeOf(this, apiMethods)`,
 * so every namespace tools receive through `api.*` is reachable straight off the
 * editor instance (`editor.uploader`, `editor.marks`, `editor.notifier`, …).
 * The hand-authored `types/index.d.ts` used to list those namespaces on the
 * class BY HAND, so each new API namespace silently drifted out of the public
 * class typings: `uploader` landed in 1.5.0 on the `API` interface only, and
 * consumers who called `editor.uploader.uploadByFile(...)` — a call that works
 * perfectly at runtime — had to write a narrowing cast to get past `tsc`.
 * `marks`, `events`, `listeners`, `notifier`, `ui`, `config` and
 * `rectangleSelection` had drifted the same way.
 *
 * The law: every member of `API` must be present on the `Blok` instance type,
 * with the same type — except members the class deliberately WIDENS (`i18n`,
 * where the editor gets `EditorI18n`, a superset of the tool-facing `I18n`).
 *
 * Keep this satisfied by declaration merging (`interface Blok extends
 * Omit<API, …>`), not by hand-copying members — hand-copying is what drifted.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'types', 'index.d.ts');

/**
 * Members the `Blok` class is allowed to declare with a DIFFERENT (wider) type
 * than the tool-facing `API` interface. Each needs a reason.
 */
const WIDENED_MEMBERS = new Map<string, string>([
  [ 'i18n', 'editor gets EditorI18n (I18n + update()), tools only get I18n' ],
]);

const createProgram = (): ts.Program => ts.createProgram([ ENTRY ], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});

const collectPropertyNames = (checker: ts.TypeChecker, type: ts.Type): Set<string> =>
  new Set(checker.getPropertiesOfType(type).map((symbol) => symbol.getName()));

describe('Blok class / API parity law', () => {
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
  const findExport = (name: string): ts.Symbol => {
    const found = exports.find((symbol) => symbol.getName() === name);

    if (found === undefined) {
      throw new Error(`types/index.d.ts does not export \`${name}\``);
    }

    return found;
  };

  const apiType = checker.getDeclaredTypeOfSymbol(findExport('API'));
  const blokSymbol = findExport('Blok');
  const blokType = checker.getDeclaredTypeOfSymbol(blokSymbol);

  it('exposes every API namespace on the Blok instance type', () => {
    const apiMembers = [ ...collectPropertyNames(checker, apiType) ]
      .filter((name) => name !== 'eventsDispatcher');
    const blokMembers = collectPropertyNames(checker, blokType);

    const missing = apiMembers.filter((name) => !blokMembers.has(name));

    expect(missing).toEqual([]);
  });

  it('does not silently narrow or re-type shared API members', () => {
    const mismatched = checker.getPropertiesOfType(apiType)
      .filter((apiMember) => !WIDENED_MEMBERS.has(apiMember.getName()))
      .filter((apiMember) => {
        const blokMember = checker.getPropertyOfType(blokType, apiMember.getName());

        if (blokMember === undefined) {
          return false; // reported by the previous test
        }

        const apiMemberType = checker.getTypeOfSymbol(apiMember);
        const blokMemberType = checker.getTypeOfSymbol(blokMember);

        return checker.typeToString(apiMemberType) !== checker.typeToString(blokMemberType);
      })
      .map((apiMember) => apiMember.getName());

    expect(mismatched).toEqual([]);
  });

  it('documents every deliberately widened member', () => {
    const undocumented = [ ...WIDENED_MEMBERS.entries() ]
      .filter(([ , reason ]) => reason.trim().length === 0)
      .map(([ name ]) => name);

    expect(undocumented).toEqual([]);
  });

  it('keeps the parity by declaration merging, not hand-copied members', () => {
    const declaration = readFileSync(ENTRY, 'utf-8');

    expect(declaration).toMatch(/export interface Blok extends Omit<API,/);
  });
});
