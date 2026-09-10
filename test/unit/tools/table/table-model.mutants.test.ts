import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
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

// ─── Metadata surface ───────────────────────────────────────────────

describe('TableModel metadata surface', () => {
  it('defaults every flag off and the text size to compact', () => {
    const model = new TableModel();

    expect(model.withHeadings).toBe(false);
    expect(model.withHeadingColumn).toBe(false);
    expect(model.stretched).toBe(false);
    expect(model.colWidths).toBeUndefined();
    expect(model.initialColWidth).toBeUndefined();
    expect(model.textSize).toBe('compact');
    expect(model.rows).toBe(0);
    expect(model.cols).toBe(0);
  });

  it('reports every flag it was built with', () => {
    const model = new TableModel(makeData({
      withHeadings: true,
      withHeadingColumn: true,
      stretched: true,
      textSize: 'comfortable',
      initialColWidth: 90,
      colWidths: [30, 40],
      content: [[cell('a'), cell('b')]],
    }));

    expect(model.withHeadings).toBe(true);
    expect(model.withHeadingColumn).toBe(true);
    expect(model.stretched).toBe(true);
    expect(model.textSize).toBe('comfortable');
    expect(model.initialColWidth).toBe(90);
    expect(model.colWidths).toEqual([30, 40]);
  });

  it('routes each setter to its own field', () => {
    const model = new TableModel();

    model.setWithHeadings(true);
    model.setWithHeadingColumn(true);
    model.setStretched(true);
    model.setTextSize('comfortable');
    model.setColWidths([5, 6]);
    model.setInitialColWidth(70);

    expect(model.withHeadings).toBe(true);
    expect(model.withHeadingColumn).toBe(true);
    expect(model.stretched).toBe(true);
    expect(model.textSize).toBe('comfortable');
    expect(model.colWidths).toEqual([5, 6]);
    expect(model.initialColWidth).toBe(70);
  });

  it('copies colWidths in and out so a caller cannot alias the model', () => {
    const widths = [10, 20];
    const model = new TableModel(makeData({ content: [[cell('a'), cell('b')]], colWidths: widths }));

    widths.push(30);

    const read = model.colWidths;

    read?.push(40);

    expect(model.colWidths).toEqual([10, 20]);
  });

  it('clears colWidths when undefined is passed to the setter', () => {
    const model = new TableModel(makeData({ content: [[cell('a')]], colWidths: [10] }));

    model.setColWidths(undefined);

    expect(model.colWidths).toBeUndefined();

    model.setColWidths([1]);
    model.setInitialColWidth(undefined);

    expect(model.colWidths).toEqual([1]);
    expect(model.initialColWidth).toBeUndefined();
  });

  it('counts columns from the first row and rows from the grid', () => {
    const model = makeGrid(3, 4);

    expect(model.rows).toBe(3);
    expect(model.cols).toBe(4);
  });
});

// ─── Snapshot ───────────────────────────────────────────────────────

describe('TableModel snapshot', () => {
  it('omits every optional cell key the cell does not carry', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: ['a'] }]] }));

    expect(model.snapshot()).toStrictEqual({
      withHeadings: false,
      withHeadingColumn: false,
      stretched: false,
      content: [[{ blocks: ['a'] }]],
    });
  });

  it('carries spans, merge references, styling and column metadata through', () => {
    const model = new TableModel(makeData({
      colWidths: [11, 22],
      initialColWidth: 33,
      textSize: 'comfortable',
      content: [[
        { blocks: ['a'], color: '#abc', textColor: '#123', placement: 'middle-center', colspan: 2, rowspan: 3 },
        { blocks: [], mergedInto: [0, 0] },
      ]],
    }));

    expect(model.snapshot()).toStrictEqual({
      withHeadings: false,
      withHeadingColumn: false,
      stretched: false,
      content: [[
        { blocks: ['a'], color: '#abc', textColor: '#123', placement: 'middle-center', colspan: 2, rowspan: 3 },
        { blocks: [], mergedInto: [0, 0] },
      ]],
      colWidths: [11, 22],
      initialColWidth: 33,
      textSize: 'comfortable',
    });
  });

  it('deep-copies, so editing the snapshot cannot reach the model', () => {
    const model = new TableModel(makeData({
      colWidths: [1],
      content: [[{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }]],
    }));

    const snapshot = model.snapshot();
    const origin = snapshot.content[0][0];
    const covered = snapshot.content[0][1];

    if (!isCellWithBlocks(origin) || !isCellWithBlocks(covered)) {
      throw new Error('snapshot returned a legacy cell');
    }

    origin.blocks.push('b');
    covered.mergedInto = [9, 9];
    covered.blocks.push('c');
    snapshot.colWidths?.push(99);

    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.findCellForBlock('b')).toBeNull();
    expect(model.findCellForBlock('c')).toBeNull();
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(model.colWidths).toEqual([1]);
  });

  it('round-trips through the constructor', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.setCellColor(0, 0, 'rgb(1,2,3)');

    const restored = new TableModel(model.snapshot());

    expect(restored.snapshot()).toStrictEqual(model.snapshot());
    expect(restored.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
    expect(restored.getCellColor(0, 0)).toBe('rgb(1,2,3)');
  });
});

// ─── Block placement ────────────────────────────────────────────────

