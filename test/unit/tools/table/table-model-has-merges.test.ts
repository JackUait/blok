import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

const isCellGrid = (value: unknown): value is CellContent[][] =>
  Array.isArray(value) && value.every((row: unknown) =>
    Array.isArray(row) && row.every((c: unknown) => typeof c === 'object' && c !== null && 'blocks' in c));

/**
 * A model whose grid holds `content` with its merge fields as given. The
 * constructor repairs a torn merge, so this is the only way to reach the grid
 * an editing bug could leave mid-operation.
 */
const withRawMerges = (content: CellContent[][]): TableModel => {
  const model = new TableModel({
    withHeadings: false,
    withHeadingColumn: false,
    content: content.map(row => row.map(c => ({ blocks: [...c.blocks] }))),
  });
  const grid: unknown = Reflect.get(model, 'contentGrid');

  if (!isCellGrid(grid)) {
    throw new Error('TableModel no longer keeps its grid in contentGrid');
  }

  content.forEach((row, r) => row.forEach((raw, c) => {
    grid[r][c] = { ...grid[r][c], ...raw, blocks: [...raw.blocks] };
  }));

  return model;
};

/**
 * hasMerges() is the table-wide guard used to disable physical-index row/col
 * reordering (H5/H6/H7) whenever any merge is present — a physical NodeList
 * move desyncs the DOM from the logical model on merged grids.
 */
describe('TableModel.hasMerges', () => {
  const make = (content: TableData['content']): TableModel =>
    new TableModel({ withHeadings: false, withHeadingColumn: false, content });

  it('returns false for a plain grid', () => {
    expect(make([[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]]).hasMerges()).toBe(false);
  });

  it('returns true when a cell has colspan', () => {
    expect(
      make([
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [] }, { blocks: [] }],
      ]).hasMerges()
    ).toBe(true);
  });

  it('returns true when a cell has rowspan', () => {
    expect(
      make([
        [{ blocks: [], rowspan: 2 }, { blocks: [] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ]).hasMerges()
    ).toBe(true);
  });

  it('returns true for a half-torn merge: mergedInto set but origin span already cleared', () => {
    // Guards the third OR-clause (cell.mergedInto !== undefined) in isolation —
    // the origin carries NO colspan/rowspan here, so the colspan/rowspan clauses
    // cannot catch this. A merge whose origin span was wrongly cleared must still
    // block reordering, otherwise a physical-index move corrupts the torn grid.
    // Loading repairs this shape, so it is set on the live grid.
    expect(
      withRawMerges([
        [{ blocks: [] }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [] }, { blocks: [] }],
      ]).hasMerges()
    ).toBe(true);
  });
});
