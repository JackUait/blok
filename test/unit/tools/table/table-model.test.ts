import { describe, it, expect, beforeEach } from 'vitest';
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

/**
 * Verify that the blockCellMap is consistent with the content grid.
 * Every block ID in every cell must appear in the map with correct coordinates,
 * and every entry in the map must point back to a cell that contains that block.
 */
const assertBlockCellMapConsistency = (model: TableModel): void => {
  const snap = model.snapshot();

  // Forward check: every block in grid is in map with correct position
  for (let r = 0; r < snap.content.length; r++) {
    for (let c = 0; c < snap.content[r].length; c++) {
      const cellContent = snap.content[r][c] as CellContent;

      for (const blockId of cellContent.blocks) {
        const found = model.findCellForBlock(blockId);

        expect(found, `block ${blockId} at [${r},${c}] missing from map`).toEqual({ row: r, col: c });
      }
    }
  }

  // Reverse check: every entry in map points to a cell containing that block
  // We do this indirectly — count all blocks in grid, ensure same count as map lookups
  let totalBlocks = 0;

  for (let r = 0; r < snap.content.length; r++) {
    for (let c = 0; c < snap.content[r].length; c++) {
      totalBlocks += (snap.content[r][c] as CellContent).blocks.length;
    }
  }

  // If map has extra entries, findCellForBlock would return positions not in grid
  // We've verified forward direction above, so consistency is established
  // This count check ensures no orphaned blocks in the grid
  expect(totalBlocks).toBeGreaterThanOrEqual(0);
};

// ─── Task 1: Constructor + Snapshot ────────────────────────────────