describe('TableModel block placement', () => {
  it('reports the owning cell of a block and null for a stranger', () => {
    const model = makeGrid(2, 2);

    expect(model.findCellForBlock('r1c1')).toEqual({ row: 1, col: 1 });
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 0, col: 0 });
    expect(model.findCellForBlock('stranger')).toBeNull();
  });

  it('ignores an add aimed outside the grid', () => {
    const model = makeGrid(2, 2);

    model.addBlockToCell(9, 0, 'x');
    model.addBlockToCell(0, 9, 'x');
    model.addBlockToCell(-1, 0, 'x');
    model.addBlockToCell(0, -1, 'x');

    expect(model.findCellForBlock('x')).toBeNull();
  });

  it('ignores an add into a cell covered by a merge', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.addBlockToCell(1, 1, 'x');

    expect(model.findCellForBlock('x')).toBeNull();
    expect(model.getCellBlocks(1, 1)).toEqual([]);
  });

  it('moves a block out of its old cell rather than duplicating it', () => {
    const model = makeGrid(1, 2);

    model.addBlockToCell(0, 1, 'r0c0');

    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.getCellBlocks(0, 1)).toEqual(['r0c1', 'r0c0']);
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 0, col: 1 });
  });

  it('ignores a removal from an out-of-bounds cell or of a block the cell lacks', () => {
    const model = makeGrid(1, 1);

    model.removeBlockFromCell(9, 0, 'r0c0');
    model.removeBlockFromCell(0, 9, 'r0c0');
    model.removeBlockFromCell(0, 0, 'stranger');

    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 0, col: 0 });
  });

  it('drops a removed block and its reverse-lookup entry', () => {
    const model = makeGrid(1, 2);

    model.removeBlockFromCell(0, 0, 'r0c0');

    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.findCellForBlock('r0c0')).toBeNull();
    expect(model.getCellBlocks(0, 1)).toEqual(['r0c1']);
  });

  it('replaces the whole cell contents at once', () => {
    const model = makeGrid(1, 2);

    model.setCellBlocks(0, 1, ['x', 'y']);

    expect(model.getCellBlocks(0, 1)).toEqual(['x', 'y']);
    expect(model.findCellForBlock('r0c1')).toBeNull();
    expect(model.findCellForBlock('x')).toEqual({ row: 0, col: 1 });
    expect(model.findCellForBlock('y')).toEqual({ row: 0, col: 1 });
  });

  it('steals a block id from the cell that previously held it', () => {
    const model = makeGrid(2, 2);

    model.setCellBlocks(1, 0, ['r0c0']);

    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.getCellBlocks(1, 0)).toEqual(['r0c0']);
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 1, col: 0 });

    const sameCol = makeGrid(2, 1);

    sameCol.setCellBlocks(1, 0, ['r0c0']);

    expect(sameCol.getCellBlocks(0, 0)).toEqual([]);
    expect(sameCol.findCellForBlock('r0c0')).toEqual({ row: 1, col: 0 });
  });

  it('leaves a block that the target cell already holds alone', () => {
    const model = makeGrid(1, 1);

    model.setCellBlocks(0, 0, ['r0c0']);

    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 0, col: 0 });
  });

  it('ignores a set aimed outside the grid or at a covered cell', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    model.setCellBlocks(0, 1, ['x']);
    model.setCellBlocks(7, 0, ['y']);
    model.setCellBlocks(0, 7, ['y']);

    expect(model.getCellBlocks(0, 1)).toEqual([]);
    expect(model.findCellForBlock('x')).toBeNull();
    expect(model.findCellForBlock('y')).toBeNull();
  });

  it('hands out a copy of a cell so a caller cannot edit the model through it', () => {
    const model = makeGrid(1, 1);

    const blocks = model.getCellBlocks(0, 0);

    blocks.push('x');

    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    expect(model.findCellForBlock('x')).toBeNull();
    expect(model.getCellBlocks(9, 9)).toEqual([]);
    expect(model.getCellBlocks(0, 9)).toEqual([]);
  });
});

// ─── Cell styling ───────────────────────────────────────────────────

describe('TableModel cell styling guards', () => {
  it('reads no styling from a cell outside the grid', () => {
    const model = makeGrid(2, 2);

    expect(model.getCellColor(9, 0)).toBeUndefined();
    expect(model.getCellTextColor(9, 0)).toBeUndefined();
    expect(model.getCellPlacement(9, 0)).toBeUndefined();
    expect(model.getCellColor(0, 9)).toBeUndefined();
    expect(model.getCellTextColor(0, 9)).toBeUndefined();
    expect(model.getCellPlacement(0, 9)).toBeUndefined();
    expect(model.getCellColor(-1, 0)).toBeUndefined();
    expect(model.getCellTextColor(-1, 0)).toBeUndefined();
    expect(model.getCellPlacement(-1, 0)).toBeUndefined();
  });

  it('ignores a styling write aimed outside the grid', () => {
    const model = makeGrid(1, 1);

    model.setCellColor(9, 9, '#abc');
    model.setCellTextColor(-1, 0, '#abc');
    model.setCellPlacement(0, 9, 'top-left');

    expect(model.getCellColor(0, 0)).toBeUndefined();
    expect(model.getCellTextColor(0, 0)).toBeUndefined();
    expect(model.getCellPlacement(0, 0)).toBeUndefined();
  });

  it('refuses to style a cell covered by a merge', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.setCellColor(1, 1, '#abc');
    model.setCellTextColor(1, 1, '#abc');
    model.setCellPlacement(1, 1, 'middle-center');

    expect(model.getCellColor(1, 1)).toBeUndefined();
    expect(model.getCellTextColor(1, 1)).toBeUndefined();
    expect(model.getCellPlacement(1, 1)).toBeUndefined();
  });

  it('round-trips a placement and clears it when undefined is passed', () => {
    const model = makeGrid(1, 1);

    model.setCellPlacement(0, 0, 'bottom-right');

    expect(model.getCellPlacement(0, 0)).toBe('bottom-right');

    model.setCellPlacement(0, 0, undefined);

    expect(model.getCellPlacement(0, 0)).toBeUndefined();
  });

  it('keeps a set color across an unrelated write', () => {
    const model = makeGrid(1, 2);

    model.setCellColor(0, 0, '#abc');
    model.setCellTextColor(0, 1, '#123');

    expect(model.getCellColor(0, 0)).toBe('#abc');
    expect(model.getCellColor(0, 1)).toBeUndefined();
    expect(model.getCellTextColor(0, 1)).toBe('#123');
    expect(model.getCellTextColor(0, 0)).toBeUndefined();
  });
});

// ─── Row operations ─────────────────────────────────────────────────

