import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type * as Lib0Time from 'lib0/time';
import { getUnixTime } from 'lib0/time';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { GRID_ROWS_KEY, YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';
import type { AwarenessChange, LocalOriginTag } from '../../../../../src/components/modules/yjs/types';

// lib0's `getUnixTime` IS `Date.now`, and y-protocols keeps its own binding to
// it, so mocking the module only moves the SEAM's clock — the only lever that
// can age a meta row from the outside. Re-primed in beforeEach because
// restoreAllMocks() wipes the implementation of a vi.fn() made in the factory.
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof Lib0Time>();

  return { ...actual, getUnixTime: vi.fn(actual.getUnixTime) };
});

const stores: DocumentStore[] = [];

const createStore = (): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  stores.push(store);

  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUnixTime).mockImplementation(() => Date.now());
});

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.destroy();
  }
  vi.restoreAllMocks();
});

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

// ===========================================================================
// Mutation battery: every block below drives a branch the happy paths above
// never reach. Each assertion names the branch it pins.
// ===========================================================================

/** The emitted block with `id`; throws when the id is absent. */
const emittedBlock = (store: DocumentStore, id: string): YjsOutputBlockData => {
  const found = store.toJSON().find((entry) => entry.id === id);

  if (found === undefined) {
    throw new Error(`block ${id} is missing from the emitted document`);
  }

  return found;
};

/** The raw Y value stored under `key` of block `id`'s data. */
const rawData = (store: DocumentStore, id: string, key: string): unknown => {
  const data = store.getBlockById(id)?.get('data');

  return data instanceof Y.Map ? data.get(key) : undefined;
};

/** Origins the provider seam saw for one write. */
const originsOf = (store: DocumentStore, write: () => void): unknown[] => {
  const origins: unknown[] = [];
  const off = store.onAnyUpdate((_update, origin) => origins.push(origin));

  write();
  off();

  return origins;
};

describe('DocumentStore — write origins reach the provider seam', () => {
  it('labels every write with its own origin tag', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }), block('b2', { text: 'b' }), block('b3', { text: 'c' }) ]);

    expect(originsOf(store, () => store.addBlock(block('b4', { text: 'd' })))).toEqual([ 'local' ]);
    expect(originsOf(store, () => store.updateBlockMetadata('b1', 7, 'user-1'))).toEqual([ 'local' ]);
    expect(originsOf(store, () => store.updateBlockTune('b1', 'align', 'center'))).toEqual([ 'local' ]);
    expect(originsOf(store, () => store.removeBlock('b4'))).toEqual([ 'local' ]);
    expect(originsOf(store, () => store.moveBlock('b1', 2))).toEqual([ 'move' ]);
    expect(
      originsOf(store, () => store.transact(() => store.getBlockById('b1')?.set('type', 'header'), 'local'))
    ).toEqual([ 'local' ]);
    expect(
      originsOf(store, () => store.transactWithoutCapture(() => store.getBlockById('b1')?.set('type', 'paragraph')))
    ).toEqual([ 'no-capture' ]);
    expect(originsOf(store, () => store.applyPlacement('b1', { parentId: null, afterId: null }, 'move'))).toEqual([ 'move' ]);
    expect(originsOf(store, () => store.fromJSON([ block('b9', { text: 'z' }) ]))).toEqual([ 'load' ]);
  });

  it('runs no transaction at all when a move is a no-op', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);

    // Same index: no transaction, so no origin and no update for the seam.
    expect(originsOf(store, () => store.moveBlock('b1', 0))).toEqual([]);
  });
});

describe('DocumentStore — adding blocks', () => {
  it('writes nothing for a block whose id is not a string', () => {
    const store = createStore();

    store.addBlock({ id: 7 as unknown as string, type: 'paragraph', data: { text: 'nameless' } });

    expect(store.blocksMap.size).toBe(0);
    expect(store.rootOrder.toArray()).toEqual([]);
    expect(store.toJSON()).toEqual([]);
  });

  it('inserts at the requested flat index instead of appending', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }), block('b2', { text: 'b' }), block('b3', { text: 'c' }) ]);

    store.addBlock(block('b0', { text: 'first' }), 0);

    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'b0', 'b1', 'b2', 'b3' ]);
  });
});

