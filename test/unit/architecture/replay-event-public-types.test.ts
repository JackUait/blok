import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONSUMER = join(REPO_ROOT, 'types', 'replay-event-public-types.consumer.ts');

describe('Replay event public types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['@bloklabs/core', 'types/index.d.ts'],
    ['@bloklabs/core/full', 'types/full.d.ts'],
  ])('types replay callbacks from %s without changing exhaustive event maps', (packageName, entryPath) => {
    const entry = resolve(REPO_ROOT, entryPath);
    const consumerSource = `
import { BlockReplayed } from '${packageName}';
import type {
  API, BlokEditorEventMap, BlockMutationType,
  BlockReplayCapture, BlockReplayChange, BlockReplayNative,
} from '${packageName}';

type IsAny<T> = 0 extends (1 & T) ? true : false;

export const lifecycleMap: Record<keyof BlokEditorEventMap, number> = {
  'block:rendered': 1,
  'blocks:rendered': 2,
  'block:childrenMounted': 3,
  'i18n:changed': 4,
  'setting:changed': 5,
  'collaboration:status': 6,
};
export const mutationMap: Record<BlockMutationType, number> = {
  'block-added': 1,
  'block-removed': 2,
  'block-moved': 3,
  'block-changed': 4,
};

const native: BlockReplayNative = {
  type: 'database-row',
  parent: { present: true, value: 'db' },
  template: { present: false },
};
const change: BlockReplayChange = {
  path: ['properties', 'notes'],
  beforePresent: true,
  afterPresent: true,
  after: 'retained',
};
const record: BlockReplayCapture = {
  blockId: 'row',
  type: 'update',
  origin: 'undo',
  scope: 'keys',
  native,
  changes: [change],
};
const eventName: 'block replayed' = BlockReplayed;

export function observe(api: API): void {
  api.events.on(eventName, (capture) => {
    const inferred: IsAny<typeof capture> = false;
    const observed: BlockReplayCapture = capture;
    const path: readonly (string | number)[] = observed.changes[0]?.path ?? [];
    const identity: BlockReplayNative | undefined = observed.native;
    void inferred;
    void path;
    void identity;
  });
  api.events.off('block replayed', (capture) => {
    const inferred: IsAny<typeof capture> = false;
    const observed: BlockReplayCapture = capture;
    void inferred;
    void observed;
  });
  api.events.emit(eventName, record);
  api.events.emit('block:rendered', { blockId: 'row' });
  api.events.emit('custom-host-event', 42);
}
`;
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      // Skips only TypeScript's own lib files, so the test fits the default timeout in CI.
      // The types/ files are still checked, because skipLibCheck is false.
      skipDefaultLibCheck: true,
      types: [],
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { [packageName]: [entry] },
    };
    const baseHost = ts.createCompilerHost(options);
    const consumerHost: ts.CompilerHost = {
      ...baseHost,
      fileExists: (fileName) => fileName === CONSUMER || baseHost.fileExists(fileName),
      readFile: (fileName) => fileName === CONSUMER ? consumerSource : baseHost.readFile(fileName),
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
        fileName === CONSUMER
          ? ts.createSourceFile(fileName, consumerSource, languageVersion, true)
          : baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
    };
    const program = ts.createProgram([entry, CONSUMER], options, consumerHost);
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