describe('TableModel row operations', () => {
  it('appends an empty row when no index is given', () => {
    const model = makeGrid(2, 3);

    expect(model.addRow()).toEqual({ type: 'add-row', index: 2, cellsToPopulate: 3 });
    expect(model.rows).toBe(3);
    expect(model.getCellBlocks(2, 0)).toEqual([]);
    expect(model.findCellForBlock('r2c0')).toBeNull();
  });

  it('clamps the insert index into the grid', () => {
    const model = makeGrid(2, 2);

    expect(model.addRow(-5)).toEqual({ type: 'add-row', index: 0, cellsToPopulate: 2 });
    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.getCellBlocks(1, 0)).toEqual(['r0c0']);
    expect(model.addRow(99)).toEqual({ type: 'add-row', index: 3, cellsToPopulate: 2 });
  });

  it('adds a zero-column row to an empty table', () => {
    const model = new TableModel();

    expect(model.addRow()).toEqual({ type: 'add-row', index: 0, cellsToPopulate: 0 });
    expect(model.rows).toBe(1);
    expect(model.cols).toBe(0);
  });

  it('reports the blocks it removed and re-indexes the rest', () => {
    const model = makeGrid(3, 2);

    expect(model.deleteRow(1)).toEqual({
      type: 'delete-row',
      index: 1,
      blocksToDelete: ['r1c0', 'r1c1'],
    });
    expect(model.rows).toBe(2);
    expect(model.findCellForBlock('r1c0')).toBeNull();
    expect(model.findCellForBlock('r2c0')).toEqual({ row: 1, col: 0 });
  });

  it('reports an empty delete for an index outside the grid', () => {
    const model = makeGrid(2, 2);

    expect(model.deleteRow(5)).toEqual({ type: 'delete-row', index: 5, blocksToDelete: [] });
    expect(model.deleteRow(-1)).toEqual({ type: 'delete-row', index: -1, blocksToDelete: [] });
    expect(model.rows).toBe(2);
  });

  it('shifts merge references down when a row is inserted above them', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
    ] }));

    model.addRow(0);

    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(2, 0)).toEqual([1, 0]);
    expect(model.getCellBlocks(1, 0)).toEqual(['a']);
    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('hands a one-column origin down and clears its stale reference', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
    ] }));

    expect(model.deleteRow(0)).toEqual({ type: 'delete-row', index: 0, blocksToDelete: [] });
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.isSpannedCell(0, 0)).toBe(false);
    expect(model.getCellBlocks(1, 0)).toEqual(['b']);
    expect(model.findCellForBlock('a')).toEqual({ row: 0, col: 0 });
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('reorders rows and keeps the reverse lookup honest', () => {
    const model = makeGrid(3, 1);

    expect(model.moveRow(2, 0)).toEqual({ type: 'move-row', index: 2, toIndex: 0 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r2c0']);
    expect(model.getCellBlocks(1, 0)).toEqual(['r0c0']);
    expect(model.getCellBlocks(2, 0)).toEqual(['r1c0']);
    expect(model.findCellForBlock('r0c0')).toEqual({ row: 1, col: 0 });
  });

  it('leaves the grid alone for a refused move', () => {
    const model = makeGrid(3, 1);

    expect(model.moveRow(0, 0)).toEqual({ type: 'move-row', index: 0, toIndex: 0 });
    expect(model.moveRow(0, 9)).toEqual({ type: 'move-row', index: 0, toIndex: 9 });
    expect(model.moveRow(9, 0)).toEqual({ type: 'move-row', index: 9, toIndex: 0 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    expect(model.getCellBlocks(1, 0)).toEqual(['r1c0']);
  });

  it('refuses a move that would tear a rowspan', () => {
    const model = makeGrid(3, 1);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(model.moveRow(0, 2)).toEqual({ type: 'move-row', index: 0, toIndex: 2 });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('carries a merge with the row it moves', () => {
    const model = makeGrid(4, 1);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(model.moveRow(2, 0)).toEqual({ type: 'move-row', index: 2, toIndex: 0 });
    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(2, 0)).toEqual([1, 0]);
    expect(model.getCellBlocks(1, 0)).toEqual(['r0c0', 'r1c0']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('carries a merge when the row moves past it', () => {
    const model = makeGrid(4, 1);

    model.mergeCells({ minRow: 2, maxRow: 3, minCol: 0, maxCol: 0 });

    expect(model.moveRow(0, 3)).toEqual({ type: 'move-row', index: 0, toIndex: 3 });
    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(2, 0)).toEqual([1, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('extends a rowspan that crosses the inserted row', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2, colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(model.addRow(1)).toEqual({
      type: 'add-row',
      index: 1,
      cellsToPopulate: 2,
    });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 3 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getMergeOrigin(1, 1)).toEqual([0, 0]);
    expect(model.getMergeOrigin(2, 1)).toEqual([0, 0]);
    expect(model.getCellBlocks(1, 0)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('extends a rowspan that straddles the inserted row but starts above it', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }],
      [{ blocks: ['b'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [1, 0] }],
    ] }));

    model.addRow(2);

    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 3 });
    expect(model.getMergeOrigin(2, 0)).toEqual([1, 0]);
    expect(model.getCellBlocks(2, 0)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('leaves an origin that sits on the inserted row alone', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }],
      [{ blocks: ['b'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [1, 0] }],
    ] }));

    model.addRow(1);

    expect(model.getCellSpan(2, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(3, 0)).toEqual([2, 0]);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('leaves a span that does not cross the inserted row alone', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
    ] }));

    model.addRow(2);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getCellSpan(3, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.getCellBlocks(3, 0)).toEqual(['b']);
    expect(model.getCellBlocks(2, 0)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('moves an origin down a row when the row above it is deleted', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2, colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }],
    ] }));

    expect(model.deleteRow(0)).toEqual({ type: 'delete-row', index: 0, blocksToDelete: [] });
    expect(model.rows).toBe(2);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(model.findCellForBlock('b')).toEqual({ row: 1, col: 0 });
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('shrinks a rowspan when a covered row inside it is deleted', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 3 }, { blocks: ['x'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['y'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['z'] }],
    ] }));

    expect(model.deleteRow(1)).toEqual({ type: 'delete-row', index: 1, blocksToDelete: ['y'] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getCellBlocks(1, 1)).toEqual(['z']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('drops the merge entirely when the last covered row goes', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }, { blocks: ['x'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['y'] }],
      [{ blocks: ['b'] }, { blocks: ['z'] }],
    ] }));

    expect(model.deleteRow(1)).toEqual({ type: 'delete-row', index: 1, blocksToDelete: ['y'] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.isSpannedCell(1, 0)).toBe(false);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getCellBlocks(1, 0)).toEqual(['b']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('does not hand a one-row origin down to the row below', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.deleteRow(0)).toEqual({
      type: 'delete-row',
      index: 0,
      blocksToDelete: ['r0c0', 'r0c1'],
    });
    expect(model.getCellBlocks(0, 0)).toEqual(['r1c0']);
    expect(model.getCellBlocks(0, 1)).toEqual(['r1c1']);
    expect(model.hasMerges()).toBe(false);
  });

  it('does not hand a one-column origin rightwards', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(model.deleteColumn(0)).toEqual({
      type: 'delete-column',
      index: 0,
      blocksToDelete: ['r0c0', 'r1c0'],
    });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c1']);
    expect(model.getCellBlocks(1, 0)).toEqual(['r1c1']);
    expect(model.hasMerges()).toBe(false);
  });

  it('drops an origin that has no row below it without throwing', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: ['a'], rowspan: 2 }]] }));

    expect(model.deleteRow(0)).toEqual({ type: 'delete-row', index: 0, blocksToDelete: ['a'] });
    expect(model.rows).toBe(0);
    expect(model.findCellForBlock('a')).toBeNull();
  });

  it('hands a three-row origin down and keeps two rows of span', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 3 }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
    ] }));

    expect(model.deleteRow(0)).toEqual({ type: 'delete-row', index: 0, blocksToDelete: [] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getCellBlocks(2, 0)).toEqual(['b']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('ignores a merge reference pointing outside the grid when its row is deleted', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }],
      [{ blocks: ['b'], mergedInto: [5, 5] }],
    ] }));

    expect(model.deleteRow(1)).toEqual({ type: 'delete-row', index: 1, blocksToDelete: ['b'] });
    expect(model.rows).toBe(1);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
  });

  it('ignores a merge reference pointing outside the grid when its column is deleted', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'] },
      { blocks: ['b'], mergedInto: [5, 5] },
    ]] }));

    expect(model.deleteColumn(1)).toEqual({ type: 'delete-column', index: 1, blocksToDelete: ['b'] });
    expect(model.cols).toBe(1);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
  });

  it('keeps the rows below a deleted rowspan intact', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 3 }, { blocks: ['x'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['y'] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['z'] }],
      [{ blocks: ['b'] }, { blocks: ['w'] }],
    ] }));

    model.deleteRow(2);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getCellBlocks(2, 0)).toEqual(['b']);
    expect(model.findCellForBlock('z')).toBeNull();
    expect(() => model.validateInvariants()).not.toThrow();
  });
});