describe('DocumentStore — removing blocks', () => {
  it('removes inside a parent contentIds as well as the root order', () => {
    const store = createStore();

    store.fromJSON([
      { id: 'p', type: 'paragraph', data: { text: 'parent' } },
      { id: 'c', type: 'paragraph', data: { text: 'child' }, parent: 'p' },
    ]);

    store.removeBlock('c');

    expect(emittedBlock(store, 'p').content).toBeUndefined();
    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'p' ]);
  });

  it('removes an id that only an order array still names', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.transact(() => {
      store.rootOrder.push([ 'ghost' ]);
    }, 'local');

    store.removeBlock('ghost');

    // `every` instead of `some` reads the ghost as unknown and leaves it behind.
    expect(store.rootOrder.toArray()).toEqual([ 'b1' ]);
  });

  it('deletes a run of duplicated ids without swallowing a live id between them', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.transact(() => {
      store.rootOrder.push([ 'ghost', 'b1', 'ghost' ]);
    }, 'local');

    store.removeBlock('ghost');

    // Merging a run across the b1 between the two ghosts deletes b1 too.
    expect(store.rootOrder.toArray()).toEqual([ 'b1', 'b1' ]);
  });

  it('deletes a contiguous run of duplicates in one splice', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.transact(() => {
      store.rootOrder.push([ 'ghost', 'ghost', 'ghost' ]);
    }, 'local');

    store.removeBlock('ghost');

    expect(store.rootOrder.toArray()).toEqual([ 'b1' ]);
  });
});

describe('DocumentStore — moving blocks', () => {
  it('ignores a move of an id the document does not hold', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);

    store.moveBlock('ghost', 1);

    // Without the fromIndex guard the unknown id is inserted into the root order.
    expect(store.rootOrder.toArray()).toEqual([ 'b1' ]);
    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'b1' ]);
  });

  it('leaves a moved block out of every order array when its parent dangles', () => {
    const store = createStore();

    store.addBlock(block('b1', { text: 'root' }));
    store.addBlock({ id: 'd', type: 'paragraph', data: { text: 'orphan' }, parent: 'ghost' });

    // The index has to differ from the orphan's own, or the move returns early.
    expect(() => store.moveBlock('d', 0)).not.toThrow();
    expect(store.rootOrder.toArray()).toEqual([ 'b1' ]);
  });

  it('ignores a placement of an id the document does not hold', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);

    expect(() => store.applyPlacement('ghost', { parentId: null, afterId: null }, 'local')).not.toThrow();
    expect(store.rootOrder.toArray()).toEqual([ 'b1' ]);
  });

  it('skips a blocks-map value that is not a block map', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.transact(() => {
      store.blocksMap.set('junk', 'not a block' as unknown as Y.Map<unknown>);
    }, 'local');

    expect(() => store.removeBlock('b1')).not.toThrow();
    expect(store.rootOrder.toArray()).toEqual([]);
  });

  it('emits nothing for a transaction that changed nothing', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);

    expect(originsOf(store, () => store.transact(() => {}, 'local'))).toEqual([]);
    expect(originsOf(store, () => store.removeBlock('ghost'))).toEqual([]);
  });
});

describe('DocumentStore — the hierarchy view', () => {
  it('breaks a parent cycle only at its lexicographically smallest member', () => {
    const store = createStore();

    store.fromJSON([ block('a', { text: 'a' }), block('b', { text: 'b' }), block('c', { text: 'c' }) ]);
    // A loop entered through a tail: a -> b -> c -> b.
    store.transact(() => {
      store.getBlockById('a')?.set('parentId', 'b');
      store.getBlockById('b')?.set('parentId', 'c');
      store.getBlockById('c')?.set('parentId', 'b');
    }, 'local');

    // The broken member loses its parent link, so only 'c' is unreachable from
    // the root order and the orphan tail emits it first; the keeper 'b' still
    // names 'c' as its parent.
    expect(store.toJSON().map((entry) => `${entry.id}:${entry.parent ?? '-'}`)).toEqual([ 'c:-', 'a:b', 'b:c' ]);
  });

  it('emits the top of an unreached subtree before its own descendant', () => {
    const store = createStore();

    // 'z' dangles (no order array holds it) and 'a' names it as parent, while
    // 'a' sorts BEFORE 'z' — only the roots-first pass orders them correctly.
    store.addBlock({ id: 'z', type: 'paragraph', data: { text: 'top' }, parent: 'ghost' });
    store.addBlock({ id: 'a', type: 'paragraph', data: { text: 'leaf' }, parent: 'z' });

    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'z', 'a' ]);
  });

  it('orders the unreached tail by id, not by map insertion order', () => {
    const store = createStore();

    // Both dangle, so both ride the tail: inserted 'b' first, emitted 'a' first.
    store.addBlock({ id: 'b', type: 'paragraph', data: { text: 'second' }, parent: 'ghost' });
    store.addBlock({ id: 'a', type: 'paragraph', data: { text: 'first' }, parent: 'ghost' });

    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'a', 'b' ]);
  });
});

