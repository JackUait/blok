// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { createFilesSource } from '../../../src/mcp/sources/files';
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

  it('loads a missing document as empty with no version', async () => {
    expect(await createFilesSource(dir).load('fresh')).toEqual({ raw: { blocks: [] }, version: null });
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
});