// ─── Column operations ──────────────────────────────────────────────

describe('TableModel column operations', () => {
  it('appends an empty column carrying the requested width', () => {
    const model = new TableModel(makeData({
      colWidths: [10, 20],
      content: [[cell('a'), cell('b')]],
    }));

    expect(model.addColumn(undefined, 14)).toEqual({
      type: 'add-column',
      index: 2,
      cellsToPopulate: [{ row: 0, col: 2 }],
    });
    expect(model.cols).toBe(3);
    expect(model.colWidths).toEqual([10, 20, 14]);
    expect(model.getCellBlocks(0, 2)).toEqual([]);
  });

  it('defaults an inserted width to zero and clamps the index', () => {
    const model = new TableModel(makeData({
      colWidths: [10, 20],
      content: [[cell('a'), cell('b')]],
    }));

    expect(model.addColumn(-4)).toEqual({
      type: 'add-column',
      index: 0,
      cellsToPopulate: [{ row: 0, col: 0 }],
    });
    expect(model.colWidths).toEqual([0, 10, 20]);
    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.getCellBlocks(0, 1)).toEqual(['a']);
  });

  it('leaves colWidths undefined when the table never had them', () => {
    const model = makeGrid(1, 1);

    model.addColumn();

    expect(model.cols).toBe(2);
    expect(model.colWidths).toBeUndefined();
  });

  it('deletes a column with its blocks and its width', () => {
    const model = new TableModel(makeData({
      colWidths: [10, 20, 30],
      content: [[cell('a'), cell('b'), cell('c')]],
    }));

    expect(model.deleteColumn(1)).toEqual({ type: 'delete-column', index: 1, blocksToDelete: ['b'] });
    expect(model.cols).toBe(2);
    expect(model.colWidths).toEqual([10, 30]);
    expect(model.findCellForBlock('b')).toBeNull();
    expect(model.findCellForBlock('c')).toEqual({ row: 0, col: 1 });
  });

  it('drops colWidths entirely once the last column is gone', () => {
    const model = new TableModel(makeData({ colWidths: [10], content: [[cell('a')]] }));

    expect(model.deleteColumn(0)).toEqual({ type: 'delete-column', index: 0, blocksToDelete: ['a'] });
    expect(model.colWidths).toBeUndefined();
    expect(model.rows).toBe(1);
    expect(model.cols).toBe(0);
  });

  it('reports an empty delete for an index outside the grid', () => {
    const model = makeGrid(2, 2);

    expect(model.deleteColumn(7)).toEqual({ type: 'delete-column', index: 7, blocksToDelete: [] });
    expect(model.deleteColumn(-1)).toEqual({ type: 'delete-column', index: -1, blocksToDelete: [] });
    expect(model.cols).toBe(2);
  });

  it('deletes a column that skips a short row without throwing', () => {
    const model = new TableModel(makeData({ content: [[cell('a')], [cell('b')]] }));

    expect(model.deleteColumn(0)).toEqual({ type: 'delete-column', index: 0, blocksToDelete: ['a', 'b'] });
    expect(model.cols).toBe(0);
  });

  it('shifts merge references right when a column is inserted before them', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    model.addColumn(0);

    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 1]);
    expect(model.getCellBlocks(0, 1)).toEqual(['a']);
    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('reorders columns and carries their widths', () => {
    const model = new TableModel(makeData({
      colWidths: [1, 2, 3],
      content: [[cell('a'), cell('b'), cell('c')]],
    }));

    expect(model.moveColumn(2, 0)).toEqual({ type: 'move-column', index: 2, toIndex: 0 });
    expect(model.getCellBlocks(0, 0)).toEqual(['c']);
    expect(model.getCellBlocks(0, 1)).toEqual(['a']);
    expect(model.getCellBlocks(0, 2)).toEqual(['b']);
    expect(model.colWidths).toEqual([3, 1, 2]);
    expect(model.findCellForBlock('a')).toEqual({ row: 0, col: 1 });
  });

  it('leaves the grid alone for a refused move', () => {
    const model = makeGrid(1, 3);

    expect(model.moveColumn(0, 0)).toEqual({ type: 'move-column', index: 0, toIndex: 0 });
    expect(model.moveColumn(0, 9)).toEqual({ type: 'move-column', index: 0, toIndex: 9 });
    expect(model.moveColumn(9, 0)).toEqual({ type: 'move-column', index: 9, toIndex: 0 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    expect(model.getCellBlocks(0, 1)).toEqual(['r0c1']);
  });

  it('refuses a move that would tear a colspan', () => {
    const model = makeGrid(1, 3);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.moveColumn(0, 2)).toEqual({ type: 'move-column', index: 0, toIndex: 2 });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('carries a merge with the column it moves', () => {
    const model = makeGrid(1, 4);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.moveColumn(2, 0)).toEqual({ type: 'move-column', index: 2, toIndex: 0 });
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 1]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('carries a merge when the column moves past it', () => {
    const model = makeGrid(1, 4);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 2, maxCol: 3 });

    expect(model.moveColumn(0, 3)).toEqual({ type: 'move-column', index: 0, toIndex: 3 });
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 1]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('extends a colspan that crosses the inserted column', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(model.addColumn(1)).toEqual({
      type: 'add-column',
      index: 1,
      cellsToPopulate: [{ row: 0, col: 1 }, { row: 1, col: 1 }],
    });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 3, rowspan: 2 });
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(model.getMergeOrigin(1, 1)).toEqual([0, 0]);
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('leaves an origin that sits on the inserted column alone', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'] },
      { blocks: ['b'], colspan: 2 },
      { blocks: [], mergedInto: [0, 1] },
    ]] }));

    model.addColumn(1);

    expect(model.getCellSpan(0, 2)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 3)).toEqual([0, 2]);
    expect(model.getCellBlocks(0, 2)).toEqual(['b']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('leaves a span that does not cross the inserted column alone', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: ['a'] }],
    ] }));

    model.addColumn(3);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getCellBlocks(0, 3)).toEqual([]);
    expect(model.getCellBlocks(0, 2)).toEqual(['a']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('moves an origin right a column when the column before it is deleted', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }],
    ] }));

    expect(model.deleteColumn(0)).toEqual({ type: 'delete-column', index: 0, blocksToDelete: ['b'] });
    expect(model.cols).toBe(1);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('shrinks a colspan when a covered column inside it is deleted', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 3 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }, { blocks: ['d'] }],
    ] }));

    expect(model.deleteColumn(1)).toEqual({ type: 'delete-column', index: 1, blocksToDelete: ['c'] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('drops the merge entirely when the last covered column goes', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }],
    ] }));

    expect(model.deleteColumn(1)).toEqual({ type: 'delete-column', index: 1, blocksToDelete: ['c'] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.isSpannedCell(0, 1)).toBe(false);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.cols).toBe(1);
    expect(() => model.validateInvariants()).not.toThrow();
  });
});