describe('DocumentStore — loading a document', () => {
  it('drops the previous root order when a new document is loaded', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'first document' }) ]);
    store.fromJSON([ block('b2', { text: 'second document' }) ]);

    expect(store.blocksMap.has('b1')).toBe(false);
    expect(store.rootOrder.toArray()).toEqual([ 'b2' ]);
  });
});

describe('DocumentStore — updateBlockData return values', () => {
  it('reports no write for an unknown block', () => {
    const store = createStore();

    expect(store.updateBlockData('ghost', 'text', 'x')).toBe(false);
  });

  it('reports a write when a nested object leaf actually changed', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { inner: { a: 1 } } }) ]);
    store.updateBlockData('b1', 'meta', { inner: { a: 2 } });

    expect(store.updateBlockData('b1', 'meta', { inner: { a: 3 } })).toBe(true);
  });

  it('reports no write when a plain array matches the stored Y.Array', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { list: [ { a: 1 } ] }) ]);

    expect(store.updateBlockData('b1', 'list', [ { a: 1 } ])).toBe(false);
  });

  it('downshifts an emptied array back to a plain leaf', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { list: [ { a: 1 } ] }) ]);

    expect(store.updateBlockData('b1', 'list', [ 1, 2 ])).toBe(true);
    expect(emittedBlock(store, 'b1').data.list).toEqual([ 1, 2 ]);
  });

  it('drops the trailing elements the new array no longer has', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { list: [ { a: 1 }, { b: 2 } ] }) ]);
    store.updateBlockData('b1', 'list', [ { a: 1 } ]);

    expect(emittedBlock(store, 'b1').data.list).toEqual([ { a: 1 } ]);
  });

  it('appends the extra elements the new array adds', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { list: [ { a: 1 } ] }) ]);
    store.updateBlockData('b1', 'list', [ { a: 1 }, { b: 2 } ]);

    expect(emittedBlock(store, 'b1').data.list).toEqual([ { a: 1 }, { b: 2 } ]);
  });

  it('reports a write when a grid changed', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { grid: [ [ 'a', 'b' ] ] }) ]);

    expect(store.updateBlockData('b1', 'grid', [ [ 'a', 'c' ] ])).toBe(true);
    expect(emittedBlock(store, 'b1').data.grid).toEqual([ [ 'a', 'c' ] ]);
  });

  it('keeps the grid container when the new grid is identical', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { grid: [ [ 'a', 'b' ] ], keep: 1 } }) ]);

    const meta = rawData(store, 'b1', 'meta');
    // Captured BEFORE the write: the meta map is not replaced, so reading it
    // afterwards would hand back the new container and prove nothing.
    const before = meta instanceof Y.Map ? meta.get('grid') : undefined;

    store.updateBlockData('b1', 'meta', { grid: [ [ 'a', 'b' ] ], keep: 2 });

    const after = rawData(store, 'b1', 'meta');

    // A rewrite here replaces the keyed wrapper and loses every row's identity.
    expect(after instanceof Y.Map ? after.get('grid') : undefined).toBe(before);
  });

  it('keeps the array container when the new array is identical', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { list: [ { a: 1 } ], keep: 1 } }) ]);

    const meta = rawData(store, 'b1', 'meta');
    const before = meta instanceof Y.Map ? meta.get('list') : undefined;

    store.updateBlockData('b1', 'meta', { list: [ { a: 1 } ], keep: 2 });

    const after = rawData(store, 'b1', 'meta');

    expect(after instanceof Y.Map ? after.get('list') : undefined).toBe(before);
  });

  it('replaces a nested grid with a plain array once the value stops being a grid', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { grid: [ [ 'a', 'b' ] ], keep: 1 } }) ]);

    store.updateBlockData('b1', 'meta', { grid: [ { a: 1 } ], keep: 2 });

    expect(emittedBlock(store, 'b1').data.meta).toEqual({ grid: [ { a: 1 } ], keep: 2 });
  });

  it('downshifts a nested Y.Array to a plain leaf once it stops qualifying', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { list: [ { a: 1 } ], keep: 1 } }) ]);

    store.updateBlockData('b1', 'meta', { list: [ 1, 2 ], keep: 2 });

    expect(emittedBlock(store, 'b1').data.meta).toEqual({ list: [ 1, 2 ], keep: 2 });
  });

  it('drops every data key a full save no longer names', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a', stale: 'gone', keep: 'yes' }) ]);

    expect(store.pruneBlockData('b1', new Set([ 'text', 'keep' ]))).toBe(true);
    expect(emittedBlock(store, 'b1').data).toEqual({ text: 'a', keep: 'yes' });
  });

  it('labels a prune with the local origin', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a', stale: 'gone' }) ]);

    expect(originsOf(store, () => store.pruneBlockData('b1', new Set([ 'text' ])))).toEqual([ 'local' ]);
  });

  it('replaces a nested map with a plain array', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { a: 1 } }) ]);
    store.updateBlockData('b1', 'meta', [ 1, 2 ]);

    expect(emittedBlock(store, 'b1').data.meta).toEqual([ 1, 2 ]);
  });

  it('replaces a nested map with a primitive', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { a: 1 } }) ]);
    store.updateBlockData('b1', 'meta', 'plain');

    expect(emittedBlock(store, 'b1').data.meta).toBe('plain');
  });

  it('replaces a nested map with null', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { a: 1 } }) ]);
    store.updateBlockData('b1', 'meta', null);

    expect(emittedBlock(store, 'b1').data.meta).toBeNull();
  });

  it('replaces a plain leaf with a nested object', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: 'plain' }) ]);
    store.updateBlockData('b1', 'meta', { a: 1 });

    expect(emittedBlock(store, 'b1').data.meta).toEqual({ a: 1 });
  });

  it('replaces a nested key that held a map with a plain array element', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { inner: { a: 1 } } }) ]);
    store.updateBlockData('b1', 'meta', { inner: [ 'x' ] });

    expect(emittedBlock(store, 'b1').data.meta).toEqual({ inner: [ 'x' ] });
  });

  it('replaces a nested key that held a map with null', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { inner: { a: 1 } } }) ]);
    store.updateBlockData('b1', 'meta', { inner: null });

    const meta = emittedBlock(store, 'b1').data.meta;

    expect(meta).toHaveProperty('inner', null);
  });

  it('writes a grid-shaped array into an element slot that held a plain object', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { rows: [ { a: 1 }, { b: 2 } ] }) ]);
    store.updateBlockData('b1', 'rows', [ { a: 1 }, [ [ 'x' ] ] ]);

    // The grid branch must not be entered for a slot that holds a plain Y.Map.
    expect(emittedBlock(store, 'b1').data.rows).toEqual([ { a: 1 }, [ [ 'x' ] ] ]);
  });

  it('keeps a hand-written Y.Array whose plain value already matches', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { keep: 1 } }) ]);
    // Only a foreign writer stores a bare Y.Array of primitives; a plain one
    // would be a leaf, but the read-back is identical either way.
    store.transact(() => {
      const data = store.getBlockById('b1')?.get('data');

      if (data instanceof Y.Map && data.get('meta') instanceof Y.Map) {
        (data.get('meta') as Y.Map<unknown>).set('list', Y.Array.from([ 1, 2 ]));
      }
    }, 'local');

    const meta = rawData(store, 'b1', 'meta');
    const before = meta instanceof Y.Map ? meta.get('list') : undefined;

    store.updateBlockData('b1', 'meta', { list: [ 1, 2 ], keep: 2 });

    const after = rawData(store, 'b1', 'meta');

    // An equal value must not replace the container it already matches.
    expect(after instanceof Y.Map ? after.get('list') : undefined).toBe(before);
  });

  it('keeps a grid wrapper whose rows are all stranded', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { meta: { grid: [ [ 'a' ] ], keep: 1 } }) ]);
    store.transact(() => {
      const data = store.getBlockById('b1')?.get('data');
      const meta = data instanceof Y.Map ? data.get('meta') : undefined;
      const grid = meta instanceof Y.Map ? meta.get('grid') : undefined;
      const rows = grid instanceof Y.Map ? grid.get(GRID_ROWS_KEY) : undefined;

      if (rows instanceof Y.Map) {
        for (const key of Array.from(rows.keys())) {
          rows.delete(key);
        }
      }
    }, 'local');

    const meta = rawData(store, 'b1', 'meta');
    const before = meta instanceof Y.Map ? meta.get('grid') : undefined;

    store.updateBlockData('b1', 'meta', { grid: [], keep: 2 });

    const after = rawData(store, 'b1', 'meta');

    // The wrapper reads back as an empty grid, which equals the plain [] — an
    // equal value must not be re-written over it.
    expect(after instanceof Y.Map ? after.get('grid') : undefined).toBe(before);
  });

  it('reports no write for an unknown block or a foreign data shape', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.transact(() => {
      store.getBlockById('b1')?.set('data', 'broken');
    }, 'local');

    expect(store.pruneBlockData('ghost', new Set())).toBe(false);
    expect(store.pruneBlockData('b1', new Set())).toBe(false);
  });

  it('reports no write when every key is kept', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);

    expect(store.pruneBlockData('b1', new Set([ 'text' ]))).toBe(false);
  });
});

