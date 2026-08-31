import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';

type Cell = { blocks: string[] };
type Row = Cell[];

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/**
 * Exchange diffs computed against each peer's pre-exchange state vector.
 */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const grid = (): Row[] => [
  [{ blocks: ['r0c0'] }, { blocks: ['r0c1'] }],
  [{ blocks: ['r1c0'] }, { blocks: ['r1c1'] }],
  [{ blocks: ['r2c0'] }, { blocks: ['r2c1'] }],
  [{ blocks: ['r3c0'] }, { blocks: ['r3c1'] }],
];

const readGrid = (store: DocumentStore): unknown => {
  return store.toJSON().find((block) => block.id === 'T')?.data.content;
};

/**
 * The Y container holding the cells of the row at `displayIndex`, resolved
 * against BOTH shapes: the keyed grid wrapper and a bare rows Y.Array (the
 * pre-identity format). Reference identity of this container is what a
 * concurrent peer's cell edit is addressed to.
 */
const rowContainer = (store: DocumentStore, blockId: string, displayIndex: number): unknown => {
  const yblock = store.getBlockById(blockId) as Y.Map<unknown>;
  const content = (yblock.get('data') as Y.Map<unknown>).get('content');

  if (content instanceof Y.Array) {
    return content.get(displayIndex);
  }

  if (!(content instanceof Y.Map)) {
    return undefined;
  }

  const keys = content.get('__rowKeys') as Y.Array<string>;
  const rows = content.get('__rows') as Y.Map<unknown>;

  return rows.get(keys.get(displayIndex));
};

