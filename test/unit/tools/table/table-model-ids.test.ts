import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

const grid = (rows: number, cols: number): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => ({ blocks: [`r${r}c${c}`], id: `c${c}`, rowId: `r${r}` }))
  ),
});

const cells = (model: TableModel): CellContent[][] => model.snapshot().content as CellContent[][];
const columnIds = (model: TableModel): (string | undefined)[] => cells(model)[0].map(cell => cell.id);
const rowIds = (model: TableModel): (string | undefined)[] => cells(model).map(row => row[0].rowId);

describe('TableModel row and column ids', () => {
  it('saves the ids it was loaded with', () => {
    const model = new TableModel(grid(2, 2));

    expect(cells(model)[1][1]).toEqual({ blocks: ['r1c1'], id: 'c1', rowId: 'r1' });
  });

  it('gives a table saved without ids an id on every cell', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: ['a'] }, { blocks: ['b'] }]],
    });

    expect(cells(model)[0].every(cell => typeof cell.id === 'string' && typeof cell.rowId === 'string')).toBe(true);
  });

  it('gives an added row a new row id and the existing column ids', () => {
    const model = new TableModel(grid(1, 2));

    model.addRow(0);

    const added = cells(model)[0];

    expect(added.map(cell => cell.id)).toEqual(['c0', 'c1']);
    expect(added[0].rowId).not.toBe('r0');
    expect(added[1].rowId).toBe(added[0].rowId);
  });

  it('gives an added column one new column id in every row', () => {
    const model = new TableModel(grid(2, 1));

    model.addColumn(1);

    const [first, second] = cells(model).map(row => row[1]);

    expect(first.id).not.toBe('c0');
    expect(second.id).toBe(first.id);
    expect([first.rowId, second.rowId]).toEqual(['r0', 'r1']);
  });

  it('carries ids with the cells when a column or row moves', () => {
    const model = new TableModel(grid(2, 3));

    model.moveColumn(0, 2);
    model.moveRow(0, 1);

    expect(columnIds(model)).toEqual(['c1', 'c2', 'c0']);
    expect(rowIds(model)).toEqual(['r1', 'r0']);
  });

  it('drops the ids of a deleted column or row', () => {
    const model = new TableModel(grid(2, 3));

    model.deleteColumn(0);
    model.deleteRow(0);

    expect(columnIds(model)).toEqual(['c1', 'c2']);
    expect(rowIds(model)).toEqual(['r1']);
  });

  it('keeps ids across replaceAll', () => {
    const model = new TableModel(grid(1, 1));

    model.replaceAll(grid(2, 2));

    expect(columnIds(model)).toEqual(['c0', 'c1']);
    expect(rowIds(model)).toEqual(['r0', 'r1']);
  });
});
