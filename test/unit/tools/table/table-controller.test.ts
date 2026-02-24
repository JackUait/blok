import { describe, it, expect, beforeEach } from 'vitest';
import { TableController } from '../../../../src/tools/table/core/table-controller';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableCommand } from '../../../../src/tools/table/core/table-commands';
import type { TableDomainEvent } from '../../../../src/tools/table/core/table-events';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

// ─── Helpers ───────────────────────────────────────────────────────

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

const make2x2Model = (): TableModel =>
  new TableModel(makeData({
    content: [
      [cell('a1'), cell('a2')],
      [cell('b1'), cell('b2')],
    ],
  }));

// ─── Tests ─────────────────────────────────────────────────────────

describe('TableController', () => {
  let model: TableModel;
  let controller: TableController;
  let emittedEvents: TableDomainEvent[];

  beforeEach(() => {
    model = make2x2Model();
    emittedEvents = [];
    controller = new TableController(model, (event) => {
      emittedEvents.push(event);
    });
  });

  describe('execute routing', () => {
    it('routes insert-row command to model.addRow', () => {
      const cmd: TableCommand = { type: 'insert-row', index: 1 };

      controller.execute(cmd);

      expect(model.rows).toBe(3);
      model.validateInvariants();
    });

    it('routes delete-row command to model.deleteRow', () => {
      const cmd: TableCommand = { type: 'delete-row', index: 0 };

      controller.execute(cmd);

      expect(model.rows).toBe(1);
      model.validateInvariants();
    });

    it('routes move-row command to model.moveRow', () => {
      const cmd: TableCommand = { type: 'move-row', fromIndex: 0, toIndex: 1 };

      controller.execute(cmd);

      // After moving row 0 to row 1, the blocks from original row 0 should be at row 1
      expect(model.findCellForBlock('a1')).toEqual({ row: 1, col: 0 });
      expect(model.findCellForBlock('b1')).toEqual({ row: 0, col: 0 });
      model.validateInvariants();
    });

    it('routes insert-column command to model.addColumn', () => {
      const cmd: TableCommand = { type: 'insert-column', index: 1 };

      controller.execute(cmd);

      expect(model.cols).toBe(3);
      model.validateInvariants();
    });

    it('routes insert-column with width', () => {
      model.setColWidths([100, 200]);

      const cmd: TableCommand = { type: 'insert-column', index: 1, width: 50 };

      controller.execute(cmd);

      expect(model.cols).toBe(3);
      expect(model.colWidths).toEqual([100, 50, 200]);
      model.validateInvariants();
    });

    it('routes delete-column command to model.deleteColumn', () => {
      const cmd: TableCommand = { type: 'delete-column', index: 0 };

      controller.execute(cmd);

      expect(model.cols).toBe(1);
      model.validateInvariants();
    });

    it('routes move-column command to model.moveColumn', () => {
      const cmd: TableCommand = { type: 'move-column', fromIndex: 0, toIndex: 1 };

      controller.execute(cmd);

      expect(model.findCellForBlock('a1')).toEqual({ row: 0, col: 1 });
      expect(model.findCellForBlock('a2')).toEqual({ row: 0, col: 0 });
      model.validateInvariants();
    });

    it('routes toggle-heading command', () => {
      const cmd: TableCommand = { type: 'toggle-heading' };

      controller.execute(cmd);

      expect(model.withHeadings).toBe(true);
    });

    it('routes toggle-heading toggles off when already on', () => {
      model.setWithHeadings(true);

      controller.execute({ type: 'toggle-heading' });

      expect(model.withHeadings).toBe(false);
    });

    it('routes toggle-heading-column command', () => {
      const cmd: TableCommand = { type: 'toggle-heading-column' };

      controller.execute(cmd);

      expect(model.withHeadingColumn).toBe(true);
    });

    it('routes set-stretched command', () => {
      const cmd: TableCommand = { type: 'set-stretched', value: true };

      controller.execute(cmd);

      expect(model.stretched).toBe(true);
    });

    it('routes add-block-to-cell command', () => {
      const cmd: TableCommand = { type: 'add-block-to-cell', row: 0, col: 0, blockId: 'new-block' };

      controller.execute(cmd);

      expect(model.getCellBlocks(0, 0)).toContain('new-block');
      model.validateInvariants();
    });

    it('routes remove-block-from-cell command', () => {
      const cmd: TableCommand = { type: 'remove-block-from-cell', row: 0, col: 0, blockId: 'a1' };

      controller.execute(cmd);

      expect(model.getCellBlocks(0, 0)).not.toContain('a1');
      model.validateInvariants();
    });

    it('routes set-cell-blocks command', () => {
      const cmd: TableCommand = { type: 'set-cell-blocks', row: 0, col: 0, blockIds: ['x', 'y'] };

      controller.execute(cmd);

      expect(model.getCellBlocks(0, 0)).toEqual(['x', 'y']);
      model.validateInvariants();
    });

    it('routes set-col-widths command', () => {
      const cmd: TableCommand = { type: 'set-col-widths', widths: [100, 200] };

      controller.execute(cmd);

      expect(model.colWidths).toEqual([100, 200]);
    });

    it('routes set-col-widths with undefined clears widths', () => {
      model.setColWidths([100, 200]);

      controller.execute({ type: 'set-col-widths', widths: undefined });

      expect(model.colWidths).toBeUndefined();
    });

    it('routes replace-all command', () => {
      const newData = makeData({
        content: [[cell('z1')]],
        withHeadings: true,
      });
      const cmd: TableCommand = { type: 'replace-all', data: newData };

      controller.execute(cmd);

      expect(model.rows).toBe(1);
      expect(model.cols).toBe(1);
      expect(model.withHeadings).toBe(true);
      model.validateInvariants();
    });
  });

  describe('event emission', () => {
    it('emits row-inserted event after insert-row', () => {
      controller.execute({ type: 'insert-row', index: 1 });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'row-inserted',
        index: 1,
        cellsToPopulate: 2,
      });
    });

    it('emits row-deleted event with blocks to delete', () => {
      controller.execute({ type: 'delete-row', index: 0 });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        type: 'row-deleted',
        index: 0,
        blocksToDelete: ['a1', 'a2'],
      });
    });

    it('emits row-moved event', () => {
      controller.execute({ type: 'move-row', fromIndex: 0, toIndex: 1 });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'row-moved',
        fromIndex: 0,
        toIndex: 1,
      });
    });

    it('emits column-inserted event with cells to populate', () => {
      controller.execute({ type: 'insert-column', index: 1 });

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];

      expect(event.type).toBe('column-inserted');

      if (event.type === 'column-inserted') {
        expect(event.index).toBe(1);
        expect(event.cellsToPopulate).toEqual([
          { row: 0, col: 1 },
          { row: 1, col: 1 },
        ]);
      }
    });

    it('emits column-deleted event with blocks to delete', () => {
      controller.execute({ type: 'delete-column', index: 0 });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        type: 'column-deleted',
        index: 0,
        blocksToDelete: ['a1', 'b1'],
      });
    });

    it('emits column-moved event', () => {
      controller.execute({ type: 'move-column', fromIndex: 0, toIndex: 1 });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'column-moved',
        fromIndex: 0,
        toIndex: 1,
      });
    });

    it('emits heading-toggled event with new value', () => {
      controller.execute({ type: 'toggle-heading' });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'heading-toggled',
        withHeadings: true,
      });
    });

    it('emits heading-column-toggled event', () => {
      controller.execute({ type: 'toggle-heading-column' });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'heading-column-toggled',
        withHeadingColumn: true,
      });
    });

    it('emits stretched-changed event', () => {
      controller.execute({ type: 'set-stretched', value: true });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'stretched-changed',
        stretched: true,
      });
    });

    it('emits block-added-to-cell event', () => {
      controller.execute({ type: 'add-block-to-cell', row: 0, col: 1, blockId: 'new' });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'block-added-to-cell',
        row: 0,
        col: 1,
        blockId: 'new',
      });
    });

    it('emits block-removed-from-cell event', () => {
      controller.execute({ type: 'remove-block-from-cell', row: 0, col: 0, blockId: 'a1' });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'block-removed-from-cell',
        row: 0,
        col: 0,
        blockId: 'a1',
      });
    });

    it('emits cell-blocks-set event', () => {
      controller.execute({ type: 'set-cell-blocks', row: 1, col: 1, blockIds: ['x'] });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'cell-blocks-set',
        row: 1,
        col: 1,
        blockIds: ['x'],
      });
    });

    it('emits col-widths-changed event', () => {
      controller.execute({ type: 'set-col-widths', widths: [150, 250] });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({
        type: 'col-widths-changed',
        widths: [150, 250],
      });
    });

    it('emits model-replaced event', () => {
      controller.execute({
        type: 'replace-all',
        data: makeData({ content: [[cell('z')]] }),
      });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toEqual({ type: 'model-replaced' });
    });
  });

  describe('precondition handling', () => {
    it('does not crash on delete-row with out-of-bounds index', () => {
      const snap = model.snapshot();

      controller.execute({ type: 'delete-row', index: 99 });

      // Model should be unchanged
      expect(model.rows).toBe(snap.content.length);
      model.validateInvariants();
    });

    it('does not crash on delete-column with out-of-bounds index', () => {
      const snap = model.snapshot();

      controller.execute({ type: 'delete-column', index: 99 });

      expect(model.cols).toBe(snap.content[0].length);
      model.validateInvariants();
    });

    it('does not crash on move-row with same index', () => {
      controller.execute({ type: 'move-row', fromIndex: 0, toIndex: 0 });

      expect(model.rows).toBe(2);
      model.validateInvariants();
    });

    it('does not crash on move-column with same index', () => {
      controller.execute({ type: 'move-column', fromIndex: 1, toIndex: 1 });

      expect(model.cols).toBe(2);
      model.validateInvariants();
    });
  });

  describe('invariant preservation', () => {
    it('model invariants hold after every command type', () => {
      const commands: TableCommand[] = [
        { type: 'insert-row', index: 1 },
        { type: 'insert-column', index: 0 },
        { type: 'add-block-to-cell', row: 1, col: 0, blockId: 'x1' },
        { type: 'move-row', fromIndex: 0, toIndex: 2 },
        { type: 'move-column', fromIndex: 0, toIndex: 2 },
        { type: 'remove-block-from-cell', row: 2, col: 2, blockId: 'x1' },
        { type: 'set-cell-blocks', row: 0, col: 0, blockIds: ['y1', 'y2'] },
        { type: 'toggle-heading' },
        { type: 'toggle-heading-column' },
        { type: 'set-stretched', value: true },
        { type: 'delete-row', index: 0 },
        { type: 'delete-column', index: 0 },
      ];

      for (const cmd of commands) {
        controller.execute(cmd);
        model.validateInvariants();
      }
    });

    it('events emitted match the number of commands executed', () => {
      controller.execute({ type: 'insert-row', index: 0 });
      controller.execute({ type: 'delete-column', index: 1 });
      controller.execute({ type: 'toggle-heading' });

      expect(emittedEvents).toHaveLength(3);
    });
  });

  describe('listener management', () => {
    it('works without a listener', () => {
      const noListenerController = new TableController(model);

      expect(() => {
        noListenerController.execute({ type: 'insert-row', index: 0 });
      }).not.toThrow();

      expect(model.rows).toBe(3);
    });
  });
});
