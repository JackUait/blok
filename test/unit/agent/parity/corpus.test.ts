// @vitest-environment node
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
  directories: new Map<string, string[]>(),
  contents: new Map<string, string>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();

  return {
    ...actual,
    existsSync: vi.fn((path: unknown) => typeof path === 'string' && files.directories.has(path)),
    readdirSync: vi.fn((path: unknown) => {
      if (typeof path !== 'string' || !files.directories.has(path)) {
        throw new Error('Missing fixture directory');
      }

      return files.directories.get(path) ?? [];
    }),
    readFileSync: vi.fn((path: unknown) => {
      const contents = typeof path === 'string' ? files.contents.get(path) : undefined;

      if (contents === undefined) {
        throw new Error('Missing fixture file');
      }

      return contents;
    }),
  };
});

import {
  CORPUS_ROOT, callerChosenIds, expectationFor, goldenPath, loadParityCases,
} from './corpus';
import type { ParityCase, RunnerName } from './corpus';

const addFile = (directory: 'cases' | 'evals', name: string, fixture: unknown): void => {
  const path = join(CORPUS_ROOT, directory);

  files.directories.set(path, [...(files.directories.get(path) ?? []), name]);
  files.contents.set(join(path, name), JSON.stringify(fixture));
};

const emptyCase: ParityCase = { name: 'empty', seed: { blocks: [] }, batches: [] };
const runners: RunnerName[] = ['editor', 'json', 'store', 'jint', 'room'];

beforeEach(() => {
  vi.clearAllMocks();
  files.directories.clear();
  files.contents.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadParityCases', () => {
  it('returns sorted cases followed by sorted eval references', () => {
    addFile('cases', 'z-last.json', {
      name: 'last', seed: { blocks: [] }, batches: [], expect: { errorCode: 'UNKNOWN_COMMAND' },
    });
    addFile('cases', 'a-first.json', {
      name: 'first',
      seed: { title: 'Seed title', blocks: [{ id: 'seed', type: 'paragraph', data: { text: 'Before' } }] },
      batches: [{ commands: [{ name: 'block.insert', args: { id: 'chosen', data: { text: 'After' } }, ref: 'inserted' }] }],
      expect: 'ok',
    });
    addFile('cases', 'notes.txt', { invalid: 'must not be parsed' });
    addFile('evals', 'z-last.json', {
      id: 'last-eval', seed: { blocks: [] }, reference: [],
    });
    addFile('evals', 'a-first.json', {
      id: 'first-eval', seed: { blocks: [] },
      reference: [{ commands: [{ name: 'unknown.command', args: {} }] }],
      referenceExpectByRunner: { editor: { errorCode: 'UNKNOWN_COMMAND' }, json: 'ok' },
      prompt: 'Eval-only metadata is not a parity field.',
    });

    expect(loadParityCases()).toEqual([
      {
        name: 'first',
        seed: { title: 'Seed title', blocks: [{ id: 'seed', type: 'paragraph', data: { text: 'Before' } }] },
        batches: [{ commands: [{ name: 'block.insert', args: { id: 'chosen', data: { text: 'After' } }, ref: 'inserted' }] }],
        expect: 'ok',
      },
      { name: 'last', seed: { blocks: [] }, batches: [], expect: { errorCode: 'UNKNOWN_COMMAND' } },
      {
        name: 'eval:first-eval', seed: { blocks: [] },
        batches: [{ commands: [{ name: 'unknown.command', args: {} }] }],
        expectByRunner: { editor: { errorCode: 'UNKNOWN_COMMAND' }, json: 'ok' },
      },
      { name: 'eval:last-eval', seed: { blocks: [] }, batches: [], expectByRunner: undefined },
    ]);
  });

  it('excludes eval references when parityExcluded is present, including an empty reason', () => {
    addFile('evals', 'excluded.json', {
      id: 'browser-only', seed: { blocks: [] }, reference: [], parityExcluded: 'Needs a host tool',
    });
    addFile('evals', 'empty-reason.json', {
      id: 'empty-reason', seed: { blocks: [] }, reference: [], parityExcluded: '',
    });
    addFile('evals', 'included.json', {
      id: 'included', seed: { blocks: [] }, reference: [{ commands: [{ name: 'doc.read', args: {} }] }],
    });

    expect(loadParityCases()).toEqual([
      {
        name: 'eval:included', seed: { blocks: [] },
        batches: [{ commands: [{ name: 'doc.read', args: {} }] }], expectByRunner: undefined,
      },
    ]);
  });

  it('loads whichever directory exists without requiring the other', () => {
    expect(loadParityCases()).toEqual([]);
    addFile('cases', 'only.json', { name: 'only-case', seed: { blocks: [] }, batches: [] });
    expect(loadParityCases()).toEqual([{ name: 'only-case', seed: { blocks: [] }, batches: [] }]);
    files.directories.clear();
    addFile('evals', 'only.json', { id: 'only-eval', seed: { blocks: [] }, reference: [] });
    expect(loadParityCases()).toEqual([
      { name: 'eval:only-eval', seed: { blocks: [] }, batches: [], expectByRunner: undefined },
    ]);
  });

  it('rejects malformed case structure instead of casting parsed JSON', () => {
    addFile('cases', 'invalid.json', { name: 'invalid', seed: { blocks: [{ id: 42 }] }, batches: [] });

    expect(() => loadParityCases()).toThrow(/invalid\.json/);
  });

  it('rejects malformed eval references instead of silently loading invalid commands', () => {
    addFile('evals', 'invalid.json', {
      id: 'invalid', seed: { blocks: [] }, reference: [{ commands: [{ name: 'doc.read', args: null }] }],
    });

    expect(() => loadParityCases()).toThrow(/invalid\.json/);
  });
});