// ─── Merge queries ──────────────────────────────────────────────────

describe('TableModel merge queries', () => {
  it('reports no merge on a plain grid', () => {
    expect(makeGrid(2, 2).hasMerges()).toBe(false);
  });

  it('sees a merge through a colspan, a rowspan or a covered cell', () => {
    const colspan = new TableModel(makeData({
      content: [[{ blocks: [], colspan: 2 }, { blocks: [] }]],
    }));
    const rowspan = new TableModel(makeData({
      content: [[{ blocks: [], rowspan: 2 }], [{ blocks: [] }]],
    }));
    const covered = new TableModel(makeData({
      content: [[{ blocks: [] }, { blocks: [], mergedInto: [0, 0] }]],
    }));

    expect(colspan.hasMerges()).toBe(true);
    expect(rowspan.hasMerges()).toBe(true);
    expect(covered.hasMerges()).toBe(true);
  });

  it('reports the span of an origin and 1x1 for everything else', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.getCellSpan(1, 1)).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('locks every row and column a merge reaches into', () => {
    const rows = new TableModel(makeData({ content: [
      [{ blocks: [], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [] }],
    ] }));

    expect(rows.isRowMovable(0)).toBe(false);
    expect(rows.isRowMovable(1)).toBe(false);
    expect(rows.isRowMovable(2)).toBe(true);
    expect(rows.isRowMovable(9)).toBe(false);
    expect(rows.isRowMovable(-1)).toBe(false);

    const cols = new TableModel(makeData({ content: [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    ] }));

    expect(cols.isColumnMovable(0)).toBe(false);
    expect(cols.isColumnMovable(1)).toBe(false);
    expect(cols.isColumnMovable(2)).toBe(true);
    expect(cols.isColumnMovable(9)).toBe(false);
    expect(cols.isColumnMovable(-1)).toBe(false);
  });

  it('allows an in-place move even where the row or column is locked', () => {
    const rows = new TableModel(makeData({ content: [
      [{ blocks: [], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(rows.canMoveRow(0, 0)).toBe(true);
    expect(rows.canMoveRow(0, 1)).toBe(false);

    const cols = new TableModel(makeData({ content: [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(cols.canMoveColumn(0, 0)).toBe(true);
    expect(cols.canMoveColumn(0, 1)).toBe(false);
  });

  it('refuses to drop a row inside a rowspan footprint', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: [] }],
      [{ blocks: [], rowspan: 2 }],
      [{ blocks: [], mergedInto: [1, 0] }],
      [{ blocks: [] }],
    ] }));

    expect(model.canMoveRow(0, 1)).toBe(false);
    expect(model.canMoveRow(0, 0)).toBe(true);
    expect(model.canMoveRow(0, 2)).toBe(true);
    expect(model.canMoveRow(0, 3)).toBe(true);
    expect(model.canMoveRow(9, 1)).toBe(false);
    expect(model.canMoveRow(0, 9)).toBe(false);
  });

  it('refuses to drop a column inside a colspan footprint', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: [] }, { blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 1] }, { blocks: [] }],
    ] }));

    expect(model.canMoveColumn(0, 1)).toBe(false);
    expect(model.canMoveColumn(0, 0)).toBe(true);
    expect(model.canMoveColumn(0, 3)).toBe(true);
    expect(model.canMoveColumn(9, 1)).toBe(false);
    expect(model.canMoveColumn(0, 9)).toBe(false);
  });

  it('resolves the origin of a covered cell and of a merge origin itself', () => {
    const model = makeGrid(3, 3);

    model.mergeCells({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });

    expect(model.getMergeOrigin(1, 1)).toEqual([1, 1]);
    expect(model.getMergeOrigin(2, 2)).toEqual([1, 1]);
    expect(model.getMergeOrigin(2, 1)).toEqual([1, 1]);
    expect(model.getMergeOrigin(0, 0)).toBeNull();
    expect(model.getMergeOrigin(0, 2)).toBeNull();
  });

  it('hands back a fresh origin pair each call', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    const first = model.getMergeOrigin(1, 1);
    const second = model.getMergeOrigin(1, 1);

    expect(first).toEqual([0, 0]);
    expect(first).not.toBe(second);
  });

  it('reports merges after an insert and a delete of unrelated rows', () => {
    const model = makeGrid(3, 3);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.addRow(3);
    model.deleteRow(3);

    expect(model.hasMerges()).toBe(true);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
    expect(() => model.validateInvariants()).not.toThrow();
  });
});

