import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import {
  GRID_ORDER_KEY,
  GRID_ROWS_KEY,
  YBlockSerializer,
  isDiffableTextKey,
  isOrderedIdArrayKey,
} from '../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../src/components/modules/yjs/serializer';

const CONVERTER_PATH = resolve(
  process.cwd(),
  'packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs'
);

/** The keys a C# `private static readonly string[] Name = [...]` line names. */
const csharpKeyList = (source: string, field: string): string[] => {
  const line = new RegExp(`${field}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);

  if (line === null) {
    throw new Error(`no ${field} array in YDocConverter.cs`);
  }

  return Array.from(line[1].matchAll(/"([^"]*)"/g), (match) => match[1]);
};

const store = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** A second client holding the same document, as a joining peer does. */
const fork = (source: DocumentStore): Y.Doc => {
  const peer = new Y.Doc();

  Y.applyUpdate(peer, source.encodeStateAsUpdate());

  return peer;
};

const dataOf = (doc: Y.Doc, id: string): Y.Map<unknown> =>
  (doc.getMap('blocks').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>;

const cellOf = (doc: Y.Doc, row: number, column: number): Y.Map<unknown> => {
  const grid = dataOf(doc, 'tb').get('content') as Y.Map<unknown>;
  const rows = grid.get(GRID_ROWS_KEY) as Y.Map<unknown>;
  const order = grid.get(GRID_ORDER_KEY) as Y.Array<string>;
  const cells = rows.get(order.get(row)) as Y.Array<unknown>;

  return cells.get(column) as Y.Map<unknown>;
};

const blockNamed = (blocks: YjsOutputBlockData[], id: string): YjsOutputBlockData => {
  const found = blocks.find((block) => block.id === id);

  if (found === undefined) {
    throw new Error(`no block ${id}`);
  }

  return found;
};

const TABLE: YjsOutputBlockData = {
  id: 'tb',
  type: 'table',
  data: { content: [[{ text: 'a1', blocks: ['p1'] }, { text: 'b1', blocks: [] }]] },
};

/**
 * The CLIENT half of the server's /edit write path. The server's
 * `YDocConverter.EditStep.ReplaceData` claims to mirror what a client's full
 * `save()` flush does through `DocumentStore.updateBlockData`. These pin what
 * that client behaviour actually is, so the matching C# suite
 * (Blok.Server.Tests/Collab/YDocConverterConcurrentLossTests.cs, all four red)
 * measures a real divergence and not a wish.
 */
describe('client deep-assign under concurrency (the contract the server must match)', () => {
  it('keeps a peer typing in one table cell while this client writes another', () => {
    const client = store();

    client.fromJSON([TABLE]);

    const peer = fork(client);
    const before = client.getStateVector();

    cellOf(peer, 0, 0).set('text', 'a1 typed');

    client.updateBlockData('tb', 'content', [
      [{ text: 'a1', blocks: ['p1'] }, { text: 'b1 host', blocks: [] }],
    ]);
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const content = blockNamed(client.toJSON(), 'tb').data.content as { text: string }[][];

    expect(content[0][0].text).toBe('a1 typed');
    expect(content[0][1].text).toBe('b1 host');
  });

  it('keeps both ids when two people drop a block into one cell', () => {
    const client = store();

    client.fromJSON([TABLE]);

    const peer = fork(client);
    const before = client.getStateVector();

    (cellOf(peer, 0, 0).get('blocks') as Y.Array<string>).insert(1, ['p2']);

    client.updateBlockData('tb', 'content', [
      [{ text: 'a1', blocks: ['p1', 'p3'] }, { text: 'b1', blocks: [] }],
    ]);
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const content = blockNamed(client.toJSON(), 'tb').data.content as { blocks: string[] }[][];

    expect(content[0][0].blocks).toContain('p2');
    expect(content[0][0].blocks).toContain('p3');
  });

  it('keeps both writes to different keys of a nested settings map', () => {
    const client = store();

    client.fromJSON([
      { id: 'cb', type: 'callout', data: { settings: { icon: 'star', colour: 'blue' } } },
    ]);

    const peer = fork(client);
    const before = client.getStateVector();

    (dataOf(peer, 'cb').get('settings') as Y.Map<unknown>).set('colour', 'red');

    client.updateBlockData('cb', 'settings', { icon: 'bolt', colour: 'blue' });
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const settings = blockNamed(client.toJSON(), 'cb').data.settings as Record<string, string>;

    expect(settings.colour).toBe('red');
    expect(settings.icon).toBe('bolt');
  });

  it('keeps both renames of different database properties', () => {
    const client = store();

    client.fromJSON([
      {
        id: 'db',
        type: 'database',
        data: { properties: [{ id: 'p1', name: 'Name' }, { id: 'p2', name: 'Status' }] },
      },
    ]);

    const peer = fork(client);
    const before = client.getStateVector();

    ((dataOf(peer, 'db').get('properties') as Y.Array<unknown>).get(1) as Y.Map<unknown>)
      .set('name', 'State');

    client.updateBlockData('db', 'properties', [
      { id: 'p1', name: 'Title' },
      { id: 'p2', name: 'Status' },
    ]);
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const properties = blockNamed(client.toJSON(), 'db').data.properties as { name: string }[];

    expect(properties[1].name).toBe('State');
    expect(properties[0].name).toBe('Title');
  });
});

/**
 * The two key sets are declared once per side and kept equal only by a comment
 * in each file. A silent divergence makes a server-seeded field a different
 * CRDT type from a client-seeded one, which loses a peer's edit with no error.
 */
describe('key-set lockstep with the C# converter', () => {
  const source = readFileSync(CONVERTER_PATH, 'utf8');

  it('names the same diffable text keys on both sides', () => {
    const csharp = csharpKeyList(source, 'DiffableTextKeys');

    expect(csharp.length).toBeGreaterThan(0);
    expect(csharp.filter((key) => !isDiffableTextKey(key))).toEqual([]);

    for (const key of ['text', 'code', 'caption', 'title', 'alt', 'artist']) {
      expect(isDiffableTextKey(key), `TS is missing ${key}`).toBe(true);
      expect(csharp, `C# is missing ${key}`).toContain(key);
    }
  });

  it('names the same ordered id array keys on both sides', () => {
    const csharp = csharpKeyList(source, 'OrderedIdArrayKeys');

    expect(csharp.length).toBeGreaterThan(0);
    expect(csharp.filter((key) => !isOrderedIdArrayKey(key))).toEqual([]);
    expect(isOrderedIdArrayKey('blocks')).toBe(true);
    expect(csharp).toContain('blocks');
  });
});
