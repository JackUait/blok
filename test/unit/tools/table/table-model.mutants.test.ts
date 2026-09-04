import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

// ─── Helpers ───────────────────────────────────────────────────────

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

const makeGrid = (rows: number, cols: number): TableModel => {
  const content: CellContent[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: CellContent[] = [];

    for (let c = 0; c < cols; c++) {
      row.push(cell(`r${r}c${c}`));
    }
    content.push(row);
  }

  return new TableModel(makeData({ content }));
};

describe('TableModel colors', () => {
  const valid = [
    '#abc',
    '#abcd',
    '#aabbcc',
    '#aabbccdd',
    '#AABBCC',
    'rgb(11,22,33)',
    'rgba(11,22,33,0.5)',
    'rgb( 11 , 22 , 33 )',
    'rgba( 11 , 22 , 33 , 0.5 )',
    'hsl(11,22%,33%)',
    'hsla(11,22%,33%,0.5)',
    'hsl( 11 , 22% , 33% )',
    'hsla( 11 , 22% , 33% , 0.5 )',
    'transparent',
  ];

  it.each(valid)('keeps the valid color %s', color => {
    const model = makeGrid(1, 1);

    model.setCellColor(0, 0, color);
    model.setCellTextColor(0, 0, color);

    expect(model.getCellColor(0, 0)).toBe(color);
    expect(model.getCellTextColor(0, 0)).toBe(color);
  });

  // Each entry would let arbitrary CSS through if the anchors or the
  // character classes of the validator regexes were loosened.
  const invalid = [
    'red',
    'expression(1)',
    'evil#abc',
    'evil#aabbcc',
    '#abc;background:url(x)',
    '#aabbcc;background:url(x)',
    '#abcde',
    'evil rgb(11,22,33)',
    'rgb(11,22,33);background:url(x)',
    'rgb(11,22)',
    'evil hsl(11,22%,33%)',
    'hsl(11,22%,33%);background:url(x)',
    'hsl(11,22,33)',
    'transparently',
  ];

  it.each(invalid)('ignores the unsafe color %s', color => {
    const model = makeGrid(1, 1);

    model.setCellColor(0, 0, color);
    model.setCellTextColor(0, 0, color);

    expect(model.getCellColor(0, 0)).toBeUndefined();
    expect(model.getCellTextColor(0, 0)).toBeUndefined();
  });

  it('drops unsafe colors coming from stored data', () => {
    const model = new TableModel(makeData({
      content: [[{ blocks: [], color: '#abc;background:url(x)', textColor: 'evil#abc' }]],
    }));

    expect(model.getCellColor(0, 0)).toBeUndefined();
    expect(model.getCellTextColor(0, 0)).toBeUndefined();
  });

  it('keeps safe colors coming from stored data', () => {
    const model = new TableModel(makeData({
      content: [[{ blocks: [], color: 'rgba( 11 , 22 , 33 , 0.5 )', textColor: '#abcd' }]],
    }));

    expect(model.getCellColor(0, 0)).toBe('rgba( 11 , 22 , 33 , 0.5 )');
    expect(model.getCellTextColor(0, 0)).toBe('#abcd');
  });

  it('removes a color when undefined is passed', () => {
    const model = makeGrid(1, 1);

    model.setCellColor(0, 0, '#abc');
    model.setCellTextColor(0, 0, '#abc');
    model.setCellColor(0, 0, undefined);
    model.setCellTextColor(0, 0, undefined);

    expect(model.getCellColor(0, 0)).toBeUndefined();
    expect(model.getCellTextColor(0, 0)).toBeUndefined();
  });
});

describe('TableModel block placement inside a cell', () => {
  it('inserts at the requested index instead of appending', () => {
    const model = makeGrid(1, 1);

    model.setCellBlocks(0, 0, ['a', 'b', 'c']);
    model.addBlockToCell(0, 0, 'x', 1);

    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('clamps an index past the end to the end, not to the front', () => {
    const model = makeGrid(1, 1);

    model.setCellBlocks(0, 0, ['a', 'b']);
    model.addBlockToCell(0, 0, 'x', 5);

    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'b', 'x']);
  });

  it('clamps a negative index to the front', () => {
    const model = makeGrid(1, 1);

    model.setCellBlocks(0, 0, ['a', 'b']);
    model.addBlockToCell(0, 0, 'x', -3);

    expect(model.getCellBlocks(0, 0)).toEqual(['x', 'a', 'b']);
  });
});

