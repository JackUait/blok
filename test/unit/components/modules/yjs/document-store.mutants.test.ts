import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const block = (id: string, data: Record<string, unknown>): YjsOutputBlockData => ({
  id,
  type: 'paragraph',
  data,
});

/** Data of block `id`, or an empty object when it is absent. */
const dataOf = (store: DocumentStore, id: string): Record<string, unknown> => {
  const found = store.toJSON().find((entry) => entry.id === id);

  return found === undefined ? {} : found.data;
};

/** Exchange diffs both ways, as a provider pair would. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/** A seeded pair: only A loads, B receives the document through the seam. */
const seededPair = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

describe('DocumentStore — two-ended diff accounting', () => {
  it('appending a copy of the last element keeps both copies', () => {
    const store = createStore();

    store.fromJSON([block('b1', { rows: [ { v: 'a' } ] })]);

    store.updateBlockData('b1', 'rows', [ { v: 'a' }, { v: 'a' } ]);

    // The prefix and the suffix must never overlap. If they do, both middles
    // come out negative, the splice is skipped and the appended row is lost.
    expect(dataOf(store, 'b1').rows).toEqual([ { v: 'a' }, { v: 'a' } ]);
  });
});

describe('DocumentStore — nested map merge', () => {
  it('an edit inside a nested object reaches the document', () => {
    const store = createStore();

    store.fromJSON([block('b1', { meta: { inner: { a: 1 } } })]);

    store.updateBlockData('b1', 'meta', { inner: { a: 2 } });

    expect(dataOf(store, 'b1').meta).toEqual({ inner: { a: 2 } });
  });

  it('a nested object added next to an existing key is written', () => {
    const store = createStore();

    store.fromJSON([block('b1', { meta: { x: 1 } })]);

    store.updateBlockData('b1', 'meta', { x: 1, inner: { a: 1 } });

    expect(dataOf(store, 'b1').meta).toEqual({ x: 1, inner: { a: 1 } });
  });

  it('concurrent edits to different sub-fields of one nested object both survive', () => {
    const { a, b } = seededPair([block('b1', { meta: { inner: { a: 1, b: 1 } } })]);

    a.updateBlockData('b1', 'meta', { inner: { a: 2, b: 1 } });
    b.updateBlockData('b1', 'meta', { inner: { a: 1, b: 2 } });

    sync(a, b);

    // Replacing the nested Y.Map instead of merging into it makes this
    // last-writer-wins: one peer's sub-field edit disappears.
    expect(dataOf(a, 'b1').meta).toEqual({ inner: { a: 2, b: 2 } });
    expect(a.toJSON()).toEqual(b.toJSON());
  });
});

describe('DocumentStore — array element assignment', () => {
  it('an element replaced by an array occupies exactly its own slot', () => {
    const store = createStore();

    store.fromJSON([block('b1', { rows: [ { a: 1 }, { b: 2 } ] })]);

    store.updateBlockData('b1', 'rows', [ { a: 1 }, [ { c: 3 } ] ]);

    expect(dataOf(store, 'b1').rows).toEqual([ { a: 1 }, [ { c: 3 } ] ]);
  });

  it('an edit inside a nested array element reaches the document', () => {
    const store = createStore();

    store.fromJSON([block('b1', { rows: [ { a: 1 }, [ { c: 1 } ] ] })]);

    store.updateBlockData('b1', 'rows', [ { a: 1 }, [ { c: 2 } ] ]);

    expect(dataOf(store, 'b1').rows).toEqual([ { a: 1 }, [ { c: 2 } ] ]);
  });

  it('an unchanged leaf element between two edited ones is left alone', () => {
    const { a, b } = seededPair([block('b1', { rows: [ { a: 1 }, [ 1, 2 ], { c: 1 } ] })]);

    a.updateBlockData('b1', 'rows', [ { a: 9 }, [ 1, 2 ], { c: 9 } ]);
    b.updateBlockData('b1', 'rows', [ { a: 8 }, [ 1, 2 ], { c: 8 } ]);

    sync(a, b);

    // Rewriting an element that did not change makes both peers delete and
    // re-insert it, so the merge leaves two copies where there was one.
    const rows = dataOf(a, 'b1').rows;

    expect(rows).toHaveLength(3);
    expect(Array.isArray(rows) ? rows.filter((row) => Array.isArray(row)) : []).toEqual([ [ 1, 2 ] ]);
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it('concurrent edits inside one nested array element both survive', () => {
    const { a, b } = seededPair([block('b1', { rows: [ { a: 1 }, [ { c: 1 }, { d: 1 } ] ] })]);

    a.updateBlockData('b1', 'rows', [ { a: 1 }, [ { c: 2 }, { d: 1 } ] ]);
    b.updateBlockData('b1', 'rows', [ { a: 1 }, [ { c: 1 }, { d: 2 } ] ]);

    sync(a, b);

    // Rewriting the nested Y.Array instead of diffing into it gives each peer
    // its own container, so the merge leaves two rival elements behind.
    expect(dataOf(a, 'b1').rows).toEqual([ { a: 1 }, [ { c: 2 }, { d: 2 } ] ]);
    expect(a.toJSON()).toEqual(b.toJSON());
  });
});

describe('DocumentStore — placement of blocks no order array holds', () => {
  it('reports the dangling parent of a block left in no order array', () => {
    const store = createStore();

    store.fromJSON([block('b1', { text: 'x' })]);

    store.applyPlacement('b1', { parentId: 'ghost', afterId: null }, 'local');

    expect(store.getPlacement('b1')).toEqual({ parentId: 'ghost', afterId: null });
  });

  it('a parent whose contentIds was overwritten heals and adopts the child', () => {
    const store = createStore();

    store.fromJSON([block('p', { text: '' }), block('c', { text: '' })]);

    // A peer (or an older session) can leave a non-array under contentIds.
    store.transact(() => {
      store.getBlockById('p')?.set('contentIds', 'broken');
    }, 'local');

    store.applyPlacement('c', { parentId: 'p', afterId: null }, 'local');

    const parent = store.toJSON().find((entry) => entry.id === 'p');

    expect(parent?.content).toEqual([ 'c' ]);
  });
});
