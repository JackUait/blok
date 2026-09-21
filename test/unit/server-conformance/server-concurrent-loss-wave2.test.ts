import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../src/components/modules/yjs/serializer';

const CONVERTER_PATH = resolve(
  process.cwd(),
  'packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs'
);

/** The body of a C# method, from its signature's `{` to the brace that closes it. */
const csharpMethodBody = (source: string, name: string): string => {
  // The DECLARATION, not one of the call sites above it.
  const signature = new RegExp(`private static [\\w?<>]+ ${name}\\s*\\(`).exec(source);

  if (signature === null) {
    throw new Error(`no ${name} in YDocConverter.cs`);
  }

  const open = source.indexOf('{', signature.index);
  let depth = 0;

  for (let at = open; at < source.length; at++) {
    depth += source[at] === '{' ? 1 : 0;
    depth -= source[at] === '}' ? 1 : 0;

    if (depth === 0) {
      return source.slice(open, at + 1);
    }
  }

  throw new Error(`${name} is not brace-balanced`);
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

const blockNamed = (blocks: YjsOutputBlockData[], id: string): YjsOutputBlockData => {
  const found = blocks.find((block) => block.id === id);

  if (found === undefined) {
    throw new Error(`no block ${id}`);
  }

  return found;
};

/**
 * The pairing pass that decides whether an array element keeps its live
 * container when a write changes the array's LENGTH.
 *
 * Both sides run the same four passes (`pairGridRows` in
 * src/components/modules/yjs/document-store.ts, `PairRows` in
 * YDocConverter.cs). Pass 3 scores how much two elements still look like the
 * same element, and the client's `rowSimilarity` scores THREE shapes: two
 * arrays by their common ends, two OBJECTS by the keys they both carry and
 * still agree on, and anything else by plain equality. Its own comment says
 * the object branch exists for exactly this caller — "an element is a table
 * cell, not a row".
 *
 * The C# `RowSimilarity` scores only the array shape. Every object element
 * therefore scores 0, pass 3 pairs nothing, and the positional remainder
 * (pass 4) hands the containers out in order — which is a REORDER, and a
 * reorder falls back to one blanket delete+insert of the whole middle. Every
 * live container in it is recreated, so whatever a peer had written inside
 * one of them at that instant is discarded with no error.
 */
describe('array element similarity — lockstep with the C# converter', () => {
  const source = readFileSync(CONVERTER_PATH, 'utf8');

  it.fails('scores two OBJECT elements by the keys they still agree on', () => {
    const body = csharpMethodBody(source, 'RowSimilarity');

    // The defect: the method answers 0 for anything that is not two arrays,
    // so a table cell — an object — never scores.
    expect(
      /is not YArray|is not JsonArray/.test(body),
      'RowSimilarity bails out on non-array elements, so every object element scores 0'
    ).toBe(false);
    expect(
      /YMap|AnyObject|JsonObject/.test(body),
      'RowSimilarity has no object branch; the client rowSimilarity sums over shared keys'
    ).toBe(true);
  });
});

/**
 * The CLIENT half of the same write path, so the divergence above is measured
 * against real behaviour and not a wish. These are what two clients converge
 * on; the server's /edit must land on the same document.
 *
 * Proven separately at the C# layer by running YDocConverter.Seed / ApplyOps /
 * Export over the identical scenarios: the server drops the peer's write in
 * both of them.
 */
describe('client element pairing under concurrency (the contract the server must match)', () => {
  it('keeps a peer writing into an element while a write inserts another beside it', () => {
    const client = store();

    client.fromJSON([
      { id: 'x', type: 'tool', data: { items: [{ t: 'b', tag: 'y' }, { t: 'b', tag: 'y' }] } },
    ]);

    const peer = fork(client);
    const before = client.getStateVector();

    ((dataOf(peer, 'x').get('items') as Y.Array<unknown>).get(0) as Y.Map<unknown>)
      .set('peer', 'kept');

    client.updateBlockData('x', 'items', [
      { t: 'd', tag: 'x' },
      { t: 'b', tag: 'y' },
      { t: 'b2', tag: 'y' },
    ]);
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const items = blockNamed(client.toJSON(), 'x').data.items as Record<string, unknown>[];

    expect(items.some((item) => item.peer === 'kept')).toBe(true);
  });

  it('keeps a block a peer drops into a cell while a column is inserted at the front', () => {
    const client = store();

    client.fromJSON([
      {
        id: 'tb',
        type: 'table',
        data: {
          content: [[
            { text: 'a', blocks: [], placement: 'top-left' },
            { text: 'b', blocks: [], placement: 'top-left' },
            { text: 'c', blocks: [], placement: 'middle-center' },
          ]],
        },
      },
    ]);

    const peer = fork(client);
    const before = client.getStateVector();
    const grid = dataOf(peer, 'tb').get('content') as Y.Map<unknown>;
    const rows = grid.get('__rows') as Y.Map<unknown>;
    const order = grid.get('__rowKeys') as Y.Array<string>;
    const cells = rows.get(order.get(0)) as Y.Array<unknown>;

    ((cells.get(1) as Y.Map<unknown>).get('blocks') as Y.Array<string>).insert(0, ['p2']);

    client.updateBlockData('tb', 'content', [[
      { text: 'NEW', blocks: [], placement: 'top-left' },
      { text: 'a', blocks: [], placement: 'top-left' },
      { text: 'b', blocks: [], placement: 'top-left' },
      { text: 'c2', blocks: [], placement: 'middle-center' },
    ]]);
    client.applyRemoteUpdate(Y.encodeStateAsUpdate(peer, before));

    const content = blockNamed(client.toJSON(), 'tb').data.content as { blocks: string[] }[][];

    expect(content[0][2].blocks).toContain('p2');
  });
});
