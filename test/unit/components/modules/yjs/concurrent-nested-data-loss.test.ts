import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

type Cell = { blocks: string[]; color?: string; text?: string };
type Row = Cell[];

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/**
 * Fix a store's Yjs client id, so a tie between two concurrent writes at the
 * same position resolves the same way on every run.
 */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const twoPeers = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.data ?? {};

const tunesOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.tunes ?? {};

const gridOf = (store: DocumentStore, id = 'T'): Row[] => dataOf(store, id).content as Row[];

const cellOf = (store: DocumentStore, row: number, col: number, id = 'T'): Cell =>
  gridOf(store, id)[row][col];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const table = (): YjsOutputBlockData[] => [
  {
    id: 'T',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['r0c0'] }, { blocks: ['r0c1'] }],
        [{ blocks: ['r1c0'] }, { blocks: ['r1c1'] }],
      ] as Row[],
    },
  },
];

/**
 * A block's `tunes` Y.Map is created LAZILY, by whichever peer writes a tune
 * first (`getOrCreateTunesMap`). `contentIds` and a mergeable `Y.Text` are both
 * created EAGERLY for exactly this reason: a lazily-created container means two
 * peers can `set` two different fresh maps over the same key, and map-set is
 * last-writer-wins — the loser's map is discarded WITH the tune inside it.
 */
describe('tunes — a container created lazily by whichever peer writes first', () => {
  it('keeps both tunes when two peers add a DIFFERENT tune to a block that had none', () => {
    const { a, b } = twoPeers([{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }]);

    a.updateBlockTune('b1', 'align', { value: 'center' });
    b.updateBlockTune('b1', 'textColor', { color: 'red' });

    sync(a, b);

    expect(tunesOf(a, 'b1')).toEqual({ align: { value: 'center' },
      textColor: { color: 'red' } });
    expect(tunesOf(b, 'b1')).toEqual(tunesOf(a, 'b1'));
  });

  it('keeps both tunes when one peer writes a tune onto a block that already carries another', () => {
    const { a, b } = twoPeers([
      { id: 'b1', type: 'paragraph', data: { text: 'hi' }, tunes: { align: { value: 'left' } } },
    ]);

    a.updateBlockTune('b1', 'align', { value: 'center' });
    b.updateBlockTune('b1', 'textColor', { color: 'red' });

    sync(a, b);

    expect(tunesOf(a, 'b1')).toEqual({ align: { value: 'center' },
      textColor: { color: 'red' } });
  });

  /**
   * A tune VALUE is stored as a plain leaf (`stripNulDeep`), never a Y.Map, so
   * two peers touching different sub-fields of one tune cannot merge.
   */
  it('keeps both sub-fields when two peers change different fields of the SAME tune', () => {
    const { a, b } = twoPeers([
      {
        id: 'b1',
        type: 'paragraph',
        data: { text: 'hi' },
        tunes: { textColor: { color: 'black', background: 'none' } },
      },
    ]);

    a.updateBlockTune('b1', 'textColor', { color: 'red',
      background: 'none' });
    b.updateBlockTune('b1', 'textColor', { color: 'black',
      background: 'yellow' });

    sync(a, b);

    expect(tunesOf(a, 'b1').textColor).toEqual({ color: 'red',
      background: 'yellow' });
  });
});

/**
 * `pruneBlockData` takes a `seen` set so a full save cannot delete a TOP-LEVEL
 * key a peer added while that save was in flight. `deepAssignYMap` performs the
 * same deletion one level DOWN and has no such guard — it deletes every target
 * key the (possibly stale) source omits.
 */
describe('nested keys — a stale full save deletes what the peer just wrote', () => {
  it('keeps a cell colour a peer set while the other peer\'s full-grid save was in flight', () => {
    const { a, b } = twoPeers(table());
    // B's save() captured the grid BEFORE A's colour write reached it.
    const bStale = clone(gridOf(b));

    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].color = 'red';

      return next;
    })());

    sync(a, b);

    // B's in-flight save now lands, carrying B's own edit in another cell.
    bStale[1][1].blocks = ['r1c1', 'added-by-b'];
    b.updateBlockData('T', 'content', bStale);

    sync(a, b);

    expect(cellOf(a, 0, 0).color).toBe('red');
    expect(cellOf(a, 1, 1).blocks).toEqual(['r1c1', 'added-by-b']);
  });

  it('keeps a database-row property a peer added while the other peer\'s save was in flight', () => {
    const { a, b } = twoPeers([
      { id: 'R', type: 'database-row', data: { properties: { status: 'todo' } } },
    ]);
    const bStale = clone(dataOf(b, 'R').properties as Record<string, unknown>);

    a.updateBlockData('R', 'properties', { status: 'todo',
      priority: 'high' });

    sync(a, b);

    bStale.status = 'done';
    b.updateBlockData('R', 'properties', bStale);

    sync(a, b);

    expect((dataOf(a, 'R').properties as Record<string, unknown>).priority).toBe('high');
    expect((dataOf(a, 'R').properties as Record<string, unknown>).status).toBe('done');
  });
});