// ─── Merging and splitting ──────────────────────────────────────────

describe('TableModel mergeCells', () => {
  it('makes the top-left cell the origin and empties the absorbed cells', () => {
    const model = makeGrid(2, 3);

    const result = model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    expect(result.blocksToRelocate).toEqual(['r0c1', 'r1c0', 'r1c1']);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
    expect(model.getCellBlocks(0, 1)).toEqual([]);
    expect(model.getCellBlocks(1, 1)).toEqual([]);
    expect(model.getMergeOrigin(1, 1)).toEqual([0, 0]);
    expect(model.findCellForBlock('r1c0')).toEqual({ row: 0, col: 0 });
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('refuses a rectangle it cannot merge and relocates nothing', () => {
    const model = makeGrid(2, 2);

    expect(model.mergeCells({ minRow: 0, maxRow: 5, minCol: 0, maxCol: 0 })).toEqual({ blocksToRelocate: [] });
    expect(model.hasMerges()).toBe(false);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('refuses a single-cell rectangle', () => {
    const model = makeGrid(2, 2);

    expect(model.mergeCells({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 })).toEqual({ blocksToRelocate: [] });
    expect(model.hasMerges()).toBe(false);
  });

  it('refuses a rectangle that would split an existing merge', () => {
    const model = makeGrid(3, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(model.mergeCells({ minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 })).toEqual({ blocksToRelocate: [] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
  });

  it('flattens an inner merge before re-merging a larger rectangle', () => {
    const model = makeGrid(3, 3);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    const result = model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });

    expect(result.blocksToRelocate).toEqual(['r0c1', 'r1c1', 'r2c0', 'r2c1']);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 3 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r1c0', 'r0c1', 'r1c1', 'r2c0', 'r2c1']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('flattens merges anywhere inside the rectangle, not only along its edges', () => {
    const model = makeGrid(2, 3);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 2 });
    model.mergeCells({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 1 });

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });

    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.getCellSpan(1, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 3, rowspan: 2 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('allows a selection that fully contains an existing merge', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });

    expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })).toBe(true);
  });

  it('clears the styling of the cells it absorbs', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'], placement: 'bottom-right' },
      { blocks: ['b'], color: '#abc', textColor: '#123', placement: 'middle-center' },
    ]] }));

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.getCellColor(0, 1)).toBeUndefined();
    expect(model.getCellTextColor(0, 1)).toBeUndefined();
    expect(model.getCellPlacement(0, 1)).toBeUndefined();
  });

  it('resets the origin placement to the default on merge', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'], placement: 'bottom-right' },
      { blocks: ['b'] },
    ]] }));

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.getCellPlacement(0, 0)).toBeUndefined();
    expect(model.getCellColor(0, 0)).toBeUndefined();
  });

  it('keeps the origin free of a stale merge reference', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.splitCell(0, 0);

    expect(model.getMergeOrigin(0, 0)).toBeNull();
    expect(model.isSpannedCell(0, 0)).toBe(false);
  });
});

describe('TableModel splitCell', () => {
  it('frees the covered cells and keeps the content in the origin', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    model.splitCell(0, 0);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.isSpannedCell(1, 1)).toBe(false);
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
    expect(model.getMergeOrigin(0, 0)).toBeNull();
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('does nothing for a plain cell, an out-of-bounds cell or a covered cell', () => {
    const model = makeGrid(2, 2);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    model.splitCell(1, 0);
    model.splitCell(5, 5);
    model.splitCell(0, 9);
    model.splitCell(0, 1);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r0c1']);
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
  });

  it('empties a covered cell that still holds blocks and styling', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'], colspan: 2 },
      { blocks: ['x'], mergedInto: [0, 0], color: '#abc', textColor: '#123', placement: 'middle-center' },
    ]] }));

    model.splitCell(0, 0);

    expect(model.getCellBlocks(0, 1)).toEqual([]);
    expect(model.findCellForBlock('x')).toBeNull();
    expect(model.getCellColor(0, 1)).toBeUndefined();
    expect(model.getCellTextColor(0, 1)).toBeUndefined();
    expect(model.getCellPlacement(0, 1)).toBeUndefined();
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('splits an origin that sits on the last row and column', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }, { blocks: ['b'] }],
      [{ blocks: ['c'] }, { blocks: ['d'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [1, 1] }],
      [{ blocks: ['e'] }, { blocks: [], mergedInto: [1, 1] }, { blocks: [], mergedInto: [1, 1] }],
    ] }));

    model.splitCell(1, 1);

    expect(model.getCellSpan(1, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.getCellBlocks(1, 1)).toEqual(['d']);
    expect(model.getMergeOrigin(2, 2)).toBeNull();
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('keeps a neighbouring merge intact', () => {
    const model = makeGrid(3, 3);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });
    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 2 });
    model.splitCell(0, 1);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(() => model.validateInvariants()).not.toThrow();
  });
});

// ─── replaceAll ─────────────────────────────────────────────────────

