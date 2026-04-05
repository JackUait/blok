import { describe, it, expect, beforeEach } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

// ─── Helpers ───────────────────────────────────────────────────────

const cell = (...blocks: string[]): CellContent => ({ blocks });

const colorCell = (color: string, ...blocks: string[]): CellContent => ({ blocks, color });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

/**
 * Create a 3x3 table with blocks named by position (e.g. "r0c0", "r1c2").
 */
const make3x3 = (): TableModel => {
  return new TableModel(makeData({
    content: [
      [cell('r0c0'), cell('r0c1'), cell('r0c2')],
      [cell('r1c0'), cell('r1c1'), cell('r1c2')],
      [cell('r2c0'), cell('r2c1'), cell('r2c2')],
    ],
  }));
};

/**
 * Create a 4x4 table for more complex merge scenarios.
 */
const make4x4 = (): TableModel => {
  return new TableModel(makeData({
    content: [
      [cell('r0c0'), cell('r0c1'), cell('r0c2'), cell('r0c3')],
      [cell('r1c0'), cell('r1c1'), cell('r1c2'), cell('r1c3')],
      [cell('r2c0'), cell('r2c1'), cell('r2c2'), cell('r2c3')],
      [cell('r3c0'), cell('r3c1'), cell('r3c2'), cell('r3c3')],
    ],
  }));
};

// ─── canMergeCells ────────────────────────────────────────────────