/**
 * Grid ROWS are keyed so a row keeps its CRDT container across a reorder or an
 * insert. The CELLS inside a row are a plain `Y.Array` diffed POSITIONALLY, so
 * an unequal-length middle is expressed as delete+insert — which recreates the
 * cell containers in that middle and throws away whatever a peer concurrently
 * wrote into them.
 */
describe('cells inside a row — positional, not keyed', () => {
  it('keeps a peer\'s cell edit when the other peer inserts a column and edits a cell in one write', () => {
    const { a, b } = twoPeers(table());

    // B adds a block to cell (0,0).
    b.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(b));

      next[0][0].blocks = ['r0c0', 'added-by-b'];

      return next;
    })());

    // A, in ONE save, inserts a column after the first AND edits cell (0,0).
    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].color = 'red';
      next[0].splice(1, 0, { blocks: [] });
      next[1].splice(1, 0, { blocks: [] });

      return next;
    })());

    sync(a, b);

    expect(cellOf(a, 0, 0).blocks).toEqual(['r0c0', 'added-by-b']);
    expect(cellOf(a, 0, 0).color).toBe('red');
    expect(gridOf(a)[0]).toHaveLength(3);
  });

  it('keeps every row the same width when one peer adds a row and the other adds a column', () => {
    const { a, b } = twoPeers(table());

    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next.push([{ blocks: ['r2c0'] }, { blocks: ['r2c1'] }]);

      return next;
    })());

    b.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(b));

      next.forEach((row) => row.push({ blocks: [] }));

      return next;
    })());

    sync(a, b);

    const widths = gridOf(a).map((row) => row.length);

    expect(new Set(widths).size).toBe(1);
    expect(gridOf(a)).toHaveLength(3);
  });
});

/**
 * A nested object key the block does not carry yet is written with a whole-key
 * `set` (`updateBlockData`'s generic tail, `assignYMapEntry`'s tail) — so two
 * peers first-writing it at once is last-writer-wins, and the loser's whole
 * sub-object is discarded.
 */
describe('a nested map born on two peers at once', () => {
  it('keeps both properties when two peers first-write data.properties at the same instant', () => {
    const { a, b } = twoPeers([{ id: 'R', type: 'database-row', data: { title: 'row' } }]);

    a.updateBlockData('R', 'properties', { status: 'todo' });
    b.updateBlockData('R', 'properties', { priority: 'high' });

    sync(a, b);

    expect(dataOf(a, 'R').properties).toEqual({ status: 'todo',
      priority: 'high' });
  });

  it('keeps both block ids when two peers first-write a cell\'s blocks list at the same instant', () => {
    const { a, b } = twoPeers([
      { id: 'T', type: 'table', data: { content: [[{}, {}]] } },
    ]);

    a.updateBlockData('T', 'content', [[{ blocks: ['from-a'] }, {}]]);
    b.updateBlockData('T', 'content', [[{ blocks: ['from-b'] }, {}]]);

    sync(a, b);

    expect(cellOf(a, 0, 0).blocks?.sort()).toEqual(['from-a', 'from-b']);
  });
});

/**
 * A row of legacy STRING cells is a primitive array, which the array rule keeps
 * as an atomic leaf — so the whole row is one last-writer-wins value.
 */
describe('legacy string cells — a whole row is one leaf', () => {
  it('keeps both edits when two peers edit different cells of one legacy row', () => {
    const { a, b } = twoPeers([
      { id: 'T', type: 'table', data: { content: [['a', 'b'], ['c', 'd']] } },
    ]);

    a.updateBlockData('T', 'content', [['A', 'b'], ['c', 'd']]);
    b.updateBlockData('T', 'content', [['a', 'B'], ['c', 'd']]);

    sync(a, b);

    expect(dataOf(a, 'T').content).toEqual([['A', 'B'], ['c', 'd']]);
  });
});