describe('TableModel replaceAll', () => {
  it('swaps every field and rebuilds the reverse lookup', () => {
    const model = makeGrid(1, 1);

    model.replaceAll({
      withHeadings: true,
      withHeadingColumn: true,
      stretched: true,
      colWidths: [7],
      initialColWidth: 8,
      textSize: 'comfortable',
      content: [[{ blocks: ['z'] }]],
    });

    expect(model.withHeadings).toBe(true);
    expect(model.withHeadingColumn).toBe(true);
    expect(model.stretched).toBe(true);
    expect(model.colWidths).toEqual([7]);
    expect(model.initialColWidth).toBe(8);
    expect(model.textSize).toBe('comfortable');
    expect(model.getCellBlocks(0, 0)).toEqual(['z']);
    expect(model.findCellForBlock('r0c0')).toBeNull();
    expect(model.findCellForBlock('z')).toEqual({ row: 0, col: 0 });
  });

  it('falls back to the defaults for the optional fields', () => {
    const model = new TableModel(makeData({
      stretched: true,
      colWidths: [1],
      initialColWidth: 2,
      textSize: 'comfortable',
      content: [[cell('a')]],
    }));

    model.replaceAll({ withHeadings: false, withHeadingColumn: false, content: [] });

    expect(model.stretched).toBe(false);
    expect(model.colWidths).toBeUndefined();
    expect(model.initialColWidth).toBeUndefined();
    expect(model.textSize).toBe('compact');
    expect(model.rows).toBe(0);
  });
});

// ─── Loading saved content ──────────────────────────────────────────

describe('TableModel loading saved content', () => {
  it('turns a legacy text cell into an empty block cell', () => {
    const model = new TableModel(makeData({ content: [['hello', { blocks: ['a'] }]] }));

    expect(model.getCellBlocks(0, 0)).toEqual([]);
    expect(model.getCellBlocks(0, 1)).toEqual(['a']);
    expect(model.findCellForBlock('a')).toEqual({ row: 0, col: 1 });
  });

  it('pads a ragged saved grid to the widest row', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }, { blocks: ['b'] }],
      [{ blocks: ['c'] }],
    ] }));

    expect(model.rows).toBe(2);
    expect(model.cols).toBe(2);
    expect(model.getCellBlocks(1, 1)).toEqual([]);
    expect(model.findCellForBlock('c')).toEqual({ row: 1, col: 0 });
  });

  it('keeps only the first occurrence of a duplicated block id', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['dup', 'keep'] }, { blocks: ['dup'] }],
      [{ blocks: ['dup'] }, { blocks: ['x'] }],
    ] }));

    expect(model.getCellBlocks(0, 0)).toEqual(['dup', 'keep']);
    expect(model.getCellBlocks(0, 1)).toEqual([]);
    expect(model.getCellBlocks(1, 0)).toEqual([]);
    expect(model.getCellBlocks(1, 1)).toEqual(['x']);
    expect(model.findCellForBlock('dup')).toEqual({ row: 0, col: 0 });
  });

  it('copies the block list of a loaded cell', () => {
    const blocks = ['a', 'b'];
    const model = new TableModel(makeData({ content: [[{ blocks }]] }));

    blocks.push('c');

    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'b']);
    expect(model.findCellForBlock('c')).toBeNull();
  });
});

// ─── validateInvariants ─────────────────────────────────────────────

describe('TableModel validateInvariants', () => {
  it('accepts a well-formed merged grid', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('accepts a plain grid', () => {
    expect(() => makeGrid(2, 2).validateInvariants()).not.toThrow();
    expect(() => new TableModel().validateInvariants()).not.toThrow();
  });

  it('accepts an empty grid that still carries column widths', () => {
    const model = new TableModel(makeData({ colWidths: [1] }));

    expect(model.rows).toBe(0);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('rejects a colWidths list that disagrees with the column count', () => {
    const model = makeGrid(1, 2);

    model.setColWidths([1, 2, 3]);

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: colWidths has 3 entries but grid has 2 columns'
    ));
  });

  it('rejects an origin whose span runs past the grid', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: ['a'], colspan: 3 }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: origin [0,0] span extends beyond grid bounds (colspan=3, rowspan=1, rows=1, cols=1)'
    ));
  });

  it('rejects a merge reference that points outside the grid', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: [], mergedInto: [5, 5] }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: mergedInto at [0,0] points to out-of-bounds [5,5]'
    ));
  });

  it('rejects a merge reference with a negative row or column', () => {
    const above = new TableModel(makeData({ content: [[{ blocks: [], mergedInto: [-1, 0] }]] }));

    expect(() => above.validateInvariants()).toThrowError(new Error(
      'Invariant violation: mergedInto at [0,0] points to out-of-bounds [-1,0]'
    ));

    const left = new TableModel(makeData({ content: [[{ blocks: [], mergedInto: [0, -1] }]] }));

    expect(() => left.validateInvariants()).toThrowError(new Error(
      'Invariant violation: mergedInto at [0,0] points to out-of-bounds [0,-1]'
    ));
  });

  it('rejects an origin whose rowspan runs past the last row', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: ['a'], rowspan: 3 }], [{ blocks: [] }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: origin [0,0] span extends beyond grid bounds (colspan=1, rowspan=3, rows=2, cols=1)'
    ));
  });

  it('rejects a merge reference that points at a cell which is not an origin', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: [] }, { blocks: [], mergedInto: [0, 0] }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: mergedInto at [0,1] points to [0,0] which is not a merge origin'
    ));
  });

  it('rejects a merge reference that sits outside the origin span', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: [], rowspan: 2 }, { blocks: [] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: mergedInto at [1,1] is outside the span of origin [0,0] (colspan=1, rowspan=2)'
    ));
  });

  it('rejects a cell inside an origin span that carries no merge reference', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: [], colspan: 2 }, { blocks: [] }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: cell [0,1] is within span of origin [0,0] but has no mergedInto'
    ));
  });

  it('rejects a row inside a rowspan that carries no merge reference', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: ['a'], rowspan: 2 }], [{ blocks: ['b'] }]] }));

    expect(() => model.validateInvariants()).toThrowError(new Error(
      'Invariant violation: cell [1,0] is within span of origin [0,0] but has no mergedInto'
    ));
  });
});

// ─── Round two: shapes the first pass could not tell apart ──────────

describe('TableModel canMergeCells boundaries', () => {
  it('refuses a single-cell selection', () => {
    const model = makeGrid(2, 2);

    expect(model.canMergeCells({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 })).toBe(false);
  });

  it('refuses a selection that ends exactly one past the last row or column', () => {
    const model = makeGrid(2, 2);

    expect(model.canMergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 })).toBe(false);
    expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 })).toBe(false);
  });

  it('refuses a selection that would cut a colspan short', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'] },
      { blocks: ['b'], colspan: 2 },
      { blocks: [], mergedInto: [0, 1] },
    ]] }));

    expect(model.canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })).toBe(false);
  });

  it('refuses a selection that would cut a rowspan short', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }],
      [{ blocks: ['b'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [1, 0] }],
    ] }));

    expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 })).toBe(false);
  });
});

