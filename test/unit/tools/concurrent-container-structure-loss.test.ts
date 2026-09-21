import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { TableModel } from '../../../src/tools/table/table-model';
import type { TableData } from '../../../src/tools/table/types';

/**
 * Two people restructuring ONE container at the same time.
 *
 * Every case drives the REAL tool code — `TableModel`'s own
 * merge/delete/move operations — and writes what `Table.save()` would write
 * (`snapshot().content`) into two real Yjs peers. The assertions are about the
 * CONVERGED document: content both peers still had before the exchange, and
 * that neither of them asked to delete.
 *
 * The defect assertion is FIRST in every test. A convergence-only check passes
 * happily while both peers agree on the same corrupted grid.
 */

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

/** A grid of `rows` x `cols` cells, each holding one child block id `r<r>c<c>`. */
const grid = (rows: number, cols: number): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ blocks: [`r${r}c${c}`] }))),
});

const twoPeers = (data: TableData): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON([{ id: 'T',
    type: 'table',
    data: data }]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

/** The table block's data as a reader (and the Table tool's `setData`) sees it. */
const tableData = (store: DocumentStore): TableData =>
  (store.toJSON().find((block) => block.id === 'T')?.data ?? {}) as unknown as TableData;

/** A model built from what the store holds — what the tool does on every remote update. */
const modelOf = (store: DocumentStore): TableModel => new TableModel(tableData(store));

/** Every block id the grid still references, wherever it sits. */
const blockIds = (store: DocumentStore): string[] =>
  (tableData(store).content ?? []).flatMap((row) =>
    row.flatMap((cell) => (typeof cell === 'string' ? [] : cell.blocks ?? [])));

/**
 * Block ids parked in a cell the tool never renders: `createGridFromModel`
 * skips every `isSpannedCell` position, so a block there has no `<td>` to mount
 * into. `initializeCells` rewrites such a cell as `{ blocks: [] }` and
 * `splitCellInternal` clears it on unmerge — the id is one render away from
 * being gone for good.
 */
const idsInUnrenderedCells = (store: DocumentStore): string[] => {
  const model = modelOf(store);
  const ids: string[] = [];

  (model.snapshot().content ?? []).forEach((row, r) => {
    row.forEach((cell, c) => {
      if (typeof cell !== 'string' && model.isSpannedCell(r, c)) {
        ids.push(...(cell.blocks ?? []));
      }
    });
  });

  return ids;
};

/** Apply a tool operation to a peer's model and save it the way `Table.save()` does. */
const edit = (store: DocumentStore, operation: (model: TableModel) => void): void => {
  const model = modelOf(store);

  operation(model);
  store.updateBlockData('T', 'content', model.snapshot().content);
};

describe('a table merge concurrent with a peer filling one of the absorbed cells', () => {
  it.fails('keeps the block the peer typed into a cell the merge absorbs', () => {
    const { a, b } = twoPeers(grid(2, 2));

    // A merges the whole 2x2: every absorbed cell's blocks move into (0,0).
    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    // B, at the same instant, adds a block to the cell at (1,1).
    edit(b, (model) => model.addBlockToCell(1, 1, 'typed-by-b'));

    sync(a, b);

    // The defect: B's block stays in the covered cell the merge left behind,
    // which the tool never renders and clears on the next unmerge.
    expect(idsInUnrenderedCells(a)).not.toContain('typed-by-b');
    expect(blockIds(a)).toContain('typed-by-b');
    expect(blockIds(b)).toEqual(blockIds(a));
  });

  it.fails('keeps that block when the surviving merge is undone', () => {
    const { a, b } = twoPeers(grid(2, 2));

    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    edit(b, (model) => model.addBlockToCell(1, 1, 'typed-by-b'));

    sync(a, b);

    // Either peer unmerges later: `splitCellInternal` empties every covered cell.
    edit(a, (model) => model.splitCell(0, 0));

    expect(blockIds(a)).toContain('typed-by-b');
  });
});

describe('a table merge concurrent with the peer deleting a row or column', () => {
  it.fails('keeps the second row\'s content when the peer deletes only the FIRST row', () => {
    const { a, b } = twoPeers(grid(2, 2));

    // A merges the 2x2 block: r1c0 and r1c1 are relocated into the cell at (0,0).
    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    // B deletes row 0. In B's document that row holds r0c0 and r0c1 — nothing else.
    edit(b, (model) => model.deleteRow(0));

    sync(a, b);

    // The defect: deleting the first row destroys the SECOND row's content,
    // because the concurrent merge had moved it into the deleted row.
    expect(blockIds(a)).toEqual(expect.arrayContaining(['r1c0', 'r1c1']));
    expect(blockIds(b)).toEqual(blockIds(a));
  });

  it.fails('keeps the second column\'s content when the peer deletes only the FIRST column', () => {
    const { a, b } = twoPeers(grid(1, 2));

    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 0,
      minCol: 0,
      maxCol: 1 }));
    edit(b, (model) => model.deleteColumn(0));

    sync(a, b);

    expect(blockIds(a)).toContain('r0c1');
    expect(blockIds(b)).toEqual(blockIds(a));
  });
});

describe('a column moved while the peer deletes a different column', () => {
  it.fails('deletes the column the peer asked for, and keeps the other two', () => {
    const { a, b } = twoPeers(grid(3, 3));

    // A drags the first column to the end: [c1, c2, c0].
    edit(a, (model) => model.moveColumn(0, 2));
    // B deletes the column that is FIRST in B's document — c0.
    edit(b, (model) => model.deleteColumn(0));

    sync(a, b);

    // The defect: c1 is destroyed although no one deleted it, and c0 — the
    // column B did delete — survives. The move is a positional splice, so B's
    // index-0 delete lands on whatever A's move put there.
    expect(blockIds(a)).toEqual(expect.arrayContaining(['r0c1', 'r1c1', 'r2c1']));
    expect(blockIds(a)).not.toContain('r0c0');
    expect(blockIds(b)).toEqual(blockIds(a));
  });
});

describe('two peers merging overlapping rectangles', () => {
  it.fails('leaves no cell that is both a merge origin and covered by another merge', () => {
    const { a, b } = twoPeers(grid(3, 3));

    // The two rectangles share the cell at (1,1).
    edit(a, (model) => model.mergeCells({ minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 1 }));
    edit(b, (model) => model.mergeCells({ minRow: 1,
      maxRow: 2,
      minCol: 1,
      maxCol: 2 }));

    sync(a, b);

    const model = modelOf(a);

    // The defect: (1,1) carries colspan/rowspan AND mergedInto at once, so it
    // is a merge origin the renderer skips — with three cells' content inside.
    expect(model.isMergedCell(1, 1) && model.isSpannedCell(1, 1)).toBe(false);
    expect(idsInUnrenderedCells(a)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });
});
