// @vitest-environment node
import { createHash } from 'node:crypto';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { createFilesSource } from '../../../src/mcp/sources/files';
import type { DocumentSource } from '../../../src/mcp/sources/types';
import { assertDocumentShape } from '../../../src/mcp/sources/types';

const FIXTURE_PARENT = tmpdir();
const FIXTURE_PREFIX = 'blok-mcp-task10-files-';

const codeOf = async (operation: () => unknown): Promise<string | undefined> => {
  try {
    await operation();

    return undefined;
  } catch (thrown: unknown) {
    return isMcpSurfaceError(thrown) ? thrown.agentError.code : `Non-surface error: ${String(thrown)}`;
  }
};

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertDocumentShape', () => {
  const accepted: Array<{ label: string; value: unknown }> = [
    { label: 'an object with an empty blocks array', value: { blocks: [] } },
    {
      label: 'an object without validating block entries or other fields',
      value: { blocks: [null, 7, 'unchecked', {}], title: 42, extra: true },
    },
  ];

  it.each(accepted)('accepts $label', ({ value }) => {
    expect(() => assertDocumentShape(value, 'fixture.json')).not.toThrow();
  });

  const rejected: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'a boolean', value: false },
    { label: 'a number', value: 0 },
    { label: 'a string', value: '{"blocks":[]}' },
    { label: 'an array', value: [] },
    { label: 'an array with a blocks property', value: Object.assign([], { blocks: [] }) },
    { label: 'an object without blocks', value: {} },
    { label: 'an object with null blocks', value: { blocks: null } },
    { label: 'an object with object blocks', value: { blocks: {} } },
    { label: 'an object with string blocks', value: { blocks: '[]' } },
  ];

  it.each(rejected)('rejects $label with SOURCE_UNAVAILABLE', async ({ value }) => {
    expect(await codeOf(() => assertDocumentShape(value, 'fixture.json'))).toBe('SOURCE_UNAVAILABLE');
  });
});