describe('DocumentStore — tunes and metadata', () => {
  it('merges successive tune writes into the same tunes map', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.updateBlockTune('b1', 'align', 'center');
    store.updateBlockTune('b1', 'color', 'red');

    // Creating a fresh tunes map per write drops the earlier tune.
    expect(emittedBlock(store, 'b1').tunes).toEqual({ align: 'center', color: 'red' });
  });

  it('reports no metadata write for an unknown block', () => {
    const store = createStore();

    expect(store.updateBlockMetadata('ghost', 1, null)).toBe(false);
  });

  it('reports no metadata write when both fields already match', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.updateBlockMetadata('b1', 5, 'user-1');

    expect(originsOf(store, () => store.updateBlockMetadata('b1', 5, 'user-1'))).toEqual([]);
    expect(store.updateBlockMetadata('b1', 5, 'user-1')).toBe(false);
  });

  it('writes a new timestamp when only the timestamp moved', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.updateBlockMetadata('b1', 1, 'user-1');

    expect(store.updateBlockMetadata('b1', 2, 'user-1')).toBe(true);
    expect(emittedBlock(store, 'b1').lastEditedAt).toBe(2);
  });

  it('drops the author key when an edit carries no author', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.updateBlockMetadata('b1', 1, 'user-1');

    expect(store.updateBlockMetadata('b1', 2, null)).toBe(true);

    const emitted = emittedBlock(store, 'b1');

    expect('lastEditedBy' in emitted).toBe(false);
    expect(emitted.lastEditedAt).toBe(2);
  });
});