describe('expectationFor', () => {
  it.each(runners)('defaults %s to ok', (runner) => {
    expect(expectationFor(emptyCase, runner)).toBe('ok');
  });

  it.each(runners)('falls back to the case expectation for %s', (runner) => {
    expect(expectationFor({ ...emptyCase, expect: { errorCode: 'DEFAULT_ERROR' } }, runner))
      .toEqual({ errorCode: 'DEFAULT_ERROR' });
  });

  it('uses runner-specific ok and error expectations before the case fallback', () => {
    const fixture: ParityCase = {
      ...emptyCase,
      expect: { errorCode: 'DEFAULT_ERROR' },
      expectByRunner: { json: 'ok', jint: { errorCode: 'JINT_ERROR' } },
    };

    expect(runners.map((runner) => expectationFor(fixture, runner))).toEqual([
      { errorCode: 'DEFAULT_ERROR' }, 'ok', { errorCode: 'DEFAULT_ERROR' },
      { errorCode: 'JINT_ERROR' }, { errorCode: 'DEFAULT_ERROR' },
    ]);
  });
});

it('maps corpus names to golden filenames', () => {
  expect(goldenPath('eval:one/two three-4_5')).toBe(join(CORPUS_ROOT, 'goldens', 'eval__one__two__three-4_5.json'));
});

it('keeps only seed block ids and explicit insert ids through children without a type', () => {
  const fixture: ParityCase = {
    name: 'chosen-ids',
    seed: {
      id: 'document-id',
      blocks: [
        { id: 'seed-id', type: 'paragraph', data: { id: 'seed-data-id' } },
        { type: 'paragraph', data: { text: 'No explicit id' } },
      ],
    },
    batches: [{ commands: [
      {
        name: 'block.insert',
        args: {
          id: 'root-id',
          data: { id: 'root-data-id', children: [{ id: 'data-child-id', type: 'paragraph' }] },
          children: [
            { id: 'child-id', data: { id: 'child-data-id' }, children: [{ id: 'grandchild-id' }] },
            { type: 'toggle', children: [{ id: 'through-idless-parent' }] },
            { id: 'typed-child-id', type: 'paragraph' },
          ],
        },
      },
      { name: 'block.insert', args: { id: 'seed-id' } },
      { name: 'block.update', args: { id: 'not-inserted', children: [{ id: 'not-inserted-child' }] } },
    ] }],
  };

  expect([...callerChosenIds(fixture)].sort()).toEqual([
    'child-id', 'grandchild-id', 'root-id', 'seed-id', 'through-idless-parent', 'typed-child-id',
  ]);
});