describe('files source', () => {
  let root = '';
  let dir = '';

  beforeEach(() => {
    root = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    // The parent owns the rejected ../escape path too.
    dir = join(root, 'documents');
    mkdirSync(dir);
  });

  afterEach(() => {
    try {
      if (root === '') {
        return;
      }
      if (dirname(root) !== FIXTURE_PARENT || !basename(root).startsWith(FIXTURE_PREFIX)) {
        throw new Error('Refusing to remove an unrelated fixture directory');
      }
      rmSync(root, { recursive: true, force: true });
    } finally {
      root = '';
      dir = '';
    }
  });

  it('loads a missing document as empty with no version, marked missing', async () => {
    expect(await createFilesSource(dir).load('fresh')).toEqual({ raw: { blocks: [] }, version: null, missing: true });
  });

  it('loads stored data unchanged with the SHA-256 of its file bytes', async () => {
    const text = '{ "blocks": [ { "id": "a", "type": "paragraph", "data": { "text": "<b>hi</b>" } } ] }\n';

    writeFileSync(join(dir, 'doc.json'), text);
    expect(await createFilesSource(dir).load('doc')).toEqual({
      raw: { blocks: [{ id: 'a', type: 'paragraph', data: { text: '<b>hi</b>' } }] },
      version: sha(text),
    });
  });

  const malformed: Array<{ label: string; text: string }> = [
    { label: 'invalid JSON', text: '{blocks' },
    { label: 'an array', text: '[]' },
    { label: 'an object without blocks', text: '{}' },
    { label: 'an object with non-array blocks', text: '{"blocks":{}}' },
  ];

  it.each(malformed)('refuses $label with SOURCE_UNAVAILABLE', async ({ text }) => {
    writeFileSync(join(dir, 'bad.json'), text);
    expect(await codeOf(() => createFilesSource(dir).load('bad'))).toBe('SOURCE_UNAVAILABLE');
  });

  it.each(['-x3kQ9aB2c', '_x3kQ9aB2c'])('stores nanoid id %j, which may start with "-" or "_"', async (id: string) => {
    const source = createFilesSource(dir);
    const { version } = await source.save(id, { blocks: [], title: 't' }, { ifVersion: null });

    expect(await source.load(id)).toEqual({ raw: { blocks: [], title: 't' }, version });
    expect((await source.list?.({ limit: 10 }))?.documents.map((doc) => doc.id)).toEqual([id]);
  });

  it.each(['../escape', 'a/b', '', '.', '..', '%2e%2e', 'x'.repeat(201), '.hidden'])(
    'rejects id %j with INVALID_ARGS and leaves fixture directory entries unchanged',
    async (id: string) => {
      const source = createFilesSource(dir);

      expect(await codeOf(() => source.load(id))).toBe('INVALID_ARGS');
      expect(await codeOf(() => source.save(id, { blocks: [] }, { ifVersion: null }))).toBe('INVALID_ARGS');
      expect(readdirSync(dir)).toEqual([]);
      expect(readdirSync(root)).toEqual(['documents']);
    },
  );

  it('saves the document, returns its byte hash, and leaves only the final file', async () => {
    const source = createFilesSource(dir);
    const { version } = await source.save('doc', { blocks: [] }, { ifVersion: null });
    const bytes = readFileSync(join(dir, 'doc.json'));
    const written: unknown = JSON.parse(bytes.toString('utf-8'));

    expect(written).toEqual({ blocks: [] });
    expect(version).toBe(sha(bytes));
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('chains versions across saves', async () => {
    const source = createFilesSource(dir);
    const first = await source.save('doc', { blocks: [] }, { ifVersion: null });
    const updated = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] };
    const second = await source.save('doc', updated, { ifVersion: first.version });
    const bytes = readFileSync(join(dir, 'doc.json'));
    const written: unknown = JSON.parse(bytes.toString('utf-8'));

    expect(second.version).not.toBe(first.version);
    expect(second.version).toBe(sha(bytes));
    expect(written).toEqual(updated);
  });

  it('refuses a stale save with DOCUMENT_CHANGED after a same-byte-size edit', async () => {
    const source = createFilesSource(dir);
    const { version } = await source.save('doc', { blocks: [], title: 'aaaa' }, { ifVersion: null });
    const path = join(dir, 'doc.json');
    const original = readFileSync(path);
    const external = Buffer.from(original.toString('utf-8').replace('aaaa', 'bbbb'), 'utf-8');

    writeFileSync(path, external);
    expect(await codeOf(() => source.save('doc', { blocks: [] }, { ifVersion: version }))).toBe('DOCUMENT_CHANGED');
    expect(external.byteLength).toBe(original.byteLength);
    expect(external).not.toEqual(original);
    expect(readFileSync(path)).toEqual(external);
  });

  it('refuses a first save when the file appeared meanwhile', async () => {
    const text = '{"blocks":[]}';

    writeFileSync(join(dir, 'doc.json'), text);
    expect(await codeOf(() => createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null })))
      .toBe('DOCUMENT_CHANGED');
    expect(readFileSync(join(dir, 'doc.json'), 'utf-8')).toBe(text);
  });

  it('refuses to list a missing directory with SOURCE_UNAVAILABLE', async () => {
    const list = createFilesSource(join(dir, 'missing')).list;

    if (list === undefined) {
      throw new Error('The files source must support list');
    }

    expect(await codeOf(() => list({ limit: 2 }))).toBe('SOURCE_UNAVAILABLE');
  });

  // Windows opens a device, not a file, for these names with any extension.
  it.each(['CON', 'con', 'nul', 'Aux', 'PRN', 'COM1', 'lpt9', 'nul.backup', 'CON.x'])(
    'rejects Windows device name %j with INVALID_ARGS',
    async (id: string) => {
      const source = createFilesSource(dir);

      expect(await codeOf(() => source.load(id))).toBe('INVALID_ARGS');
      expect(await codeOf(() => source.save(id, { blocks: [] }, { ifVersion: null }))).toBe('INVALID_ARGS');
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it.each(['console', 'nully', 'com10', 'lpt', 'acon'])('stores id %j, which only looks like a device name', async (id: string) => {
    const source = createFilesSource(dir);

    await source.save(id, { blocks: [] }, { ifVersion: null });
    expect(readdirSync(dir)).toEqual([`${id}.json`]);
  });

  it('lists documents with titles, filtered and paged', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ blocks: [], title: 'Alpha plan' }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ blocks: [] }));
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ blocks: [], title: 'Gamma plan' }));
    writeFileSync(join(dir, 'notes.txt'), 'skip');
    const source = createFilesSource(dir);

    if (source.list === undefined) {
      throw new Error('The files source must support list');
    }

    expect(await source.list({ limit: 2 })).toEqual({
      documents: [{ id: 'a', title: 'Alpha plan' }, { id: 'b', title: null }],
      nextCursor: 'b',
    });
    expect(await source.list({ limit: 2, cursor: 'b' })).toEqual({
      documents: [{ id: 'c', title: 'Gamma plan' }],
      nextCursor: null,
    });
    expect((await source.list({ limit: 10, query: 'PLAN' })).documents.map((document) => document.id))
      .toEqual(['a', 'c']);
  });
  const messageOf = async (operation: () => unknown): Promise<string> => {
    try {
      await operation();

      return '';
    } catch (thrown: unknown) {
      return isMcpSurfaceError(thrown) ? thrown.agentError.message : `Non-surface error: ${String(thrown)}`;
    }
  };

  it('keeps every edit when two saves of one document race', async () => {
    const source = createFilesSource(dir);
    let { version } = await source.save('doc', { blocks: [] }, { ifVersion: null });

    for (let round = 0; round < 10; round += 1) {
      const first = { blocks: [], title: `first ${round}` };
      const second = { blocks: [], title: `second ${round}` };
      const outcomes = await Promise.allSettled([
        source.save('doc', first, { ifVersion: version }),
        source.save('doc', second, { ifVersion: version }),
      ]);
      const winners = outcomes.flatMap((outcome, index) => (outcome.status === 'fulfilled'
        ? [{ document: index === 0 ? first : second, version: outcome.value.version }]
        : []));
      const loserCodes = outcomes.flatMap((outcome): string[] => {
        if (outcome.status === 'fulfilled') {
          return [];
        }
        const reason: unknown = outcome.reason;

        return [isMcpSurfaceError(reason) ? reason.agentError.code : String(reason)];
      });
      const winner = winners[0];

      expect(winners).toHaveLength(1);
      expect(loserCodes).toEqual(['DOCUMENT_CHANGED']);
      if (winner === undefined) {
        throw new Error('No save won the race');
      }
      const written: unknown = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf-8'));

      expect(written).toEqual(winner.document);
      version = winner.version;
    }
    expect(await codeOf(() => source.save('doc', { blocks: [] }, { ifVersion: version }))).toBeUndefined();
  });

  // Each instance has its own in-process chain, as two blok-mcp processes would.
  it('keeps every edit when two sources on one directory race', async () => {
    let { version } = await createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null });

    for (let round = 0; round < 10; round += 1) {
      const first = { blocks: [], title: `first ${round}` };
      const second = { blocks: [], title: `second ${round}` };
      const outcomes = await Promise.allSettled([
        createFilesSource(dir).save('doc', first, { ifVersion: version }),
        createFilesSource(dir).save('doc', second, { ifVersion: version }),
      ]);
      const winners = outcomes.flatMap((outcome, index) => (outcome.status === 'fulfilled'
        ? [{ document: index === 0 ? first : second, version: outcome.value.version }]
        : []));
      const loserCodes = outcomes.flatMap((outcome): string[] => {
        if (outcome.status === 'fulfilled') {
          return [];
        }
        const reason: unknown = outcome.reason;

        return [isMcpSurfaceError(reason) ? reason.agentError.code : String(reason)];
      });
      const winner = winners[0];

      expect(winners).toHaveLength(1);
      expect(loserCodes).toEqual(['DOCUMENT_CHANGED']);
      if (winner === undefined) {
        throw new Error('No save won the race');
      }
      const written: unknown = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf-8'));

      expect(written).toEqual(winner.document);
      version = winner.version;
    }
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('breaks a stale lock left by a crashed process', async () => {
    const lock = join(dir, '.doc.json.lock');

    writeFileSync(lock, '');
    const old = new Date(Date.now() - 10 * 60 * 1000);

    utimesSync(lock, old, old);
    expect(await codeOf(() => createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null }))).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('gives up with SOURCE_UNAVAILABLE while another process holds a fresh lock', async () => {
    const lock = join(dir, '.doc.json.lock');

    writeFileSync(lock, '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown: unknown = await createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null })
      .then(() => undefined, (reason: unknown) => reason);

    if (!isMcpSurfaceError(thrown)) {
      throw new Error(`Expected a surface error, got ${String(thrown)}`);
    }
    const { code, message } = thrown.agentError;

    expect(code).toBe('SOURCE_UNAVAILABLE');
    expect(message).toContain('doc.json');
    expect(message).not.toContain(root);
    expect(readdirSync(dir)).toEqual(['.doc.json.lock']);
  }, 10_000);

  const caseInsensitiveDisk = (): boolean => {
    writeFileSync(join(dir, 'probe.json'), '{}');
    const insensitive = statSync(join(dir, 'PROBE.json'), { throwIfNoEntry: false }) !== undefined;

    rmSync(join(dir, 'probe.json'));

    return insensitive;
  };

  it('never serves or overwrites a stored document through an id that differs only by case', async () => {
    const insensitive = caseInsensitiveDisk();
    const text = '{"blocks":[],"title":"secret"}';

    writeFileSync(join(dir, 'secret.json'), text);
    const source = createFilesSource(dir);

    if (insensitive) {
      expect(await codeOf(() => source.load('SECRET'))).toBe('INVALID_ARGS');
      expect(await codeOf(() => source.save('SECRET', { blocks: [] }, { ifVersion: null }))).toBe('INVALID_ARGS');
      expect(await messageOf(() => source.load('SECRET'))).toBe(
        'secret.json already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist.',
      );
      expect(readdirSync(dir)).toEqual(['secret.json']);
    } else {
      // A case-sensitive disk holds two documents; SECRET is a new, empty one.
      expect(await source.load('SECRET')).toEqual({ raw: { blocks: [] }, version: null, missing: true });
      await source.save('SECRET', { blocks: [] }, { ifVersion: null });
      expect(readdirSync(dir).sort()).toEqual(['SECRET.json', 'secret.json']);
    }
    expect(readFileSync(join(dir, 'secret.json'), 'utf-8')).toBe(text);
    expect((await source.load('secret')).raw).toEqual({ blocks: [], title: 'secret' });
  });

  it('lets only one of two first saves that differ by case win on a case-insensitive disk', async () => {
    if (!caseInsensitiveDisk()) {
      return;
    }
    const source = createFilesSource(dir);
    const outcomes = await Promise.allSettled([
      source.save('doc', { blocks: [], title: 'lower' }, { ifVersion: null }),
      source.save('DOC', { blocks: [], title: 'upper' }, { ifVersion: null }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  });

  it.each([0o600, 0o666])('keeps file mode %o across a save', async (mode) => {
    const path = join(dir, 'doc.json');

    writeFileSync(path, '{"blocks":[]}');
    chmodSync(path, mode);
    const source = createFilesSource(dir);
    const { version } = await source.load('doc');

    await source.save('doc', { blocks: [], title: 'x' }, { ifVersion: version });
    expect(statSync(path).mode & 0o777).toBe(mode);
  });

  it('creates a document whose id has capitals, as page ids from nanoid do', async () => {
    const source = createFilesSource(dir);

    expect(await codeOf(() => source.save('Vx3kQ9aB2c', { blocks: [] }, { ifVersion: null }))).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['Vx3kQ9aB2c.json']);
  });

  it('keeps opening and saving an existing document whose id has capitals', async () => {
    writeFileSync(join(dir, 'Old.json'), '{"blocks":[]}');
    const source = createFilesSource(dir);
    const { version } = await source.load('Old');

    expect(await codeOf(() => source.save('Old', { blocks: [], title: 't' }, { ifVersion: version }))).toBeUndefined();
  });

  it('loads a symlinked document through its exact name', async () => {
    const outside = join(root, 'outside.json');

    writeFileSync(outside, '{"blocks":[],"title":"linked"}');
    symlinkSync(outside, join(dir, 'doc.json'));
    expect((await createFilesSource(dir).load('doc')).raw).toEqual({ blocks: [], title: 'linked' });
  });

  it('saves a symlinked document through the link and keeps the link and the target mode', async () => {
    const outside = join(root, 'outside.json');

    writeFileSync(outside, '{"blocks":[]}');
    chmodSync(outside, 0o600);
    symlinkSync(outside, join(dir, 'doc.json'));
    const source = createFilesSource(dir);
    const { version } = await source.load('doc');
    const saved = await source.save('doc', { blocks: [], title: 'x' }, { ifVersion: version });

    expect(lstatSync(join(dir, 'doc.json')).isSymbolicLink()).toBe(true);
    const written: unknown = JSON.parse(readFileSync(outside, 'utf-8'));

    expect(written).toEqual({ blocks: [], title: 'x' });
    expect(saved.version).toBe(sha(readFileSync(outside)));
    expect(statSync(outside).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['doc.json']);
    expect(readdirSync(root).sort()).toEqual(['documents', 'outside.json']);
  });

  it('refuses to save over a dangling symlink with SOURCE_UNAVAILABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outside = join(root, 'gone.json');

    symlinkSync(outside, join(dir, 'doc.json'));
    expect(await codeOf(() => createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null })))
      .toBe('SOURCE_UNAVAILABLE');
    expect(lstatSync(join(dir, 'doc.json')).isSymbolicLink()).toBe(true);
    expect(statSync(outside, { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['doc.json']);
  });

  it('refuses to load a dangling symlink with SOURCE_UNAVAILABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    symlinkSync(join(root, 'gone.json'), join(dir, 'doc.json'));

    expect(await messageOf(() => createFilesSource(dir).load('doc'))).toBe('doc.json is a link to a missing file.');
  });

  // a.json links to b.json, so a save of `a` and a save of `b` write one file.
  it.each([
    { label: 'one source', sources: (): [DocumentSource, DocumentSource] => {
      const source = createFilesSource(dir);

      return [source, source];
    } },
    { label: 'two sources', sources: (): [DocumentSource, DocumentSource] => [createFilesSource(dir), createFilesSource(dir)] },
  ])('keeps every edit when saves of a link and its target race ($label)', async ({ sources }) => {
    writeFileSync(join(dir, 'b.json'), '{"blocks":[]}');
    symlinkSync('b.json', join(dir, 'a.json'));
    const [viaLink, viaTarget] = sources();

    for (let round = 0; round < 10; round += 1) {
      const version = sha(readFileSync(join(dir, 'b.json')));
      const outcomes = await Promise.allSettled([
        viaLink.save('a', { blocks: [], title: `link ${round}` }, { ifVersion: version }),
        viaTarget.save('b', { blocks: [], title: `target ${round}` }, { ifVersion: version }),
      ]);
      const codes = outcomes.map((outcome) => {
        if (outcome.status === 'fulfilled') {
          return 'ok';
        }
        const reason: unknown = outcome.reason;

        return isMcpSurfaceError(reason) ? reason.agentError.code : String(reason);
      });

      expect(codes.sort()).toEqual(['DOCUMENT_CHANGED', 'ok']);
    }
    expect(readdirSync(dir).sort()).toEqual(['a.json', 'b.json']);
  });

  it('refuses a save whose link was pointed at another file while it waited for the lock', async () => {
    const x = join(root, 'x.json');
    const y = join(root, 'y.json');

    writeFileSync(x, '{"blocks":[],"title":"X"}');
    writeFileSync(y, '{"blocks":[],"title":"Y"}');
    symlinkSync(x, join(dir, 'a.json'));
    writeFileSync(join(root, '.x.json.lock'), '');
    const saving = codeOf(() => createFilesSource(dir).save('a', { blocks: [], title: 'from a' }, { ifVersion: sha(readFileSync(y)) }));

    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(join(dir, 'a.json'));
    symlinkSync(y, join(dir, 'a.json'));
    rmSync(join(root, '.x.json.lock'));

    expect(await saving).toBe('DOCUMENT_CHANGED');
    expect(readFileSync(x, 'utf-8')).toBe('{"blocks":[],"title":"X"}');
    expect(readFileSync(y, 'utf-8')).toBe('{"blocks":[],"title":"Y"}');
  });

  it('refuses a case alias of a link whose target has the alias spelling', async () => {
    if (!caseInsensitiveDisk()) {
      return;
    }
    const target = join(root, 'Q.json');

    writeFileSync(target, '{"blocks":[],"title":"q"}');
    symlinkSync(target, join(dir, 'q.json'));
    const source = createFilesSource(dir);

    expect(await codeOf(() => source.load('Q'))).toBe('INVALID_ARGS');
    expect(await codeOf(() => source.save('Q', { blocks: [] }, { ifVersion: sha(readFileSync(target)) }))).toBe('INVALID_ARGS');
    expect(readFileSync(target, 'utf-8')).toBe('{"blocks":[],"title":"q"}');
  });

  it('does not show server paths in read, write or list errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mkdirSync(join(dir, 'folder.json'));
    const source = createFilesSource(dir);
    const readMessage = await messageOf(() => source.load('folder'));

    expect(readMessage).not.toBe('');
    expect(readMessage).not.toContain(root);
    expect(readMessage).toContain('folder.json');

    const notADir = join(root, 'plain-file');

    writeFileSync(notADir, 'x');
    const list = createFilesSource(notADir).list;

    if (list === undefined) {
      throw new Error('The files source must support list');
    }
    const listMessage = await messageOf(() => list({ limit: 2 }));

    expect(listMessage).not.toBe('');
    expect(listMessage).not.toContain(root);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not show server paths when a write fails', async () => {
    if (process.getuid?.() === 0) {
      return;
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chmodSync(dir, 0o500);
    try {
      const message = await messageOf(() => createFilesSource(dir).save('doc', { blocks: [] }, { ifVersion: null }));

      expect(message).not.toBe('');
      expect(message).not.toContain(root);
      expect(message).toContain('doc.json');
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