describe('DocumentStore — the binary seam', () => {
  /** A peer holding one block, and the update that carries it. */
  const updateFromPeer = (id: string): Uint8Array => {
    const peer = createStore();

    peer.addBlock(block(id, { text: id }));

    return peer.encodeStateAsUpdate();
  };

  it('delivers local updates to onUpdate, and stops at the unsubscribe', () => {
    const store = createStore();
    const seen: Uint8Array[] = [];

    const off = store.onUpdate((update) => seen.push(update));

    store.addBlock(block('b1', { text: 'a' }));
    expect(seen).toHaveLength(1);

    off();
    store.addBlock(block('b2', { text: 'b' }));
    expect(seen).toHaveLength(1);
  });

  it('delivers local updates to onAnyUpdate, and stops at the unsubscribe', () => {
    const store = createStore();
    const seen: Uint8Array[] = [];

    const off = store.onAnyUpdate((update) => seen.push(update));

    store.addBlock(block('b1', { text: 'a' }));
    expect(seen).toHaveLength(1);

    off();
    store.addBlock(block('b2', { text: 'b' }));
    expect(seen).toHaveLength(1);
  });

  it('hides an inbound remote update from onUpdate but not from onAnyUpdate', () => {
    const store = createStore();
    const filtered: Uint8Array[] = [];
    const all: Uint8Array[] = [];

    store.onUpdate((update) => filtered.push(update));
    store.onAnyUpdate((update) => all.push(update));

    store.applyRemoteUpdate(updateFromPeer('p1'), { source: 'peer' });

    expect(store.toJSON().map((entry) => entry.id)).toEqual([ 'p1' ]);
    expect(filtered).toEqual([]);
    expect(all).toHaveLength(1);
  });

  it('refuses a local origin tag before touching the document', () => {
    const store = createStore();

    expect(() => store.applyRemoteUpdate(updateFromPeer('p1'), 'local')).toThrowError(
      new Error(
        'applyRemoteUpdate: "local" is a local origin tag; remote updates must carry a provider origin so undo scoping and remote classification stay correct'
      )
    );
    expect(store.toJSON()).toEqual([]);
  });

  it('remembers a primitive provider origin and suppresses its echo', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];

    store.onUpdate((update) => delivered.push(update));

    // WeakSet.add throws on a primitive, so the object/primitive split matters.
    expect(() => store.applyRemoteUpdate(updateFromPeer('p1'), 'provider-tag')).not.toThrow();
    expect(delivered).toEqual([]);

    // The tag stays suppressed for a later transaction carrying it.
    store.transact(
      () => store.getBlockById('p1')?.set('type', 'header'),
      'provider-tag' as unknown as LocalOriginTag
    );

    expect(delivered).toEqual([]);
  });

  it('stamps the module sentinel on an update applied with no origin', () => {
    const store = createStore();
    const origins: unknown[] = [];

    store.onAnyUpdate((_update, origin) => origins.push(origin));
    store.applyRemoteUpdate(updateFromPeer('p1'));

    expect(origins).toEqual([ { source: 'blok-remote-apply' } ]);
  });

  it('forgets a primitive provider origin when the document is replaced', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];

    store.onUpdate((update) => delivered.push(update));
    store.applyRemoteUpdate(updateFromPeer('p1'), 'old-provider-tag');
    store.resetForRelineage();
    store.addBlock(block('b1', { text: 'fresh' }));

    // The fresh document has no remote origins yet, so a tag from the old
    // lineage must not be read as remote and swallowed.
    delivered.length = 0;
    store.transact(
      () => store.getBlockById('b1')?.set('type', 'header'),
      'old-provider-tag' as unknown as LocalOriginTag
    );

    expect(delivered).toHaveLength(1);
  });
});

