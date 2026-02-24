import { describe, it, expect, beforeEach } from 'vitest';
import { TableOwnershipRegistry } from '../../../../src/tools/table/ownership/table-ownership-registry';
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

// ─── Tests ─────────────────────────────────────────────────────────

describe('TableOwnershipRegistry', () => {
  let registry: TableOwnershipRegistry;

  beforeEach(() => {
    registry = new TableOwnershipRegistry();
  });

  describe('setOwner / getOwner', () => {
    it('tracks block ownership for a single table cell', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });

      const owner = registry.getOwner('block-1');

      expect(owner).toEqual({ tableId: 'table-A', row: 0, col: 0 });
    });

    it('returns null for unknown blocks', () => {
      expect(registry.getOwner('unknown')).toBeNull();
    });

    it('updates ownership when block moves to a different cell', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-1', { tableId: 'table-A', row: 1, col: 2 });

      expect(registry.getOwner('block-1')).toEqual({ tableId: 'table-A', row: 1, col: 2 });
    });

    it('same block cannot belong to two different tables', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-1', { tableId: 'table-B', row: 0, col: 0 });

      const owner = registry.getOwner('block-1');

      expect(owner).toEqual({ tableId: 'table-B', row: 0, col: 0 });
    });

    it('tracks multiple blocks in different cells', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-2', { tableId: 'table-A', row: 0, col: 1 });
      registry.setOwner('block-3', { tableId: 'table-A', row: 1, col: 0 });

      expect(registry.getOwner('block-1')).toEqual({ tableId: 'table-A', row: 0, col: 0 });
      expect(registry.getOwner('block-2')).toEqual({ tableId: 'table-A', row: 0, col: 1 });
      expect(registry.getOwner('block-3')).toEqual({ tableId: 'table-A', row: 1, col: 0 });
    });

    it('tracks blocks across multiple tables', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-2', { tableId: 'table-B', row: 0, col: 0 });

      expect(registry.getOwner('block-1')?.tableId).toBe('table-A');
      expect(registry.getOwner('block-2')?.tableId).toBe('table-B');
    });
  });

  describe('removeOwner', () => {
    it('removes block ownership', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.removeOwner('block-1');

      expect(registry.getOwner('block-1')).toBeNull();
    });

    it('does not throw when removing unknown block', () => {
      expect(() => registry.removeOwner('unknown')).not.toThrow();
    });
  });

  describe('getBlocksForTable', () => {
    it('returns all block IDs owned by a specific table', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('block-2', { tableId: 'table-A', row: 0, col: 1 });
      registry.setOwner('block-3', { tableId: 'table-B', row: 0, col: 0 });

      const tableABlocks = registry.getBlocksForTable('table-A');

      expect(tableABlocks).toHaveLength(2);
      expect(tableABlocks).toContain('block-1');
      expect(tableABlocks).toContain('block-2');
    });

    it('returns empty array for unknown table', () => {
      expect(registry.getBlocksForTable('unknown')).toEqual([]);
    });
  });

  describe('isOwnedByTable', () => {
    it('returns true when block belongs to the specified table', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });

      expect(registry.isOwnedByTable('block-1', 'table-A')).toBe(true);
    });

    it('returns false when block belongs to a different table', () => {
      registry.setOwner('block-1', { tableId: 'table-A', row: 0, col: 0 });

      expect(registry.isOwnedByTable('block-1', 'table-B')).toBe(false);
    });

    it('returns false for unknown blocks', () => {
      expect(registry.isOwnedByTable('unknown', 'table-A')).toBe(false);
    });
  });

  describe('reconcileWithModel', () => {
    it('registry content matches model block map after reconciliation', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('b1', 'b2'), cell('b3')],
          [cell('b4'), cell('b5', 'b6')],
        ],
      }));

      // Set some stale ownership
      registry.setOwner('stale-block', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('b1', { tableId: 'table-A', row: 5, col: 5 }); // wrong position

      registry.reconcileWithModel('table-A', model);

      // Stale block should be removed
      expect(registry.getOwner('stale-block')).toBeNull();

      // All model blocks should have correct positions
      expect(registry.getOwner('b1')).toEqual({ tableId: 'table-A', row: 0, col: 0 });
      expect(registry.getOwner('b2')).toEqual({ tableId: 'table-A', row: 0, col: 0 });
      expect(registry.getOwner('b3')).toEqual({ tableId: 'table-A', row: 0, col: 1 });
      expect(registry.getOwner('b4')).toEqual({ tableId: 'table-A', row: 1, col: 0 });
      expect(registry.getOwner('b5')).toEqual({ tableId: 'table-A', row: 1, col: 1 });
      expect(registry.getOwner('b6')).toEqual({ tableId: 'table-A', row: 1, col: 1 });
    });

    it('reconciliation does not affect blocks owned by other tables', () => {
      registry.setOwner('other-block', { tableId: 'table-B', row: 0, col: 0 });

      const model = new TableModel(makeData({
        content: [[cell('b1')]],
      }));

      registry.reconcileWithModel('table-A', model);

      // Other table's blocks are untouched
      expect(registry.getOwner('other-block')).toEqual({ tableId: 'table-B', row: 0, col: 0 });
      // Reconciled table's block is present
      expect(registry.getOwner('b1')).toEqual({ tableId: 'table-A', row: 0, col: 0 });
    });

    it('reconciliation with empty model clears all blocks for that table', () => {
      registry.setOwner('b1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('b2', { tableId: 'table-A', row: 0, col: 1 });

      const model = new TableModel(makeData({ content: [] }));

      registry.reconcileWithModel('table-A', model);

      expect(registry.getBlocksForTable('table-A')).toEqual([]);
    });

    it('reconciliation after structural operations produces correct state', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
          [cell('b3'), cell('b4')],
        ],
      }));

      registry.reconcileWithModel('table-A', model);

      // Perform structural operations on model
      model.addRow(1);
      model.addBlockToCell(1, 0, 'b5');
      model.addBlockToCell(1, 1, 'b6');
      model.addColumn(0);
      model.addBlockToCell(0, 0, 'b7');
      model.addBlockToCell(1, 0, 'b8');
      model.addBlockToCell(2, 0, 'b9');

      // Reconcile after operations
      registry.reconcileWithModel('table-A', model);

      // Verify every block position matches model
      const snapshot = model.snapshot();

      for (let r = 0; r < snapshot.content.length; r++) {
        for (let c = 0; c < snapshot.content[r].length; c++) {
          const cellContent = snapshot.content[r][c] as CellContent;

          for (const blockId of cellContent.blocks) {
            const owner = registry.getOwner(blockId);

            expect(owner).toEqual({ tableId: 'table-A', row: r, col: c });
          }
        }
      }
    });
  });

  describe('removeTable', () => {
    it('removes all blocks owned by a specific table', () => {
      registry.setOwner('b1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('b2', { tableId: 'table-A', row: 0, col: 1 });
      registry.setOwner('b3', { tableId: 'table-B', row: 0, col: 0 });

      registry.removeTable('table-A');

      expect(registry.getOwner('b1')).toBeNull();
      expect(registry.getOwner('b2')).toBeNull();
      expect(registry.getOwner('b3')).toEqual({ tableId: 'table-B', row: 0, col: 0 });
    });

    it('does not throw when removing unknown table', () => {
      expect(() => registry.removeTable('unknown')).not.toThrow();
    });
  });
});