/** `colWidths` is a primitive array, so it is one atomic leaf too. */
describe('colWidths — a primitive array is one leaf', () => {
  it('keeps both resizes when two peers drag different column borders', () => {
    const { a, b } = twoPeers([
      { id: 'T', type: 'table', data: { content: [[{ blocks: [] }]], colWidths: [200, 300] } },
    ]);

    a.updateBlockData('T', 'colWidths', [250, 300]);
    b.updateBlockData('T', 'colWidths', [200, 350]);

    sync(a, b);

    expect(dataOf(a, 'T').colWidths).toEqual([250, 350]);
  });
});

/**
 * A nested `text` is deliberately a LEAF (only TOP-LEVEL diffable keys become a
 * `Y.Text`), so two people typing in one table cell is last-writer-wins for the
 * whole burst. Pinned here so the cost stays visible.
 */
describe('a table cell\'s nested text', () => {
  it('keeps both peers\' typing when they type in the same cell', () => {
    const { a, b } = twoPeers([
      { id: 'T', type: 'table', data: { content: [[{ blocks: [], text: 'Hello world' }]] } },
    ]);

    a.updateBlockData('T', 'content', [[{ blocks: [], text: 'Hello world AAA' }]]);
    b.updateBlockData('T', 'content', [[{ blocks: [], text: 'Hello BBB world' }]]);

    sync(a, b);

    expect(cellOf(a, 0, 0).text).toBe('Hello BBB world AAA');
  });
});

/** Behaviour that already holds — kept so a regression here is caught. */
describe('nested edits that already merge', () => {
  let a: DocumentStore;
  let b: DocumentStore;

  beforeEach(() => {
    ({ a, b } = twoPeers(table()));
  });

  it('merges two peers editing DIFFERENT cells of the same row', () => {
    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].blocks = ['r0c0', 'from-a'];

      return next;
    })());
    b.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(b));

      next[0][1].blocks = ['r0c1', 'from-b'];

      return next;
    })());

    sync(a, b);

    expect(cellOf(a, 0, 0).blocks).toEqual(['r0c0', 'from-a']);
    expect(cellOf(a, 0, 1).blocks).toEqual(['r0c1', 'from-b']);
  });

  it('merges two peers editing cells in DIFFERENT rows', () => {
    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].blocks = ['r0c0', 'from-a'];

      return next;
    })());
    b.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(b));

      next[1][1].blocks = ['r1c1', 'from-b'];

      return next;
    })());

    sync(a, b);

    expect(cellOf(a, 0, 0).blocks).toEqual(['r0c0', 'from-a']);
    expect(cellOf(a, 1, 1).blocks).toEqual(['r1c1', 'from-b']);
  });

  it('keeps both block ids when two peers add one to the SAME cell', () => {
    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].blocks = ['r0c0', 'from-a'];

      return next;
    })());
    b.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(b));

      next[0][0].blocks = ['r0c0', 'from-b'];

      return next;
    })());

    sync(a, b);

    expect(cellOf(a, 0, 0).blocks.sort()).toEqual(['from-a', 'from-b', 'r0c0']);
  });

  it('keeps both rows when two peers append a row at the same instant', () => {
    a.updateBlockData('T', 'content', [...clone(gridOf(a)), [{ blocks: ['a2c0'] }, { blocks: ['a2c1'] }]]);
    b.updateBlockData('T', 'content', [...clone(gridOf(b)), [{ blocks: ['b2c0'] }, { blocks: ['b2c1'] }]]);

    sync(a, b);

    expect(gridOf(a)).toHaveLength(4);
    expect(gridOf(a).flat().map((cell) => cell.blocks[0])).toContain('a2c0');
    expect(gridOf(a).flat().map((cell) => cell.blocks[0])).toContain('b2c0');
  });

  it('merges two peers adding a different property to an EXISTING properties map', () => {
    const peers = twoPeers([
      { id: 'R', type: 'database-row', data: { properties: { status: 'todo' } } },
    ]);

    peers.a.updateBlockData('R', 'properties', { status: 'todo',
      owner: 'ann' });
    peers.b.updateBlockData('R', 'properties', { status: 'todo',
      priority: 'high' });

    sync(peers.a, peers.b);

    expect(dataOf(peers.a, 'R').properties).toEqual({ status: 'todo',
      owner: 'ann',
      priority: 'high' });
  });

  it('never leaks a grid row key into OutputData', () => {
    a.updateBlockData('T', 'content', (() => {
      const next = clone(gridOf(a));

      next[0][0].blocks = ['r0c0', 'from-a'];

      return next;
    })());

    const content = dataOf(a, 'T').content;

    expect(Array.isArray(content)).toBe(true);
    expect(JSON.stringify(content)).not.toContain('__rows');
    expect(a.getBlockById('T')).toBeInstanceOf(Y.Map);
  });
});