describe('DocumentStore — awareness seam', () => {
  /** One awareness frame: a state per client id, exactly as y-protocols encodes it. */
  const frameFor = (entries: Array<{ clientId: number; clock: number; state: unknown }>): Uint8Array => {
    const encoder = encoding.createEncoder();

    encoding.writeVarUint(encoder, entries.length);

    for (const entry of entries) {
      encoding.writeVarUint(encoder, entry.clientId);
      encoding.writeVarUint(encoder, entry.clock);
      encoding.writeVarString(encoder, JSON.stringify(entry.state));
    }

    return encoding.toUint8Array(encoder);
  };

  /** The client ids an encoded awareness frame carries. */
  const clientsInFrame = (frame: Uint8Array): number[] => {
    const decoder = decoding.createDecoder(frame);
    const count = decoding.readVarUint(decoder);
    const ids: number[] = [];

    for (let index = 0; index < count; index += 1) {
      ids.push(decoding.readVarUint(decoder));
      decoding.readVarUint(decoder);
      decoding.readVarString(decoder);
    }

    return ids;
  };

  // lib0's `getUnixTime` IS `Date.now`, and y-protocols stamps meta rows from
  // the real clock, so a row is aged by moving the SEAM's clock past the real
  // one. y-protocols is an external module: vi.mock never reaches it.
  const TOMBSTONE_TTL_MS = 90_000;

  const clockAfter = (deltaMs: number): void => {
    vi.mocked(getUnixTime).mockReturnValue(Date.now() + deltaMs);
  };

  /** y-protocols' private bookkeeping, read only to measure the exact boundary. */
  const stampedAt = (store: DocumentStore, clientId: number): number => {
    const internals = store as unknown as {
      awareness: { meta: Map<number, { lastUpdated: number }> } | null;
    };
    const row = internals.awareness?.meta.get(clientId);

    if (row === undefined) {
      throw new Error(`no awareness meta row for client ${clientId}`);
    }

    return row.lastUpdated;
  };

  const ghostFrame = (clock: number, state: unknown): Uint8Array =>
    frameFor([ { clientId: 999, clock, state } ]);

  it('names the caller when presence was never enabled', () => {
    const store = createStore();

    expect(() => store.onAwarenessChange(() => {})).toThrowError(
      new Error('DocumentStore.onAwarenessChange: awareness not enabled; call enableAwareness() first')
    );
    expect(() => store.onAwarenessUpdate(() => {})).toThrowError(
      new Error('DocumentStore.onAwarenessUpdate: awareness not enabled; call enableAwareness() first')
    );
    expect(() => store.encodeAwarenessUpdate()).toThrowError(
      new Error('DocumentStore.encodeAwarenessUpdate: awareness not enabled; call enableAwareness() first')
    );
  });

  it('ignores every presence call before presence is on', () => {
    const store = createStore();

    expect(() => store.setAwarenessField('user', { name: 'Ada' })).not.toThrow();
    expect(() => store.applyAwarenessUpdate(ghostFrame(1, { user: 'ghost' }), 'peer')).not.toThrow();
    expect(() => store.clearRemoteAwarenessStates()).not.toThrow();
    expect(store.getAwarenessStates().size).toBe(0);
    expect(store.encodeLocalAwarenessDeparture()).toBeNull();
  });

  it('delivers filtered presence deltas and stops at the unsubscribe', () => {
    const store = createStore();
    const changes: AwarenessChange[] = [];

    store.enableAwareness();

    const off = store.onAwarenessChange((change) => changes.push(change));

    store.setAwarenessField('user', { name: 'Ada' });
    expect(changes).toHaveLength(1);

    off();
    store.setAwarenessField('user', { name: 'Grace' });
    expect(changes).toHaveLength(1);
  });

  it('delivers the unfiltered presence emission, keepalive included', () => {
    const store = createStore();
    const changes: AwarenessChange[] = [];
    const filtered: AwarenessChange[] = [];

    store.enableAwareness();
    store.onAwarenessUpdate((change) => changes.push(change));
    store.onAwarenessChange((change) => filtered.push(change));

    // Same content again: y-protocols' 'change' filters it out, 'update' does not.
    store.setAwarenessField('user', { name: 'Ada' });
    store.setAwarenessField('user', { name: 'Ada' });

    expect(changes).toHaveLength(2);
    expect(filtered).toHaveLength(1);
  });

  it('clears every remote peer and names the local origin', () => {
    const store = createStore();
    const origins: unknown[] = [];

    store.enableAwareness();
    store.onAwarenessChange((_change, origin) => origins.push(origin));
    store.applyAwarenessUpdate(ghostFrame(1, { user: 'ghost' }), 'peer');
    store.setAwarenessField('user', { name: 'Ada' });
    origins.length = 0;

    store.clearRemoteAwarenessStates();

    expect(store.getAwarenessStates().has(999)).toBe(false);
    expect(store.getAwarenessStates().size).toBe(1);
    expect(origins).toEqual([ 'local' ]);
  });

  it('drops a stateless tombstone once it outlives the tombstone age', () => {
    const store = createStore();

    store.enableAwareness();
    store.applyAwarenessUpdate(ghostFrame(1, { user: 'ghost' }), 'peer');
    // The peer departs: its state goes, its tombstone row stays.
    store.applyAwarenessUpdate(ghostFrame(2, null), 'peer');

    expect(store.getAwarenessStates().has(999)).toBe(false);
    expect(clientsInFrame(store.encodeAwarenessUpdate([ 999 ]))).toEqual([ 999 ]);

    clockAfter(TOMBSTONE_TTL_MS + 1);
    store.applyAwarenessUpdate(frameFor([]), 'peer');

    expect(clientsInFrame(store.encodeAwarenessUpdate([ 999 ]))).toEqual([]);
  });

  it('keeps a tombstone that is exactly as old as the tombstone age', () => {
    const store = createStore();

    store.enableAwareness();
    store.applyAwarenessUpdate(ghostFrame(1, { user: 'ghost' }), 'peer');
    store.applyAwarenessUpdate(ghostFrame(2, null), 'peer');

    vi.mocked(getUnixTime).mockReturnValue(stampedAt(store, 999) + TOMBSTONE_TTL_MS);
    store.applyAwarenessUpdate(frameFor([]), 'peer');

    // A row exactly at the age is still the tombstone that rejects a relayed
    // state whose clock it already holds.
    expect(clientsInFrame(store.encodeAwarenessUpdate([ 999 ]))).toEqual([ 999 ]);
  });

  it('keeps an aged row whose client still holds a state', () => {
    const store = createStore();

    store.enableAwareness();
    store.applyAwarenessUpdate(ghostFrame(1, { user: 'live' }), 'peer');

    clockAfter(TOMBSTONE_TTL_MS * 10);
    store.applyAwarenessUpdate(frameFor([]), 'peer');

    expect(clientsInFrame(store.encodeAwarenessUpdate([ 999 ]))).toEqual([ 999 ]);
  });
});

