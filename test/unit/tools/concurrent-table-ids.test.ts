import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { TableModel } from '../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../src/tools/table/types';

/**
 * Two people restructuring a table that carries row and column ids from birth
 * (every table a current editor creates). Same harness as
 * concurrent-container-structure-loss.test.ts: the real TableModel, what
 * Table.save() writes, two real Yjs peers. The defect assertion goes first.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

/** Cell (r, c) holds block `r<r>c<c>` and carries column id `c<c>`, row id `r<r>`. */
const grid = (rows: number, cols: number): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ blocks: [`r${r}c${c}`], id: `c${c}`, rowId: `r${r}` }))),
});

const twoPeers = (data: TableData): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON([{ id: 'T', type: 'table', data }]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const content = (store: DocumentStore): CellContent[][] =>
  new TableModel(store.toJSON().find((block) => block.id === 'T')?.data ?? {})
    .snapshot().content as CellContent[][];

const edit = (store: DocumentStore, operation: (model: TableModel) => void): void => {
  const model = new TableModel(store.toJSON().find((block) => block.id === 'T')?.data ?? {});

  operation(model);
  store.updateBlockData('T', 'content', model.snapshot().content);
};

const blocksGrid = (store: DocumentStore): string[][] =>
  content(store).map(row => row.map(cell => cell.blocks.join('+')));

describe('a table with row and column ids under concurrent structure edits', () => {
  it('deletes the column the peer asked for when the other peer moved it', () => {
    const { a, b } = twoPeers(grid(2, 3));

    edit(a, (model) => model.moveColumn(0, 2));
    edit(b, (model) => model.deleteColumn(0));
    sync(a, b);

    expect(blocksGrid(a)).toEqual([['r0c1', 'r0c2'], ['r1c1', 'r1c2']]);
    expect(blocksGrid(b)).toEqual(blocksGrid(a));
  });

  it('deletes the row the peer asked for when the other peer moved it', () => {
    const { a, b } = twoPeers(grid(3, 1));

    edit(a, (model) => model.moveRow(0, 2));
    edit(b, (model) => model.deleteRow(0));
    sync(a, b);

    expect(blocksGrid(a)).toEqual([['r1c0'], ['r2c0']]);
    expect(blocksGrid(b)).toEqual(blocksGrid(a));
  });

  it('keeps a block the peer added to a row the other peer moved', () => {
    const { a, b } = twoPeers(grid(3, 1));

    edit(a, (model) => model.moveRow(0, 2));
    edit(b, (model) => model.addBlockToCell(0, 0, 'typed-by-b'));
    sync(a, b);

    expect(blocksGrid(a)).toEqual([['r1c0'], ['r2c0'], ['r0c0+typed-by-b']]);
    expect(blocksGrid(b)).toEqual(blocksGrid(a));
  });

  it('keeps a peer\'s block in its row when the other peer edits that row and inserts a row above it in one save', () => {
    const { a, b } = twoPeers(grid(3, 1));

    // One save both changes row 0 and adds a row above it. Matched by content
    // alone, the edited row looks like neither its old self nor anything else,
    // so the new row would take over row 0's place in the shared document.
    edit(a, (model) => {
      model.addBlockToCell(0, 0, 'typed-by-a');
      model.addRow(0);
    });
    edit(b, (model) => model.addBlockToCell(0, 0, 'typed-by-b'));
    sync(a, b);

    expect(blocksGrid(a)).toEqual([[''], ['r0c0+typed-by-a+typed-by-b'], ['r1c0'], ['r2c0']]);
    expect(blocksGrid(b)).toEqual(blocksGrid(a));
  });

  it('keeps both columns when two peers each add one', () => {
    const { a, b } = twoPeers(grid(1, 1));

    edit(a, (model) => model.addColumn(1));
    edit(b, (model) => model.addColumn(1));
    sync(a, b);

    expect(content(a)[0]).toHaveLength(3);
    expect(new Set(content(a)[0].map(cell => cell.id)).size).toBe(3);
    expect(content(b)).toEqual(content(a));
  });

  it('keeps both rows when two peers each add one', () => {
    const { a, b } = twoPeers(grid(1, 1));

    edit(a, (model) => model.addRow(1));
    edit(b, (model) => model.addRow(1));
    sync(a, b);

    expect(content(a)).toHaveLength(3);
    expect(new Set(content(a).map(row => row[0].rowId)).size).toBe(3);
    expect(content(b)).toEqual(content(a));
  });
});