describe('DocumentStore grid identity laws — rows keep their Y container', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    storeA.fromJSON([{ id: 'T', type: 'table', data: { content: grid() } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('coalesced row-insert + row-edit vs a concurrent cell edit in that row: both edits survive', () => {
    // The exact shape the 400ms write buffer coalesces: one write carrying a
    // row insert AND an edit inside an existing row.
    const onA = grid();

    onA[1] = [{ blocks: ['r1c0-A-EDIT'] }, onA[1][1]];
    onA.splice(1, 0, [{ blocks: ['NEWc0'] }, { blocks: ['NEWc1'] }]);
    storeA.updateBlockData('T', 'content', onA);

    const onB = grid();

    onB[1] = [onB[1][0], { blocks: ['r1c1-B-TYPED'] }];
    storeB.updateBlockData('T', 'content', onB);

    sync(storeA, storeB);

    expect(readGrid(storeA)).toEqual(readGrid(storeB));
    expect(readGrid(storeA)).toEqual([
      [{ blocks: ['r0c0'] }, { blocks: ['r0c1'] }],
      [{ blocks: ['NEWc0'] }, { blocks: ['NEWc1'] }],
      [{ blocks: ['r1c0-A-EDIT'] }, { blocks: ['r1c1-B-TYPED'] }],
      [{ blocks: ['r2c0'] }, { blocks: ['r2c1'] }],
      [{ blocks: ['r3c0'] }, { blocks: ['r3c1'] }],
    ]);
  });

  it('row swap vs a concurrent cell edit: the edit follows its row to the new position', () => {
    const onA = grid();

    [onA[1], onA[2]] = [onA[2], onA[1]];
    storeA.updateBlockData('T', 'content', onA);

    const onB = grid();

    onB[1] = [{ blocks: ['r1c0-TYPED'] }, onB[1][1]];
    storeB.updateBlockData('T', 'content', onB);

    sync(storeA, storeB);

    expect(readGrid(storeA)).toEqual(readGrid(storeB));
    expect(readGrid(storeA)).toEqual([
      [{ blocks: ['r0c0'] }, { blocks: ['r0c1'] }],
      [{ blocks: ['r2c0'] }, { blocks: ['r2c1'] }],
      [{ blocks: ['r1c0-TYPED'] }, { blocks: ['r1c1'] }],
      [{ blocks: ['r3c0'] }, { blocks: ['r3c1'] }],
    ]);
  });

  it('a reorder never recreates a row container: the same Y object moves', () => {
    const beforeRow1 = rowContainer(storeA, 'T', 1);

    expect(beforeRow1).toBeDefined();

    const next = grid();

    [next[1], next[2]] = [next[2], next[1]];
    storeA.updateBlockData('T', 'content', next);

    // Row 1's content is now displayed at index 2 — same container, moved.
    expect(rowContainer(storeA, 'T', 2)).toBe(beforeRow1);
  });

  it('a row insert never recreates the containers of the rows around it', () => {
    const before = [0, 1, 2, 3].map((index) => rowContainer(storeA, 'T', index));

    const next = grid();

    next.splice(1, 0, [{ blocks: ['NEWc0'] }, { blocks: ['NEWc1'] }]);
    storeA.updateBlockData('T', 'content', next);

    expect(rowContainer(storeA, 'T', 0)).toBe(before[0]);
    expect(rowContainer(storeA, 'T', 2)).toBe(before[1]);
    expect(rowContainer(storeA, 'T', 3)).toBe(before[2]);
    expect(rowContainer(storeA, 'T', 4)).toBe(before[3]);
  });

  it('concurrent reorders converge with every row present exactly once', () => {
    const onA = grid();

    [onA[1], onA[2]] = [onA[2], onA[1]];
    storeA.updateBlockData('T', 'content', onA);

    const onB = grid();

    [onB[0], onB[3]] = [onB[3], onB[0]];
    storeB.updateBlockData('T', 'content', onB);

    sync(storeA, storeB);

    expect(readGrid(storeA)).toEqual(readGrid(storeB));

    const rows = readGrid(storeA) as Row[];
    const firstCells = rows.map((row) => row[0].blocks[0]).sort();

    expect(firstCells).toEqual(['r0c0', 'r1c0', 'r2c0', 'r3c0']);

    // A follow-up local write still diffs cleanly against the merged order.
    const edited = rows.map((row) => row.map((cell) => ({ ...cell })));

    edited[0][0] = { blocks: ['after-merge'] };
    storeA.updateBlockData('T', 'content', edited);

    expect(readGrid(storeA)).toEqual(edited);
  });

  it('row identity never reaches OutputData: the grid round-trips byte-equal', () => {
    expect(readGrid(storeA)).toEqual(grid());

    const next = grid();

    next[2] = [{ blocks: ['r2c0', 'extra'] }, next[2][1]];
    storeA.updateBlockData('T', 'content', next);

    expect(readGrid(storeA)).toEqual(next);
    expect(JSON.stringify(storeA.toJSON())).not.toContain('__row');
  });

  it('a column insert plus a row insert still pairs every surviving row with its own key', () => {
    // The pairing's rank window only searches near a row's own position. A
    // write that changes EVERY row and adds one is the case that pushes ranks
    // out of alignment, so a concurrent edit is the proof it still lands.
    const onA = grid().map((row) => [{ blocks: ['new'] }, ...row]);

    onA.splice(2, 0, [{ blocks: ['x'] }, { blocks: ['y'] }, { blocks: ['z'] }]);
    storeA.updateBlockData('T', 'content', onA);

    const onB = grid();

    onB[3] = [onB[3][0], { blocks: ['r3c1-TYPED'] }];
    storeB.updateBlockData('T', 'content', onB);

    sync(storeA, storeB);

    expect(readGrid(storeA)).toEqual(readGrid(storeB));

    const rows = readGrid(storeA) as Row[];

    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual([{ blocks: ['new'] }, { blocks: ['r3c0'] }, { blocks: ['r3c1-TYPED'] }]);
  });

  it('nesting is keyed at every depth: a grid inside a grid row keeps its inner containers', () => {
    const nested = (): unknown => [
      [[{ blocks: ['a'] }], [{ blocks: ['b'] }]],
      [[{ blocks: ['c'] }], [{ blocks: ['d'] }]],
    ];

    storeA.fromJSON([{ id: 'N', type: 'table', data: { content: nested() } }]);

    const innerGrid = (outerIndex: number): Y.Map<unknown> => {
      const yblock = storeA.getBlockById('N') as Y.Map<unknown>;
      const outer = (yblock.get('data') as Y.Map<unknown>).get('content') as Y.Map<unknown>;
      const key = (outer.get('__rowKeys') as Y.Array<string>).get(outerIndex);

      return (outer.get('__rows') as Y.Map<unknown>).get(key) as Y.Map<unknown>;
    };

    const innerRow = (outerIndex: number, innerIndex: number): unknown => {
      const inner = innerGrid(outerIndex);
      const key = (inner.get('__rowKeys') as Y.Array<string>).get(innerIndex);

      return (inner.get('__rows') as Y.Map<unknown>).get(key);
    };

    const before = innerRow(1, 1);

    expect(before).toBeDefined();

    const next = nested() as { blocks: string[] }[][][];

    next[1][1] = [{ blocks: ['d', 'edited'] }];
    storeA.updateBlockData('N', 'content', next);

    expect(storeA.toJSON()[0].data.content).toEqual(next);
    expect(innerRow(1, 1)).toBe(before);
  });

  it('an array of plain objects is not a grid: database schema keeps element-wise Y.Arrays', () => {
    const schema = [
      { id: 'p-title', name: 'Name', type: 'title' },
      { id: 'p-status', name: 'Status', type: 'select' },
    ];

    storeA.fromJSON([{ id: 'DB', type: 'database', data: { schema } }]);

    const ydata = (storeA.getBlockById('DB') as Y.Map<unknown>).get('data') as Y.Map<unknown>;

    expect(ydata.get('schema') instanceof Y.Array).toBe(true);

    const next = [...schema, { id: 'p-due', name: 'Due', type: 'date' }];

    storeA.updateBlockData('DB', 'schema', next);

    expect(storeA.toJSON()[0].data.schema).toEqual(next);
  });

  it('a row reorder is a block UPDATE, never a move: the key array is not an order array', () => {
    const observer = new BlockObserver();
    const undoManager = new Y.UndoManager(storeA.undoScope, { trackedOrigins: new Set(['local']) });

    observer.observe({ blocksMap: storeA.blocksMap, rootOrder: storeA.rootOrder }, undoManager);

    const callback = vi.fn();

    observer.onBlocksChanged(callback);

    const next = grid();

    [next[1], next[2]] = [next[2], next[1]];
    storeA.updateBlockData('T', 'content', next);

    const types = callback.mock.calls.map((call) => (call[0] as BlockChangeEvent).type);

    // The row-key array holds ID-LIKE strings under a block, the exact shape
    // `isContentIdsArray` screens for. Misreading it as an order array would
    // make every table reorder look like a block move.
    expect(types).toContain('update');
    expect(types).not.toContain('move');

    observer.destroy();
    undoManager.destroy();
  });
});