describe('DocumentStore — lineage reset', () => {
  it('unhooks the seam from the document it is discarding', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];
    const discarded = store.blocksMap;
    const discardedDoc = discarded.doc;

    if (discardedDoc === null) {
      throw new Error('the blocks map must be attached to a document');
    }

    store.onUpdate((update) => delivered.push(update));
    store.resetForRelineage();

    discardedDoc.transact(() => {
      discarded.set('ghost', new Y.Map());
    }, 'local');

    expect(delivered).toEqual([]);
    expect(discardedDoc.isDestroyed).toBe(true);
  });

  it('drops the seam subscriptions an unsubscribe removed before the reset', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];
    const all: Uint8Array[] = [];

    const offFiltered = store.onUpdate((update) => delivered.push(update));
    const offAny = store.onAnyUpdate((update) => all.push(update));

    offFiltered();
    offAny();
    store.resetForRelineage();
    store.addBlock(block('b1', { text: 'after the reset' }));

    // A subscription that was dropped before the swap must not come back.
    expect(delivered).toEqual([]);
    expect(all).toEqual([]);
  });

  it('keeps the document shape a peer can merge with', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { text: 'a' }) ]);
    store.resetForRelineage();
    store.addBlock(block('b2', { text: 'fresh' }));

    const peer = createStore();

    peer.applyRemoteUpdate(store.encodeStateAsUpdate());

    // A root type created under another name merges with nothing on the peer.
    expect(peer.blocksMap.has('b2')).toBe(true);
    expect(peer.toJSON().map((entry) => entry.id)).toEqual([ 'b2' ]);
  });

  it('names the swapped roots so a peer reads the same order', () => {
    const store = createStore();

    store.resetForRelineage();
    store.addBlock(block('z', { text: 'first in the document' }));
    store.addBlock(block('a', { text: 'second in the document' }));

    const peer = createStore();

    peer.applyRemoteUpdate(store.encodeStateAsUpdate());

    // Sorted-by-id is what an unexpected root array name falls back to.
    expect(peer.toJSON().map((entry) => entry.id)).toEqual([ 'z', 'a' ]);
  });

  it('rebuilds awareness on the fresh document with the local state kept', () => {
    const store = createStore();

    store.enableAwareness();
    store.setAwarenessField('user', { name: 'Ada' });
    store.resetForRelineage();

    const states = store.getAwarenessStates();

    expect(states.size).toBe(1);

    const [ clientId ] = Array.from(states.keys());

    if (clientId === undefined) {
      throw new Error('the reset must keep the local presence state');
    }

    expect(states.get(clientId)).toEqual({ user: { name: 'Ada' } });
  });

  it('leaves presence off when it was never enabled', () => {
    const store = createStore();

    store.resetForRelineage();

    expect(store.getAwarenessStates().size).toBe(0);
    expect(() => store.encodeAwarenessUpdate()).toThrowError(
      new Error('DocumentStore.encodeAwarenessUpdate: awareness not enabled; call enableAwareness() first')
    );
  });

  it('re-attaches every seam subscription to the fresh document', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];

    const off = store.onUpdate((update) => delivered.push(update));

    store.resetForRelineage();
    store.addBlock(block('b1', { text: 'after the swap' }));

    expect(delivered).toHaveLength(1);

    off();
    store.addBlock(block('b2', { text: 'after the unsubscribe' }));

    expect(delivered).toHaveLength(1);
  });

  it('does not resurrect a seam subscription a destroy let go', () => {
    const store = createStore();
    const delivered: Uint8Array[] = [];

    store.onUpdate((update) => delivered.push(update));
    store.destroy();
    store.resetForRelineage();
    store.addBlock(block('b1', { text: 'after the destroy' }));

    // destroy() drops the subscriptions; a later document swap has nothing
    // left to re-attach.
    expect(delivered).toEqual([]);
  });
});

