// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { insertedColumnWidth } from '../../../../src/shared/table/column-widths';
import { TableModel } from '../../../../src/shared/table/table-model';
import type { CellContent } from '../../../../src/shared/table/types';
import { isCellWithBlocks } from '../../../../src/shared/table/types';
import { TableModel as OldPathModel } from '../../../../src/tools/table/table-model';

const snapshotCells = (model: TableModel): CellContent[][] => model.snapshot().content.map(row => row.map(cell => {
  if (!isCellWithBlocks(cell)) {
    throw new Error('Expected normalized cell content');
  }

  return cell;
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared TableModel', () => {
  it('uses injected IDs when normalizing legacy and ragged cells without replacing saved IDs', () => {
    let next = 0;
    const model = new TableModel({
      content: [
        [{ blocks: ['a'], id: 'saved-col', rowId: 'saved-row' }, { blocks: ['b'] }],
        ['legacy'],
      ],
    }, { mintId: () => `mint-${++next}` });

    expect(snapshotCells(model)).toEqual([
      [{ blocks: ['a'], id: 'saved-col', rowId: 'saved-row' }, { blocks: ['b'], id: 'mint-1', rowId: 'saved-row' }],
      [{ blocks: [], id: 'saved-col', rowId: 'mint-2' }, { blocks: [], id: 'mint-1', rowId: 'mint-2' }],
    ]);
  });

  it('gives each inserted row one injected ID while preserving saved rows and columns', () => {
    let next = 0;
    const model = new TableModel({
      content: [[
        { blocks: ['a'], id: 'left', rowId: 'saved-row' },
        { blocks: ['b'], id: 'right', rowId: 'saved-row' },
      ]],
    }, { mintId: () => `row-${++next}` });

    model.addRow(0);
    model.addRow();

    expect(snapshotCells(model)).toEqual([
      [{ blocks: [], id: 'left', rowId: 'row-1' }, { blocks: [], id: 'right', rowId: 'row-1' }],
      [{ blocks: ['a'], id: 'left', rowId: 'saved-row' }, { blocks: ['b'], id: 'right', rowId: 'saved-row' }],
      [{ blocks: [], id: 'left', rowId: 'row-2' }, { blocks: [], id: 'right', rowId: 'row-2' }],
    ]);
  });

  it('gives each inserted column one injected ID while preserving saved columns and rows', () => {
    let next = 0;
    const model = new TableModel({
      content: [
        [{ blocks: ['a'], id: 'saved-col', rowId: 'top' }],
        [{ blocks: ['b'], id: 'saved-col', rowId: 'bottom' }],
      ],
    }, { mintId: () => `col-${++next}` });

    model.addColumn(0);
    model.addColumn();

    expect(snapshotCells(model)).toEqual([
      [
        { blocks: [], id: 'col-1', rowId: 'top' },
        { blocks: ['a'], id: 'saved-col', rowId: 'top' },
        { blocks: [], id: 'col-2', rowId: 'top' },
      ],
      [
        { blocks: [], id: 'col-1', rowId: 'bottom' },
        { blocks: ['b'], id: 'saved-col', rowId: 'bottom' },
        { blocks: [], id: 'col-2', rowId: 'bottom' },
      ],
    ]);
  });

  it('is the class exported by the old path', () => {
    expect(OldPathModel).toBe(TableModel);
  });
});

describe('insertedColumnWidth', () => {
  it.each([
    { name: 'halves the current average', existing: [100, 200], initial: undefined, expected: 75 },
    { name: 'uses every current column', existing: [200, 300, 100], initial: undefined, expected: 100 },
    { name: 'prefers the initial width to the current average', existing: [200, 300, 100], initial: 250, expected: 125 },
    { name: 'rounds the half-average up to two decimals', existing: [100, 100, 101], initial: undefined, expected: 50.17 },
    { name: 'rounds the half-average down to two decimals', existing: [100, 101, 101], initial: undefined, expected: 50.33 },
    { name: 'rounds half the initial width up to two decimals', existing: [100, 200], initial: 80.011, expected: 40.01 },
    { name: 'rounds half the initial width down to two decimals', existing: [100, 200], initial: 80.008, expected: 40 },
    { name: 'treats zero as a defined initial width', existing: [100, 200], initial: 0, expected: 0 },
  ])('$name', ({ existing, initial, expected }) => {
    expect(insertedColumnWidth(existing, initial)).toBe(expected);
  });
});