describe('TableModel merge/split', () => {
  describe('canMergeCells', () => {
    it('returns true for a valid 2x2 rectangle', () => {
      const model = make3x3();

      expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })).toBe(true);
    });

    it('returns true for a full row selection', () => {
      const model = make3x3();

      expect(model.canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })).toBe(true);
    });

    it('returns true for a full column selection', () => {
      const model = make3x3();

      expect(model.canMergeCells({ minRow: 0, maxRow: 2, minCol: 1, maxCol: 1 })).toBe(true);
    });

    it('returns false for a single cell', () => {
      const model = make3x3();

      expect(model.canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })).toBe(false);
    });

    it('returns false for out-of-bounds range', () => {
      const model = make3x3();

      expect(model.canMergeCells({ minRow: 0, maxRow: 5, minCol: 0, maxCol: 1 })).toBe(false);
    });

    it('returns false when range overlaps a merged cell that extends beyond selection', () => {
      const model = make4x4();

      // First merge [0,0]-[1,1]
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      // Try to merge [0,0]-[0,2] — the merged cell at [0,0] extends to row 1, which is outside the selection
      expect(model.canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })).toBe(false);
    });

    it('returns true when selection fully contains an existing merged cell', () => {
      const model = make4x4();

      // Merge [1,1]-[1,2]
      model.mergeCells({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 });

      // Now merge [0,0]-[2,3] — fully contains the existing merge
      expect(model.canMergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 3 })).toBe(true);
    });
  });

  // ─── mergeCells ─────────────────────────────────────────────────

  describe('mergeCells', () => {
    let model: TableModel;

    beforeEach(() => {
      model = make3x3();
    });

    it('merges a 2x2 rectangle: origin cell gets colspan/rowspan, others get mergedInto', () => {
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const snap = model.snapshot();
      const origin = snap.content[0][0] as CellContent;

      expect(origin.colspan).toBe(2);
      expect(origin.rowspan).toBe(2);

      // Blocks from all 4 cells are concatenated into origin
      expect(origin.blocks).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);

      // The other 3 cells are spanned
      const spanned01 = snap.content[0][1] as CellContent;
      const spanned10 = snap.content[1][0] as CellContent;
      const spanned11 = snap.content[1][1] as CellContent;

      expect(spanned01.mergedInto).toEqual([0, 0]);
      expect(spanned01.blocks).toEqual([]);
      expect(spanned10.mergedInto).toEqual([0, 0]);
      expect(spanned11.mergedInto).toEqual([0, 0]);
    });

    it('merges a horizontal span (1x3)', () => {
      model.mergeCells({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 2 });

      const snap = model.snapshot();
      const origin = snap.content[1][0] as CellContent;

      expect(origin.colspan).toBe(3);
      expect(origin.rowspan).toBeUndefined(); // rowspan 1 is omitted
      expect(origin.blocks).toEqual(['r1c0', 'r1c1', 'r1c2']);

      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([1, 0]);
      expect((snap.content[1][2] as CellContent).mergedInto).toEqual([1, 0]);
    });

    it('merges a vertical span (3x1)', () => {
      model.mergeCells({ minRow: 0, maxRow: 2, minCol: 2, maxCol: 2 });

      const snap = model.snapshot();
      const origin = snap.content[0][2] as CellContent;

      expect(origin.colspan).toBeUndefined(); // colspan 1 is omitted
      expect(origin.rowspan).toBe(3);
      expect(origin.blocks).toEqual(['r0c2', 'r1c2', 'r2c2']);

      expect((snap.content[1][2] as CellContent).mergedInto).toEqual([0, 2]);
      expect((snap.content[2][2] as CellContent).mergedInto).toEqual([0, 2]);
    });

    it('preserves colors on the origin cell from the top-left cell', () => {
      const model2 = new TableModel(makeData({
        content: [
          [colorCell('#ff0000', 'a'), cell('b')],
          [cell('c'), cell('d')],
        ],
      }));

      model2.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const snap = model2.snapshot();

      expect((snap.content[0][0] as CellContent).color).toBe('#ff0000');
    });

    it('preserves the rectangular grid invariant (all rows same length)', () => {
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const snap = model.snapshot();
      const rowLengths = snap.content.map(row => row.length);

      expect(new Set(rowLengths).size).toBe(1); // All rows same length
      expect(rowLengths[0]).toBe(3); // Still 3 columns
    });

    it('updates blockCellMap: merged blocks point to origin cell', () => {
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      // All 4 blocks should now be in the origin cell [0,0]
      expect(model.findCellForBlock('r0c0')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('r0c1')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('r1c0')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('r1c1')).toEqual({ row: 0, col: 0 });
    });

    it('passes invariant validation after merge', () => {
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('does nothing for a single-cell range', () => {
      const before = model.snapshot();

      model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const after = model.snapshot();

      expect(after).toEqual(before);
    });

    it('returns blocksToRelocate listing blocks moved to origin', () => {
      const result = model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      // Blocks from non-origin cells that were moved
      expect(result.blocksToRelocate).toEqual(
        expect.arrayContaining(['r0c1', 'r1c0', 'r1c1'])
      );
      // Origin block was not relocated
      expect(result.blocksToRelocate).not.toContain('r0c0');
    });
  });

  // ─── splitCell ──────────────────────────────────────────────────

  describe('splitCell', () => {
    it('splits a 2x2 merged cell back into individual cells', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      model.splitCell(0, 0);

      const snap = model.snapshot();
      const origin = snap.content[0][0] as CellContent;

      // Origin keeps all blocks, no more merge metadata
      expect(origin.colspan).toBeUndefined();
      expect(origin.rowspan).toBeUndefined();
      expect(origin.blocks).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);

      // Spanned cells are cleared
      expect((snap.content[0][1] as CellContent).mergedInto).toBeUndefined();
      expect((snap.content[0][1] as CellContent).blocks).toEqual([]);
      expect((snap.content[1][0] as CellContent).mergedInto).toBeUndefined();
      expect((snap.content[1][1] as CellContent).mergedInto).toBeUndefined();
    });

    it('does nothing when called on a non-merged cell', () => {
      const model = make3x3();
      const before = model.snapshot();

      model.splitCell(0, 0);

      expect(model.snapshot()).toEqual(before);
    });

    it('does nothing when called on a spanned (non-origin) cell', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      const afterMerge = model.snapshot();

      // Calling split on a spanned cell should be a no-op
      model.splitCell(0, 1);

      expect(model.snapshot()).toEqual(afterMerge);
    });

    it('preserves grid rectangular invariant after split', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
      model.splitCell(0, 0);

      const snap = model.snapshot();
      const rowLengths = snap.content.map(row => row.length);

      expect(new Set(rowLengths).size).toBe(1);
    });

    it('passes invariant validation after split', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      model.splitCell(0, 0);

      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── isMergedCell / getCellSpan ─────────────────────────────────

  describe('isMergedCell', () => {
    it('returns false for a regular cell', () => {
      const model = make3x3();

      expect(model.isMergedCell(0, 0)).toBe(false);
    });

    it('returns true for a cell with colspan > 1', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      expect(model.isMergedCell(0, 0)).toBe(true);
    });

    it('returns false for a spanned cell (it is not the origin)', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(model.isMergedCell(0, 1)).toBe(false);
    });
  });

  describe('isSpannedCell', () => {
    it('returns false for a regular cell', () => {
      const model = make3x3();

      expect(model.isSpannedCell(0, 0)).toBe(false);
    });

    it('returns true for a cell with mergedInto set', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(model.isSpannedCell(0, 1)).toBe(true);
      expect(model.isSpannedCell(1, 0)).toBe(true);
      expect(model.isSpannedCell(1, 1)).toBe(true);
    });

    it('returns false for the origin cell of a merge', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(model.isSpannedCell(0, 0)).toBe(false);
    });
  });

  describe('getCellSpan', () => {
    it('returns {colspan: 1, rowspan: 1} for a regular cell', () => {
      const model = make3x3();

      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
    });

    it('returns the correct span for a merged cell', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });

      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 3, rowspan: 2 });
    });
  });

  // ─── Snapshot serialization ─────────────────────────────────────

  describe('snapshot with merged cells', () => {
    it('includes colspan/rowspan/mergedInto in snapshot', () => {
      const model = make3x3();

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const snap = model.snapshot();
      const origin = snap.content[0][0] as CellContent;
      const spanned = snap.content[0][1] as CellContent;

      expect(origin.colspan).toBe(2);
      expect(origin.rowspan).toBe(2);
      expect(spanned.mergedInto).toEqual([0, 0]);
    });

    it('restores merge state from data with colspan/rowspan/mergedInto', () => {
      const data = makeData({
        content: [
          [
            { blocks: ['a', 'b'], colspan: 2, rowspan: 2 },
            { blocks: [], mergedInto: [0, 0] as [number, number] },
          ],
          [
            { blocks: [], mergedInto: [0, 0] as [number, number] },
            { blocks: [], mergedInto: [0, 0] as [number, number] },
          ],
        ] as CellContent[][],
      });

      const model = new TableModel(data);

      expect(model.isMergedCell(0, 0)).toBe(true);
      expect(model.isSpannedCell(0, 1)).toBe(true);
      expect(model.isSpannedCell(1, 0)).toBe(true);
      expect(model.isSpannedCell(1, 1)).toBe(true);
      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
    });
  });

  // ─── addRow with merges ──────────────────────────────────────────

  describe('addRow with merges', () => {
    /** Create a cell that is a merge origin */
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    /** Create a covered cell pointing to an origin */
    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    /** 4x4 with a 2x2 merge at [0,0] */
    const make4x4WithMerge2x2 = (): TableModel => {
      return new TableModel(makeData({
        content: [
          [originCell(['r0c0', 'r0c1', 'r1c0', 'r1c1'], 2, 2), coveredCell(0, 0), cell('r0c2'), cell('r0c3')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('r1c2'), cell('r1c3')],
          [cell('r2c0'), cell('r2c1'), cell('r2c2'), cell('r2c3')],
          [cell('r3c0'), cell('r3c1'), cell('r3c2'), cell('r3c3')],
        ],
      }));
    };

    it('addRow below a merge does not alter merge metadata', () => {
      const model = make4x4WithMerge2x2();

      model.addRow(3);

      const snap = model.snapshot();

      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      expect(model.rows).toBe(5);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addRow above a merge shifts mergedInto row coordinates down by 1', () => {
      const model = make4x4WithMerge2x2();

      model.addRow(0);

      const snap = model.snapshot();

      // Origin shifted to [1,0]
      expect((snap.content[1][0] as CellContent).colspan).toBe(2);
      expect((snap.content[1][0] as CellContent).rowspan).toBe(2);
      // Covered cells shifted
      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([1, 0]);
      expect((snap.content[2][0] as CellContent).mergedInto).toEqual([1, 0]);
      expect((snap.content[2][1] as CellContent).mergedInto).toEqual([1, 0]);
      // New row 0 is plain
      expect((snap.content[0][0] as CellContent).mergedInto).toBeUndefined();
      expect((snap.content[0][0] as CellContent).colspan).toBeUndefined();
      expect(model.rows).toBe(5);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addRow inside a rowspan increments rowspan and marks new cells as covered', () => {
      const model = make4x4WithMerge2x2();

      model.addRow(1); // Insert between row 0 and row 1 of the merge

      const snap = model.snapshot();

      // Origin rowspan extended
      expect((snap.content[0][0] as CellContent).rowspan).toBe(3);
      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      // New row 1 cells within the merge are covered
      expect((snap.content[1][0] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([0, 0]);
      // New row 1 cells outside the merge are plain
      expect((snap.content[1][2] as CellContent).mergedInto).toBeUndefined();
      expect((snap.content[1][3] as CellContent).mergedInto).toBeUndefined();
      expect(model.rows).toBe(5);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addRow at row index equal to origin + rowspan does not extend the span', () => {
      const model = make4x4WithMerge2x2();

      model.addRow(2); // Right after the merge ends (merge covers rows 0-1)

      const snap = model.snapshot();

      expect((snap.content[0][0] as CellContent).rowspan).toBe(2); // Unchanged
      expect(model.rows).toBe(5);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addRow between two stacked merges updates lower merge references', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e')],
          [originCell(['f'], 1, 2), cell('g')],
          [coveredCell(3, 0), cell('h')],
        ],
      }));

      model.addRow(2); // Insert between the two merges

      const snap = model.snapshot();

      // Upper merge unchanged
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      // Lower merge shifted down by 1
      expect((snap.content[4][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[5][0] as CellContent).mergedInto).toEqual([4, 0]);
      expect(model.rows).toBe(6);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── deleteRow with merges ─────────────────────────────────────

  describe('deleteRow with merges', () => {
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    it('deleteRow outside any merge leaves merge metadata intact', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b'], 2, 2), coveredCell(0, 0), cell('c')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('d')],
          [cell('e'), cell('f'), cell('g')],
          [cell('h'), cell('i'), cell('j')],
        ],
      }));

      model.deleteRow(3);

      expect((model.snapshot().content[0][0] as CellContent).rowspan).toBe(2);
      expect(model.rows).toBe(3);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteRow of a covered row decrements the origin rowspan', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 2), coveredCell(0, 0)],
          [coveredCell(0, 0), coveredCell(0, 0)],
          [cell('b'), cell('c')],
        ],
      }));

      model.deleteRow(1); // Delete covered row

      const snap = model.snapshot();

      // rowspan decremented to 1 (omitted)
      expect((snap.content[0][0] as CellContent).rowspan).toBeUndefined();
      // colspan preserved
      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      expect((snap.content[0][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect(model.rows).toBe(2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteRow of the origin row transfers merge to the next row down', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b'], 2, 3), coveredCell(0, 0), cell('c')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('d')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('e')],
        ],
      }));

      model.deleteRow(0); // Delete the origin row

      const snap = model.snapshot();

      // New origin at [0,0] with decremented rowspan
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      // Blocks transferred to new origin
      expect((snap.content[0][0] as CellContent).blocks).toEqual(['a', 'b']);
      // Covered cells updated
      expect((snap.content[0][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][0] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect(model.rows).toBe(2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteRow of origin with rowspan=2 colspan=1 dissolves the merge entirely', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e')],
        ],
      }));

      model.deleteRow(0);

      const snap = model.snapshot();

      // The merge should be completely dissolved
      expect((snap.content[0][0] as CellContent).blocks).toEqual(['a']);
      expect((snap.content[0][0] as CellContent).rowspan).toBeUndefined();
      expect((snap.content[0][0] as CellContent).colspan).toBeUndefined();
      expect((snap.content[0][0] as CellContent).mergedInto).toBeUndefined();
      expect(model.rows).toBe(2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteRow above a merge shifts mergedInto row coordinates up by 1', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('x'), cell('y')],
          [cell('z'), cell('w')],
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(2, 0), cell('c')],
        ],
      }));

      model.deleteRow(0);

      const snap = model.snapshot();

      // Merge shifted up by 1
      expect((snap.content[1][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[2][0] as CellContent).mergedInto).toEqual([1, 0]);
      expect(model.rows).toBe(3);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── addColumn with merges ─────────────────────────────────────

  describe('addColumn with merges', () => {
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    it('addColumn after all merges does not alter merge metadata', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b'], 2, 1), coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      model.addColumn(3);

      expect((model.snapshot().content[0][0] as CellContent).colspan).toBe(2);
      expect(model.cols).toBe(4);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addColumn before a merge shifts mergedInto col coordinates right by 1', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('x'), originCell(['a', 'b'], 2, 1), coveredCell(0, 1)],
          [cell('c'), cell('d'), cell('e')],
        ],
      }));

      model.addColumn(0);

      const snap = model.snapshot();

      // Origin shifted to [0,2]
      expect((snap.content[0][2] as CellContent).colspan).toBe(2);
      // Covered cell shifted
      expect((snap.content[0][3] as CellContent).mergedInto).toEqual([0, 2]);
      expect(model.cols).toBe(4);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addColumn inside a colspan increments colspan and marks new cells as covered', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 2), coveredCell(0, 0), cell('b')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      model.addColumn(1); // Insert between col 0 and col 1 of the merge

      const snap = model.snapshot();

      // Colspan extended
      expect((snap.content[0][0] as CellContent).colspan).toBe(3);
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      // New cells within the merge are covered
      expect((snap.content[0][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([0, 0]);
      // New cells outside the rowspan are plain
      expect((snap.content[2][1] as CellContent).mergedInto).toBeUndefined();
      expect(model.cols).toBe(4);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('addColumn at col index equal to origin + colspan does not extend the span', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 1), coveredCell(0, 0), cell('b')],
          [cell('c'), cell('d'), cell('e')],
        ],
      }));

      model.addColumn(2); // Right after the merge ends

      expect((model.snapshot().content[0][0] as CellContent).colspan).toBe(2);
      expect(model.cols).toBe(4);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── deleteColumn with merges ──────────────────────────────────

  describe('deleteColumn with merges', () => {
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    it('deleteColumn outside any merge leaves merge metadata intact', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 1), coveredCell(0, 0), cell('b')],
          [cell('c'), cell('d'), cell('e')],
        ],
      }));

      model.deleteColumn(2);

      expect((model.snapshot().content[0][0] as CellContent).colspan).toBe(2);
      expect(model.cols).toBe(2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteColumn of a covered column decrements the origin colspan', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 2), coveredCell(0, 0)],
          [coveredCell(0, 0), coveredCell(0, 0)],
          [cell('b'), cell('c')],
        ],
      }));

      model.deleteColumn(1); // Delete covered column

      const snap = model.snapshot();

      // colspan decremented to 1 (omitted)
      expect((snap.content[0][0] as CellContent).colspan).toBeUndefined();
      // rowspan preserved
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[1][0] as CellContent).mergedInto).toEqual([0, 0]);
      expect(model.cols).toBe(1);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteColumn of the origin column transfers merge to the next column right', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 3, 2), coveredCell(0, 0), coveredCell(0, 0), cell('b')],
          [coveredCell(0, 0), coveredCell(0, 0), coveredCell(0, 0), cell('c')],
        ],
      }));

      model.deleteColumn(0); // Delete the origin column

      const snap = model.snapshot();

      // New origin at [0,0] with decremented colspan
      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      expect((snap.content[0][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[0][0] as CellContent).blocks).toEqual(['a']);
      expect((snap.content[0][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][0] as CellContent).mergedInto).toEqual([0, 0]);
      expect((snap.content[1][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect(model.cols).toBe(3);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('deleteColumn to the left of a merge shifts mergedInto col coordinates left by 1', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('x'), cell('y'), originCell(['a'], 2, 1), coveredCell(0, 2)],
          [cell('a'), cell('b'), cell('c'), cell('d')],
        ],
      }));

      model.deleteColumn(0);

      const snap = model.snapshot();

      expect((snap.content[0][1] as CellContent).colspan).toBe(2);
      expect((snap.content[0][2] as CellContent).mergedInto).toEqual([0, 1]);
      expect(model.cols).toBe(3);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── moveRow with merges ───────────────────────────────────────

  describe('moveRow with merges', () => {
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    it('moveRow is blocked when the source row is partially inside a merge', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e')],
        ],
      }));

      const before = model.snapshot();

      model.moveRow(0, 2); // Origin row is part of a multi-row merge

      // Should be a no-op
      expect(model.snapshot()).toEqual(before);
    });

    it('moveRow is blocked when the source row is a covered row of a merge', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(0, 0), cell('c')],
          [cell('d'), cell('e')],
        ],
      }));

      const before = model.snapshot();

      model.moveRow(1, 2); // Covered row

      expect(model.snapshot()).toEqual(before);
    });

    it('moveRow of a free row past a merge updates mergedInto coordinates', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('x'), cell('y')],
          [originCell(['a'], 1, 2), cell('b')],
          [coveredCell(1, 0), cell('c')],
          [cell('d'), cell('e')],
        ],
      }));

      model.moveRow(3, 0); // Move free row above everything

      const snap = model.snapshot();

      // Merge shifted down by 1
      expect((snap.content[2][0] as CellContent).rowspan).toBe(2);
      expect((snap.content[3][0] as CellContent).mergedInto).toEqual([2, 0]);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── moveColumn with merges ────────────────────────────────────

  describe('moveColumn with merges', () => {
    const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
      blocks,
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    });

    const coveredCell = (originRow: number, originCol: number): CellContent => ({
      blocks: [],
      mergedInto: [originRow, originCol],
    });

    it('moveColumn is blocked when the source column is partially inside a merge', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 1), coveredCell(0, 0), cell('b')],
          [cell('c'), cell('d'), cell('e')],
        ],
      }));

      const before = model.snapshot();

      model.moveColumn(0, 2);

      expect(model.snapshot()).toEqual(before);
    });

    it('moveColumn of a free column past a merge updates mergedInto coordinates', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('x'), originCell(['a'], 2, 1), coveredCell(0, 1)],
          [cell('y'), cell('b'), cell('c')],
        ],
      }));

      model.moveColumn(0, 2); // Move free col to end

      const snap = model.snapshot();

      // Merge shifted left by 1
      expect((snap.content[0][0] as CellContent).colspan).toBe(2);
      expect((snap.content[0][1] as CellContent).mergedInto).toEqual([0, 0]);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  describe('merge edge cases', () => {
    it('merging already-merged cells into a larger merge', () => {
      const model = make4x4();

      // First merge top-left 2x2
      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      // Now merge the full top 2x4 (which fully contains the 2x2 merge)
      expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 3 })).toBe(true);

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 3 });

      const snap = model.snapshot();
      const origin = snap.content[0][0] as CellContent;

      expect(origin.colspan).toBe(4);
      expect(origin.rowspan).toBe(2);

      // Should contain all blocks from the original 2x4 area
      expect(origin.blocks).toEqual(expect.arrayContaining([
        'r0c0', 'r0c1', 'r0c2', 'r0c3',
        'r1c0', 'r1c1', 'r1c2', 'r1c3',
      ]));
    });

    it('blocks from empty cells do not pollute the merged cell', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), { blocks: [] }],
          [{ blocks: [] }, cell('d')],
        ] as CellContent[][],
      }));

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const origin = model.snapshot().content[0][0] as CellContent;

      expect(origin.blocks).toEqual(['a', 'd']);
    });
  });
});