describe('TableModel merge queries out of bounds', () => {
  it('reports no merge for coordinates outside the grid', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    expect(model.isMergedCell(5, 5)).toBe(false);
    expect(model.isSpannedCell(5, 5)).toBe(false);
    expect(model.getMergeOrigin(5, 5)).toBeNull();
    expect(model.getCellSpan(5, 5)).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('refuses a row or column move that starts or lands outside the grid', () => {
    const model = makeGrid(3, 3);

    expect(model.canMoveRow(0, 9)).toBe(false);
    expect(model.canMoveRow(9, 0)).toBe(false);
    expect(model.canMoveColumn(0, 9)).toBe(false);
    expect(model.canMoveColumn(9, 0)).toBe(false);
  });

  it('allows a move onto the index the row or column already occupies', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    // The row is locked by the merge, yet moving it nowhere must stay legal.
    expect(model.isRowMovable(0)).toBe(false);
    expect(model.canMoveRow(0, 0)).toBe(true);
    expect(model.isColumnMovable(0)).toBe(false);
    expect(model.canMoveColumn(0, 0)).toBe(true);
  });
});

describe('TableModel merge origin resolution', () => {
  it('points a covered cell at its origin and an origin at itself', () => {
    const model = makeGrid(3, 3);

    model.mergeCells({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });

    expect(model.getMergeOrigin(1, 1)).toEqual([1, 1]);
    expect(model.getMergeOrigin(2, 2)).toEqual([1, 1]);
    expect(model.getMergeOrigin(0, 0)).toBeNull();
  });
});

describe('TableModel canMergeCells', () => {
  it('refuses a rectangle a merge crosses from above or from the left', () => {
    const rowMerged = makeGrid(3, 2);

    rowMerged.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(rowMerged.canMergeCells({ minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 })).toBe(false);

    const colMerged = makeGrid(2, 3);

    colMerged.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(colMerged.canMergeCells({ minRow: 0, maxRow: 1, minCol: 1, maxCol: 2 })).toBe(false);
  });
});

describe('TableModel deleting a row that dissolves a merge', () => {
  it('keeps every other merge intact', () => {
    const model = makeGrid(4, 2);

    // Two independent vertical merges, one above the other, in column 0.
    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });
    model.mergeCells({ minRow: 2, maxRow: 3, minCol: 0, maxCol: 0 });

    model.deleteRow(1);

    expect(() => model.validateInvariants()).not.toThrow();
    expect(model.isMergedCell(0, 0)).toBe(false);
    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(2, 0)).toEqual([1, 0]);
  });

  it('keeps a merge in a neighbouring column intact', () => {
    const model = makeGrid(4, 2);

    model.mergeCells({ minRow: 1, maxRow: 2, minCol: 0, maxCol: 0 });
    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 1, maxCol: 1 });

    model.deleteRow(2);

    expect(() => model.validateInvariants()).not.toThrow();
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(1, 1)).toEqual([0, 1]);
  });
});

describe('TableModel deleting a column that dissolves a merge', () => {
  it('keeps every other merge intact', () => {
    const model = makeGrid(2, 4);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 2, maxCol: 3 });

    model.deleteColumn(1);

    expect(() => model.validateInvariants()).not.toThrow();
    expect(model.isMergedCell(0, 0)).toBe(false);
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 1]);
  });

  it('keeps a merge in a neighbouring row intact', () => {
    const model = makeGrid(2, 4);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 2 });
    model.mergeCells({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 1 });

    model.deleteColumn(2);

    expect(() => model.validateInvariants()).not.toThrow();
    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(1, 1)).toEqual([1, 0]);
  });
});