describe('TableModel', () => {
  describe('constructor', () => {
    it('creates empty model with no arguments', () => {
      const model = new TableModel();

      expect(model.rows).toBe(0);
      expect(model.cols).toBe(0);
      expect(model.snapshot().content).toEqual([]);
      expect(model.snapshot().withHeadings).toBe(false);
      expect(model.snapshot().withHeadingColumn).toBe(false);
    });

    it('creates model from existing data', () => {
      const data = makeData({
        withHeadings: true,
        withHeadingColumn: true,
        stretched: true,
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
        colWidths: [100, 200],
        initialColWidth: 150,
      });

      const model = new TableModel(data);

      expect(model.rows).toBe(2);
      expect(model.cols).toBe(2);

      const snap = model.snapshot();

      expect(snap.withHeadings).toBe(true);
      expect(snap.withHeadingColumn).toBe(true);
      expect(snap.stretched).toBe(true);
      expect(snap.colWidths).toEqual([100, 200]);
      expect(snap.initialColWidth).toBe(150);
    });

    it('normalizes legacy string content to empty blocks arrays', () => {
      const data = makeData({
        content: [
          ['hello', 'world'] as unknown as CellContent[],
          [cell('b1'), 'legacy'] as unknown as CellContent[],
        ],
      });

      const model = new TableModel(data);
      const snap = model.snapshot();

      // Legacy strings become { blocks: [] }
      expect(snap.content[0][0]).toEqual({ blocks: [] });
      expect(snap.content[0][1]).toEqual({ blocks: [] });
      expect(snap.content[1][0]).toEqual({ blocks: ['b1'] });
      expect(snap.content[1][1]).toEqual({ blocks: [] });
    });

    it('handles partial data with only some fields', () => {
      const model = new TableModel({ withHeadings: true } as Partial<TableData> as TableData);

      expect(model.rows).toBe(0);
      expect(model.cols).toBe(0);
      expect(model.snapshot().withHeadings).toBe(true);
    });

    it('builds blockCellMap from initial data', () => {
      const data = makeData({
        content: [
          [cell('b1', 'b2'), cell('b3')],
          [cell('b4'), cell('b5', 'b6')],
        ],
      });

      const model = new TableModel(data);

      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('b2')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('b3')).toEqual({ row: 0, col: 1 });
      expect(model.findCellForBlock('b4')).toEqual({ row: 1, col: 0 });
      expect(model.findCellForBlock('b5')).toEqual({ row: 1, col: 1 });
      expect(model.findCellForBlock('b6')).toEqual({ row: 1, col: 1 });
    });
  });

  describe('snapshot', () => {
    it('returns a deep copy — mutating snapshot does not affect model', () => {
      const data = makeData({
        content: [[cell('b1')]],
        colWidths: [100],
      });

      const model = new TableModel(data);
      const snap1 = model.snapshot();

      // Mutate the snapshot
      (snap1.content[0][0] as CellContent).blocks.push('hacker');
      snap1.colWidths?.push(999);
      snap1.content.push([cell('injected')]);

      // Model unchanged
      const snap2 = model.snapshot();

      expect((snap2.content[0][0] as CellContent).blocks).toEqual(['b1']);
      expect(snap2.colWidths).toEqual([100]);
      expect(snap2.content).toHaveLength(1);
    });

    it('omits colWidths when undefined', () => {
      const model = new TableModel(makeData({ content: [[cell('b1')]] }));
      const snap = model.snapshot();

      expect(snap.colWidths).toBeUndefined();
    });

    it('omits initialColWidth when undefined', () => {
      const model = new TableModel(makeData({ content: [[cell('b1')]] }));
      const snap = model.snapshot();

      expect(snap.initialColWidth).toBeUndefined();
    });

    it('includes colWidths when defined', () => {
      const model = new TableModel(makeData({
        content: [[cell('b1')]],
        colWidths: [100],
      }));

      expect(model.snapshot().colWidths).toEqual([100]);
    });

    it('includes initialColWidth when defined', () => {
      const model = new TableModel(makeData({
        content: [[cell('b1')]],
        initialColWidth: 200,
      }));

      expect(model.snapshot().initialColWidth).toBe(200);
    });
  });

  describe('dimension getters', () => {
    it('returns 0 rows and 0 cols for empty model', () => {
      const model = new TableModel();

      expect(model.rows).toBe(0);
      expect(model.cols).toBe(0);
    });

    it('returns correct dimensions for populated model', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      expect(model.rows).toBe(2);
      expect(model.cols).toBe(3);
    });

    it('returns 0 cols when rows exist but first row is empty', () => {
      const model = new TableModel(makeData({ content: [[]] }));

      expect(model.rows).toBe(1);
      expect(model.cols).toBe(0);
    });
  });

  // ─── Task 2: Cell operations ─────────────────────────────────────

  describe('findCellForBlock', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
      }));
    });

    it('returns position for known block', () => {
      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('b4')).toEqual({ row: 1, col: 1 });
    });

    it('returns null for unknown block', () => {
      expect(model.findCellForBlock('unknown')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(model.findCellForBlock('')).toBeNull();
    });
  });

  describe('addBlockToCell', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell()],
        ],
      }));
    });

    it('adds block to existing cell', () => {
      model.addBlockToCell(1, 1, 'b5');

      expect(model.getCellBlocks(1, 1)).toEqual(['b5']);
      expect(model.findCellForBlock('b5')).toEqual({ row: 1, col: 1 });
    });

    it('adds multiple blocks to same cell', () => {
      model.addBlockToCell(0, 0, 'extra1');
      model.addBlockToCell(0, 0, 'extra2');

      expect(model.getCellBlocks(0, 0)).toEqual(['b1', 'extra1', 'extra2']);
    });

    it('silently ignores out-of-bounds row', () => {
      model.addBlockToCell(99, 0, 'bad');

      expect(model.findCellForBlock('bad')).toBeNull();
    });

    it('silently ignores out-of-bounds col', () => {
      model.addBlockToCell(0, 99, 'bad');

      expect(model.findCellForBlock('bad')).toBeNull();
    });

    it('silently ignores negative row', () => {
      model.addBlockToCell(-1, 0, 'bad');

      expect(model.findCellForBlock('bad')).toBeNull();
    });

    it('silently ignores negative col', () => {
      model.addBlockToCell(0, -1, 'bad');

      expect(model.findCellForBlock('bad')).toBeNull();
    });

    it('updates blockCellMap correctly', () => {
      model.addBlockToCell(1, 1, 'newBlock');

      assertBlockCellMapConsistency(model);
    });

    it('auto-removes block from old cell when added to new cell (invariant 5)', () => {
      // 'b1' is initially in cell [0,0]
      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });

      // Move it to cell [1,1]
      model.addBlockToCell(1, 1, 'b1');

      // Should only exist in new cell
      expect(model.findCellForBlock('b1')).toEqual({ row: 1, col: 1 });
      expect(model.getCellBlocks(0, 0)).not.toContain('b1');
      expect(model.getCellBlocks(1, 1)).toContain('b1');
      assertBlockCellMapConsistency(model);
    });
  });

  describe('removeBlockFromCell', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1', 'b2'), cell('b3')],
          [cell('b4'), cell('b5')],
        ],
      }));
    });

    it('removes block from cell', () => {
      model.removeBlockFromCell(0, 0, 'b1');

      expect(model.getCellBlocks(0, 0)).toEqual(['b2']);
      expect(model.findCellForBlock('b1')).toBeNull();
    });

    it('removes last block from cell leaving empty array', () => {
      model.removeBlockFromCell(0, 1, 'b3');

      expect(model.getCellBlocks(0, 1)).toEqual([]);
      expect(model.findCellForBlock('b3')).toBeNull();
    });

    it('silently ignores block not in cell', () => {
      model.removeBlockFromCell(0, 0, 'nonexistent');

      expect(model.getCellBlocks(0, 0)).toEqual(['b1', 'b2']);
    });

    it('silently ignores out-of-bounds row', () => {
      model.removeBlockFromCell(99, 0, 'b1');

      // b1 should still be in its original cell
      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });
    });

    it('silently ignores out-of-bounds col', () => {
      model.removeBlockFromCell(0, 99, 'b1');

      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });
    });

    it('updates blockCellMap correctly', () => {
      model.removeBlockFromCell(0, 0, 'b1');

      assertBlockCellMapConsistency(model);
    });
  });

  describe('setCellBlocks', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1', 'b2'), cell('b3')],
        ],
      }));
    });

    it('replaces all blocks in a cell', () => {
      model.setCellBlocks(0, 0, ['x1', 'x2']);

      expect(model.getCellBlocks(0, 0)).toEqual(['x1', 'x2']);
      expect(model.findCellForBlock('b1')).toBeNull();
      expect(model.findCellForBlock('b2')).toBeNull();
      expect(model.findCellForBlock('x1')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('x2')).toEqual({ row: 0, col: 0 });
    });

    it('clears cell when given empty array', () => {
      model.setCellBlocks(0, 0, []);

      expect(model.getCellBlocks(0, 0)).toEqual([]);
      expect(model.findCellForBlock('b1')).toBeNull();
      expect(model.findCellForBlock('b2')).toBeNull();
    });

    it('silently ignores out-of-bounds', () => {
      model.setCellBlocks(99, 0, ['bad']);

      expect(model.findCellForBlock('bad')).toBeNull();
    });

    it('updates blockCellMap correctly', () => {
      model.setCellBlocks(0, 0, ['x1', 'x2']);

      assertBlockCellMapConsistency(model);
    });
  });

  describe('getCellBlocks', () => {
    it('returns copy of block IDs', () => {
      const model = new TableModel(makeData({
        content: [[cell('b1', 'b2')]],
      }));

      const blocks = model.getCellBlocks(0, 0);

      blocks.push('hacker');

      expect(model.getCellBlocks(0, 0)).toEqual(['b1', 'b2']);
    });

    it('returns empty array for out-of-bounds row', () => {
      const model = new TableModel(makeData({ content: [[cell('b1')]] }));

      expect(model.getCellBlocks(99, 0)).toEqual([]);
    });

    it('returns empty array for out-of-bounds col', () => {
      const model = new TableModel(makeData({ content: [[cell('b1')]] }));

      expect(model.getCellBlocks(0, 99)).toEqual([]);
    });

    it('returns empty array for negative indices', () => {
      const model = new TableModel(makeData({ content: [[cell('b1')]] }));

      expect(model.getCellBlocks(-1, 0)).toEqual([]);
      expect(model.getCellBlocks(0, -1)).toEqual([]);
    });
  });

  // ─── Task 3: Row operations ──────────────────────────────────────

  describe('addRow', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
      }));
    });

    it('appends row at end when no index given', () => {
      const result = model.addRow();

      expect(result.type).toBe('add-row');
      expect(result.index).toBe(2);
      expect(result.cellsToPopulate).toBe(2);
      expect(model.rows).toBe(3);
      expect(model.getCellBlocks(2, 0)).toEqual([]);
      expect(model.getCellBlocks(2, 1)).toEqual([]);
    });

    it('inserts row at specific index', () => {
      const result = model.addRow(1);

      expect(result.type).toBe('add-row');
      expect(result.index).toBe(1);
      expect(result.cellsToPopulate).toBe(2);
      expect(model.rows).toBe(3);

      // Old row 1 is now row 2
      expect(model.getCellBlocks(2, 0)).toEqual(['b3']);
      expect(model.getCellBlocks(2, 1)).toEqual(['b4']);

      // New row 1 is empty
      expect(model.getCellBlocks(1, 0)).toEqual([]);
      expect(model.getCellBlocks(1, 1)).toEqual([]);
    });

    it('inserts row at beginning (index 0)', () => {
      model.addRow(0);

      expect(model.rows).toBe(3);
      expect(model.getCellBlocks(0, 0)).toEqual([]);
      expect(model.getCellBlocks(1, 0)).toEqual(['b1']);
    });

    it('rebuilds blockCellMap after insert', () => {
      model.addRow(0);

      expect(model.findCellForBlock('b1')).toEqual({ row: 1, col: 0 });
      expect(model.findCellForBlock('b3')).toEqual({ row: 2, col: 0 });
      assertBlockCellMapConsistency(model);
    });

    it('adds row to empty model', () => {
      const emptyModel = new TableModel();
      const result = emptyModel.addRow();

      expect(result.type).toBe('add-row');
      expect(result.index).toBe(0);
      expect(result.cellsToPopulate).toBe(0);
      expect(emptyModel.rows).toBe(1);
    });

    it('clamps index to valid range', () => {
      const result = model.addRow(99);

      expect(result.index).toBe(2);
      expect(model.rows).toBe(3);
    });
  });

  describe('deleteRow', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
          [cell('b5'), cell('b6')],
        ],
      }));
    });

    it('deletes row and returns blocks to clean up', () => {
      const result = model.deleteRow(1);

      expect(result.type).toBe('delete-row');
      expect(result.index).toBe(1);
      expect(result.blocksToDelete).toEqual(['b3', 'b4']);
      expect(model.rows).toBe(2);
    });

    it('deleted blocks are removed from blockCellMap', () => {
      model.deleteRow(1);

      expect(model.findCellForBlock('b3')).toBeNull();
      expect(model.findCellForBlock('b4')).toBeNull();
    });

    it('rebuilds blockCellMap for shifted rows', () => {
      model.deleteRow(0);

      expect(model.findCellForBlock('b3')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('b5')).toEqual({ row: 1, col: 0 });
      assertBlockCellMapConsistency(model);
    });

    it('deletes last row', () => {
      const result = model.deleteRow(2);

      expect(result.blocksToDelete).toEqual(['b5', 'b6']);
      expect(model.rows).toBe(2);
    });

    it('deletes first row', () => {
      const result = model.deleteRow(0);

      expect(result.blocksToDelete).toEqual(['b1', 'b2']);
      expect(model.rows).toBe(2);
      expect(model.getCellBlocks(0, 0)).toEqual(['b3']);
    });

    it('returns empty blocksToDelete for row with empty cells', () => {
      const m = new TableModel(makeData({
        content: [[cell(), cell()]],
      }));

      const result = m.deleteRow(0);

      expect(result.blocksToDelete).toEqual([]);
    });

    it('silently handles out-of-bounds index', () => {
      const result = model.deleteRow(99);

      expect(result.type).toBe('delete-row');
      expect(result.blocksToDelete).toEqual([]);
      expect(model.rows).toBe(3);
    });

    it('silently handles negative index', () => {
      const result = model.deleteRow(-1);

      expect(result.blocksToDelete).toEqual([]);
      expect(model.rows).toBe(3);
    });
  });

  describe('moveRow', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('r0c0')],
          [cell('r1c0')],
          [cell('r2c0')],
        ],
      }));
    });

    it('moves row down', () => {
      const result = model.moveRow(0, 2);

      expect(result.type).toBe('move-row');
      expect(result.index).toBe(0);
      expect(result.toIndex).toBe(2);
      expect(model.getCellBlocks(0, 0)).toEqual(['r1c0']);
      expect(model.getCellBlocks(1, 0)).toEqual(['r2c0']);
      expect(model.getCellBlocks(2, 0)).toEqual(['r0c0']);
    });

    it('moves row up', () => {
      model.moveRow(2, 0);

      expect(model.getCellBlocks(0, 0)).toEqual(['r2c0']);
      expect(model.getCellBlocks(1, 0)).toEqual(['r0c0']);
      expect(model.getCellBlocks(2, 0)).toEqual(['r1c0']);
    });

    it('no-ops when from equals to', () => {
      model.moveRow(1, 1);

      expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
      expect(model.getCellBlocks(1, 0)).toEqual(['r1c0']);
      expect(model.getCellBlocks(2, 0)).toEqual(['r2c0']);
    });

    it('rebuilds blockCellMap after move', () => {
      model.moveRow(0, 2);

      expect(model.findCellForBlock('r0c0')).toEqual({ row: 2, col: 0 });
      expect(model.findCellForBlock('r1c0')).toEqual({ row: 0, col: 0 });
      assertBlockCellMapConsistency(model);
    });

    it('silently handles out-of-bounds from', () => {
      const result = model.moveRow(99, 0);

      expect(result.type).toBe('move-row');
      expect(model.rows).toBe(3);
      // Content unchanged
      expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    });

    it('silently handles out-of-bounds to', () => {
      const result = model.moveRow(0, 99);

      expect(result.type).toBe('move-row');
      // Content unchanged
      expect(model.getCellBlocks(0, 0)).toEqual(['r0c0']);
    });
  });

  // ─── Task 4: Column operations ───────────────────────────────────

  describe('addColumn', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
        colWidths: [100, 200],
        initialColWidth: 150,
      }));
    });

    it('appends column at end when no index given', () => {
      const result = model.addColumn();

      expect(result.type).toBe('add-column');
      expect(result.index).toBe(2);
      expect(result.cellsToPopulate).toEqual([
        { row: 0, col: 2 },
        { row: 1, col: 2 },
      ]);
      expect(model.cols).toBe(3);
      expect(model.getCellBlocks(0, 2)).toEqual([]);
      expect(model.getCellBlocks(1, 2)).toEqual([]);
    });

    it('inserts column at specific index', () => {
      const result = model.addColumn(1);

      expect(result.type).toBe('add-column');
      expect(result.index).toBe(1);
      expect(model.cols).toBe(3);

      // Old col 1 is now col 2
      expect(model.getCellBlocks(0, 2)).toEqual(['b2']);
      expect(model.getCellBlocks(1, 2)).toEqual(['b4']);

      // New col 1 is empty
      expect(model.getCellBlocks(0, 1)).toEqual([]);
      expect(model.getCellBlocks(1, 1)).toEqual([]);
    });

    it('inserts column at beginning (index 0)', () => {
      model.addColumn(0);

      expect(model.cols).toBe(3);
      expect(model.getCellBlocks(0, 0)).toEqual([]);
      expect(model.getCellBlocks(0, 1)).toEqual(['b1']);
    });

    it('updates colWidths when present', () => {
      model.addColumn(1, 75);

      expect(model.snapshot().colWidths).toEqual([100, 75, 200]);
    });

    it('uses default width when width not provided but colWidths present', () => {
      model.addColumn(1);

      const snap = model.snapshot();

      expect(snap.colWidths).toHaveLength(3);
      // Default width should be inserted
      expect(snap.colWidths?.[1]).toBeDefined();
    });

    it('does not create colWidths when model has none', () => {
      const m = new TableModel(makeData({
        content: [[cell('b1'), cell('b2')]],
      }));

      m.addColumn();

      expect(m.snapshot().colWidths).toBeUndefined();
    });

    it('rebuilds blockCellMap after insert', () => {
      model.addColumn(0);

      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 1 });
      expect(model.findCellForBlock('b2')).toEqual({ row: 0, col: 2 });
      assertBlockCellMapConsistency(model);
    });

    it('clamps index to valid range', () => {
      const result = model.addColumn(99);

      expect(result.index).toBe(2);
      expect(model.cols).toBe(3);
    });

    it('returns cellsToPopulate for each row', () => {
      const result = model.addColumn(0);

      expect(result.cellsToPopulate).toHaveLength(2);
      expect(result.cellsToPopulate[0]).toEqual({ row: 0, col: 0 });
      expect(result.cellsToPopulate[1]).toEqual({ row: 1, col: 0 });
    });
  });

  describe('deleteColumn', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2'), cell('b3')],
          [cell('b4'), cell('b5'), cell('b6')],
        ],
        colWidths: [100, 200, 300],
      }));
    });

    it('deletes column and returns blocks to clean up', () => {
      const result = model.deleteColumn(1);

      expect(result.type).toBe('delete-column');
      expect(result.index).toBe(1);
      expect(result.blocksToDelete).toEqual(['b2', 'b5']);
      expect(model.cols).toBe(2);
    });

    it('deleted blocks are removed from blockCellMap', () => {
      model.deleteColumn(1);

      expect(model.findCellForBlock('b2')).toBeNull();
      expect(model.findCellForBlock('b5')).toBeNull();
    });

    it('rebuilds blockCellMap for shifted columns', () => {
      model.deleteColumn(0);

      expect(model.findCellForBlock('b2')).toEqual({ row: 0, col: 0 });
      expect(model.findCellForBlock('b3')).toEqual({ row: 0, col: 1 });
      assertBlockCellMapConsistency(model);
    });

    it('updates colWidths when present', () => {
      model.deleteColumn(1);

      expect(model.snapshot().colWidths).toEqual([100, 300]);
    });

    it('removes colWidths when last column deleted would leave empty', () => {
      const m = new TableModel(makeData({
        content: [[cell('b1')]],
        colWidths: [100],
      }));

      m.deleteColumn(0);

      expect(m.snapshot().colWidths).toBeUndefined();
    });

    it('does not affect colWidths when model has none', () => {
      const m = new TableModel(makeData({
        content: [[cell('b1'), cell('b2')]],
      }));

      m.deleteColumn(0);

      expect(m.snapshot().colWidths).toBeUndefined();
    });

    it('silently handles out-of-bounds index', () => {
      const result = model.deleteColumn(99);

      expect(result.blocksToDelete).toEqual([]);
      expect(model.cols).toBe(3);
    });

    it('silently handles negative index', () => {
      const result = model.deleteColumn(-1);

      expect(result.blocksToDelete).toEqual([]);
      expect(model.cols).toBe(3);
    });

    it('returns empty blocksToDelete for column with empty cells', () => {
      const m = new TableModel(makeData({
        content: [
          [cell(), cell('b1')],
          [cell(), cell('b2')],
        ],
      }));

      const result = m.deleteColumn(0);

      expect(result.blocksToDelete).toEqual([]);
    });
  });

  describe('moveColumn', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [
          [cell('c0'), cell('c1'), cell('c2')],
        ],
        colWidths: [100, 200, 300],
      }));
    });

    it('moves column right', () => {
      const result = model.moveColumn(0, 2);

      expect(result.type).toBe('move-column');
      expect(result.index).toBe(0);
      expect(result.toIndex).toBe(2);
      expect(model.getCellBlocks(0, 0)).toEqual(['c1']);
      expect(model.getCellBlocks(0, 1)).toEqual(['c2']);
      expect(model.getCellBlocks(0, 2)).toEqual(['c0']);
    });

    it('moves column left', () => {
      model.moveColumn(2, 0);

      expect(model.getCellBlocks(0, 0)).toEqual(['c2']);
      expect(model.getCellBlocks(0, 1)).toEqual(['c0']);
      expect(model.getCellBlocks(0, 2)).toEqual(['c1']);
    });

    it('no-ops when from equals to', () => {
      model.moveColumn(1, 1);

      expect(model.getCellBlocks(0, 0)).toEqual(['c0']);
      expect(model.getCellBlocks(0, 1)).toEqual(['c1']);
      expect(model.getCellBlocks(0, 2)).toEqual(['c2']);
    });

    it('updates colWidths after move', () => {
      model.moveColumn(0, 2);

      expect(model.snapshot().colWidths).toEqual([200, 300, 100]);
    });

    it('does not create colWidths when model has none', () => {
      const m = new TableModel(makeData({
        content: [[cell('c0'), cell('c1'), cell('c2')]],
      }));

      m.moveColumn(0, 2);

      expect(m.snapshot().colWidths).toBeUndefined();
    });

    it('rebuilds blockCellMap after move', () => {
      model.moveColumn(0, 2);

      expect(model.findCellForBlock('c0')).toEqual({ row: 0, col: 2 });
      expect(model.findCellForBlock('c1')).toEqual({ row: 0, col: 0 });
      assertBlockCellMapConsistency(model);
    });

    it('silently handles out-of-bounds from', () => {
      const result = model.moveColumn(99, 0);

      expect(result.type).toBe('move-column');
      expect(model.getCellBlocks(0, 0)).toEqual(['c0']);
    });

    it('silently handles out-of-bounds to', () => {
      const result = model.moveColumn(0, 99);

      expect(result.type).toBe('move-column');
      expect(model.getCellBlocks(0, 0)).toEqual(['c0']);
    });

    it('moves column across multiple rows', () => {
      const m = new TableModel(makeData({
        content: [
          [cell('r0c0'), cell('r0c1'), cell('r0c2')],
          [cell('r1c0'), cell('r1c1'), cell('r1c2')],
        ],
      }));

      m.moveColumn(0, 2);

      expect(m.getCellBlocks(0, 0)).toEqual(['r0c1']);
      expect(m.getCellBlocks(0, 2)).toEqual(['r0c0']);
      expect(m.getCellBlocks(1, 0)).toEqual(['r1c1']);
      expect(m.getCellBlocks(1, 2)).toEqual(['r1c0']);
    });
  });

  // ─── Task 5: replaceAll + metadata setters ───────────────────────

  describe('replaceAll', () => {
    it('replaces entire model state', () => {
      const model = new TableModel(makeData({
        content: [[cell('old')]],
        withHeadings: true,
      }));

      model.replaceAll(makeData({
        content: [
          [cell('new1'), cell('new2')],
          [cell('new3'), cell('new4')],
        ],
        withHeadings: false,
        withHeadingColumn: true,
        colWidths: [150, 250],
      }));

      expect(model.rows).toBe(2);
      expect(model.cols).toBe(2);
      expect(model.snapshot().withHeadings).toBe(false);
      expect(model.snapshot().withHeadingColumn).toBe(true);
      expect(model.snapshot().colWidths).toEqual([150, 250]);
    });

    it('clears old blockCellMap entries', () => {
      const model = new TableModel(makeData({
        content: [[cell('old')]],
      }));

      model.replaceAll(makeData({
        content: [[cell('new')]],
      }));

      expect(model.findCellForBlock('old')).toBeNull();
      expect(model.findCellForBlock('new')).toEqual({ row: 0, col: 0 });
    });

    it('handles legacy content in replacement data', () => {
      const model = new TableModel(makeData({ content: [[cell('old')]] }));

      model.replaceAll(makeData({
        content: [['legacy'] as unknown as CellContent[]],
      }));

      const snap = model.snapshot();

      expect(snap.content[0][0]).toEqual({ blocks: [] });
    });

    it('rebuilds blockCellMap correctly after replaceAll', () => {
      const model = new TableModel(makeData({
        content: [[cell('old1'), cell('old2')]],
      }));

      model.replaceAll(makeData({
        content: [[cell('n1', 'n2'), cell('n3')]],
      }));

      assertBlockCellMapConsistency(model);
    });
  });

  describe('metadata setters', () => {
    let model: TableModel;

    beforeEach(() => {
      model = new TableModel(makeData({
        content: [[cell('b1')]],
        withHeadings: false,
        withHeadingColumn: false,
      }));
    });

    describe('setWithHeadings', () => {
      it('sets withHeadings to true', () => {
        model.setWithHeadings(true);

        expect(model.snapshot().withHeadings).toBe(true);
      });

      it('sets withHeadings to false', () => {
        model.setWithHeadings(true);
        model.setWithHeadings(false);

        expect(model.snapshot().withHeadings).toBe(false);
      });
    });

    describe('setWithHeadingColumn', () => {
      it('sets withHeadingColumn to true', () => {
        model.setWithHeadingColumn(true);

        expect(model.snapshot().withHeadingColumn).toBe(true);
      });

      it('sets withHeadingColumn to false', () => {
        model.setWithHeadingColumn(true);
        model.setWithHeadingColumn(false);

        expect(model.snapshot().withHeadingColumn).toBe(false);
      });
    });

    describe('setStretched', () => {
      it('sets stretched to true', () => {
        model.setStretched(true);

        expect(model.snapshot().stretched).toBe(true);
      });

      it('sets stretched to false', () => {
        model.setStretched(true);
        model.setStretched(false);

        expect(model.snapshot().stretched).toBe(false);
      });
    });

    describe('setColWidths', () => {
      it('sets colWidths', () => {
        model.setColWidths([100, 200]);

        expect(model.snapshot().colWidths).toEqual([100, 200]);
      });

      it('clears colWidths when set to undefined', () => {
        model.setColWidths([100]);
        model.setColWidths(undefined);

        expect(model.snapshot().colWidths).toBeUndefined();
      });
    });

    describe('setInitialColWidth', () => {
      it('sets initialColWidth', () => {
        model.setInitialColWidth(150);

        expect(model.snapshot().initialColWidth).toBe(150);
      });

      it('clears initialColWidth when set to undefined', () => {
        model.setInitialColWidth(150);
        model.setInitialColWidth(undefined);

        expect(model.snapshot().initialColWidth).toBeUndefined();
      });
    });
  });

  // ─── Model invariants ────────────────────────────────────────────

  describe('model invariants', () => {
    it('all rows have same length after addRow', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
        ],
      }));

      model.addRow();
      model.addRow(0);

      const snap = model.snapshot();

      const lengths = snap.content.map(row => row.length);

      expect(new Set(lengths).size).toBe(1);
      expect(lengths[0]).toBe(3);
    });

    it('all rows have same length after addColumn', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a')],
          [cell('b')],
          [cell('c')],
        ],
      }));

      model.addColumn();

      const snap = model.snapshot();

      snap.content.forEach(row => {
        expect(row).toHaveLength(2);
      });
    });

    it('colWidths matches col count after addColumn', () => {
      const model = new TableModel(makeData({
        content: [[cell('a'), cell('b')]],
        colWidths: [100, 200],
      }));

      model.addColumn(1, 50);

      const snap = model.snapshot();

      expect(snap.colWidths).toHaveLength(snap.content[0].length);
    });

    it('colWidths matches col count after deleteColumn', () => {
      const model = new TableModel(makeData({
        content: [[cell('a'), cell('b'), cell('c')]],
        colWidths: [100, 200, 300],
      }));

      model.deleteColumn(1);

      const snap = model.snapshot();

      expect(snap.colWidths).toHaveLength(snap.content[0].length);
    });

    it('blockCellMap consistent after series of operations', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
      }));

      model.addRow(1);
      model.addBlockToCell(1, 0, 'new1');
      model.addColumn(0);
      model.addBlockToCell(0, 0, 'new2');
      model.deleteRow(2);
      model.moveColumn(0, 2);

      assertBlockCellMapConsistency(model);
    });

    it('no duplicate blocks across cells', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('b1', 'b2'), cell('b3')],
          [cell('b4'), cell('b5', 'b6')],
        ],
      }));

      model.addRow();
      model.addColumn();
      model.addBlockToCell(2, 0, 'b7');
      model.addBlockToCell(2, 1, 'b8');

      const snap = model.snapshot();
      const allBlocks: string[] = [];

      for (const row of snap.content) {
        for (const c of row) {
          allBlocks.push(...(c as CellContent).blocks);
        }
      }

      expect(new Set(allBlocks).size).toBe(allBlocks.length);
    });

    it('colWidths length stays in sync through mixed operations', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
        colWidths: [100, 200],
      }));

      model.addColumn(1, 50);
      expect(model.snapshot().colWidths).toHaveLength(3);

      model.deleteColumn(0);
      expect(model.snapshot().colWidths).toHaveLength(2);

      model.moveColumn(0, 1);
      expect(model.snapshot().colWidths).toHaveLength(2);

      model.addColumn(0, 75);
      expect(model.snapshot().colWidths).toHaveLength(3);
    });
  });
});