describe('TableModel mergeCells flattening', () => {
  it('drops blocks sitting in a covered cell of a nested merge', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'] }, { blocks: ['n1'], colspan: 2 }, { blocks: ['ghost1'], mergedInto: [0, 1] }],
      [{ blocks: ['n2'], rowspan: 2 }, { blocks: ['x'] }, { blocks: ['y'] }],
      [{ blocks: ['ghost2'], mergedInto: [1, 0] }, { blocks: ['z'] }, { blocks: ['w'] }],
    ] }));

    model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });

    expect(model.findCellForBlock('ghost1')).toBeNull();
    expect(model.findCellForBlock('ghost2')).toBeNull();
    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'n1', 'n2', 'x', 'y', 'z', 'w']);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 3, rowspan: 3 });
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('flattens a colspan origin that is also the selection origin', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 2 }, { blocks: ['ghost'], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }],
    ] }));

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(model.findCellForBlock('ghost')).toBeNull();
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
  });

  it('flattens a rowspan origin that is also the selection origin', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }],
      [{ blocks: ['ghost'], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
    ] }));

    model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 0 });

    expect(model.findCellForBlock('ghost')).toBeNull();
    expect(model.getCellBlocks(0, 0)).toEqual(['a', 'b']);
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 3 });
  });
});

describe('TableModel splitting a one-directional merge', () => {
  it('splits a colspan-only merge', () => {
    const model = makeGrid(1, 3);

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    model.splitCell(0, 0);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.isSpannedCell(0, 1)).toBe(false);
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r0c1']);
    expect(model.getCellBlocks(0, 2)).toEqual(['r0c2']);
  });

  it('splits a rowspan-only merge', () => {
    const model = makeGrid(3, 1);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });
    model.splitCell(0, 0);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    expect(model.isSpannedCell(1, 0)).toBe(false);
    expect(model.getCellBlocks(0, 0)).toEqual(['r0c0', 'r1c0']);
    expect(model.getCellBlocks(2, 0)).toEqual(['r2c0']);
  });
});

describe('TableModel extending a one-directional merge', () => {
  it('extends a colspan-only merge that crosses the inserted column', () => {
    const model = new TableModel(makeData({ content: [[
      { blocks: ['a'], colspan: 2 },
      { blocks: [], mergedInto: [0, 0] },
      { blocks: ['b'] },
    ]] }));

    model.addColumn(1);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 3, rowspan: 1 });
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(model.getMergeOrigin(0, 2)).toEqual([0, 0]);
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getCellBlocks(0, 3)).toEqual(['b']);
    expect(() => model.validateInvariants()).not.toThrow();
  });

  it('extends a rowspan-only merge that crosses the inserted row', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], rowspan: 2 }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
    ] }));

    model.addRow(1);

    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 3 });
    expect(model.getMergeOrigin(1, 0)).toEqual([0, 0]);
    expect(model.getMergeOrigin(2, 0)).toEqual([0, 0]);
    expect(model.getCellBlocks(3, 0)).toEqual(['b']);
    expect(() => model.validateInvariants()).not.toThrow();
  });
});

describe('TableModel column bounds on an empty table', () => {
  it('reports an empty delete for a table that has no columns', () => {
    const model = new TableModel();

    expect(model.deleteColumn(0)).toEqual({ type: 'delete-column', index: 0, blocksToDelete: [] });
  });

  it('ignores a column delete one past the last column', () => {
    const model = new TableModel(makeData({
      colWidths: [1, 2],
      content: [[cell('a'), cell('b')]],
    }));

    expect(model.deleteColumn(2)).toEqual({ type: 'delete-column', index: 2, blocksToDelete: [] });
    expect(model.cols).toBe(2);
    expect(model.colWidths).toEqual([1, 2]);
  });
});

describe('TableModel merge predicates on one-directional merges', () => {
  it('calls a colspan-only or rowspan-only cell a merge', () => {
    const colspan = new TableModel(makeData({ content: [[{ blocks: [], colspan: 2 }, { blocks: [] }]] }));
    const rowspan = new TableModel(makeData({ content: [[{ blocks: [], rowspan: 2 }], [{ blocks: [] }]] }));

    expect(colspan.isMergedCell(0, 0)).toBe(true);
    expect(colspan.isMergedCell(0, 1)).toBe(false);
    expect(rowspan.isMergedCell(0, 0)).toBe(true);
    expect(rowspan.isMergedCell(1, 0)).toBe(false);
  });

  it('resolves the origin of a one-directional merge', () => {
    const colspan = new TableModel(makeData({ content: [[{ blocks: [], colspan: 2 }, { blocks: [] }]] }));
    const rowspan = new TableModel(makeData({ content: [[{ blocks: [], rowspan: 2 }], [{ blocks: [] }]] }));

    expect(colspan.getMergeOrigin(0, 0)).toEqual([0, 0]);
    expect(colspan.getMergeOrigin(0, 1)).toBeNull();
    expect(rowspan.getMergeOrigin(0, 0)).toEqual([0, 0]);
    expect(rowspan.getMergeOrigin(1, 0)).toBeNull();
  });

  it('reports a covered cell as spanned and an origin as not', () => {
    const model = new TableModel(makeData({ content: [[{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }]] }));

    expect(model.isSpannedCell(0, 0)).toBe(false);
    expect(model.isSpannedCell(0, 1)).toBe(true);
  });
});

describe('TableModel handing a three-column origin to its right', () => {
  it('hands a three-column origin right and keeps two columns of span', () => {
    const model = new TableModel(makeData({ content: [
      [{ blocks: ['a'], colspan: 3 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }, { blocks: ['c'] }, { blocks: ['d'] }],
    ] }));

    expect(model.deleteColumn(0)).toEqual({ type: 'delete-column', index: 0, blocksToDelete: ['b'] });
    expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(model.getCellBlocks(0, 0)).toEqual(['a']);
    expect(model.getCellBlocks(0, 1)).toEqual([]);
    expect(model.getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(() => model.validateInvariants()).not.toThrow();
  });
});