describe('DocumentStore — grid row pairing', () => {
  it('splices away the documented rows an unequal-length edit removed', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { rows: [ { a: 1 }, { b: 2 }, { c: 3 } ] }) ]);

    store.updateBlockData('b1', 'rows', [ { a: 9 }, { c: 3 } ]);

    // Rewriting without deleting the middle leaves the removed rows behind.
    expect(emittedBlock(store, 'b1').data.rows).toEqual([ { a: 9 }, { c: 3 } ]);
  });

  it('diffs a grid nested inside a plain array element', () => {
    const store = createStore();

    store.fromJSON([ block('b1', { rows: [ { a: 1 }, [ [ 'x', 'y' ] ] ] }) ]);

    store.updateBlockData('b1', 'rows', [ { a: 1 }, [ [ 'x', 'z' ] ] ]);

    expect(emittedBlock(store, 'b1').data.rows).toEqual([ { a: 1 }, [ [ 'x', 'z' ] ] ]);
  });

  it('never pairs two source rows with the same row key', () => {
    const store = createStore();

    store.fromJSON([
      block('b1', { rows: [ [ 'a', 'x' ], [ 'b', 'x' ], [ 'c', 'x' ], [ 'd', 'x' ] ] }),
    ]);

    // The middle rows are edits of rows one and two, in the other order; the
    // similarity pass must not hand a row key to a second source row.
    store.updateBlockData('b1', 'rows', [ [ 'b', 'y' ], [ 'b', 'z' ], [ 'a', 'y' ] ]);

    expect(emittedBlock(store, 'b1').data.rows).toEqual([ [ 'b', 'y' ], [ 'b', 'z' ], [ 'a', 'y' ] ]);
  });

  it('carries a concurrent cell edit through a reorder', () => {
    const { a, b } = seededPair([ block('b1', { rows: [ [ 'a1' ], [ 'b1' ] ] }) ]);

    // A types into the second row while B swaps the two rows.
    a.updateBlockData('b1', 'rows', [ [ 'a1' ], [ 'b1-edited' ] ]);
    b.updateBlockData('b1', 'rows', [ [ 'b1' ], [ 'a1' ] ]);

    sync(a, b);

    // A pairing that mints a fresh row for the moved one deletes the container
    // the edit landed in, so the typed cell disappears.
    expect(emittedBlock(a, 'b1').data.rows).toEqual([ [ 'b1-edited' ], [ 'a1' ] ]);
    expect(a.toJSON()).toEqual(b.toJSON());
  });
});
