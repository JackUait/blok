/**
 * Characterization tests for TableController.
 *
 * These pin the controller's command → (model mutation + emitted domain event)
 * contract through realistic command *sequences* and joint model+event
 * assertions, complementing the per-command routing tests in
 * table-controller.test.ts. They describe current behavior and are verified to
 * hold identically on the pre-refactor baseline (commit 9d58c1f6^), so they
 * characterize behavior that the TableSubsystems refactor did not change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TableController } from '../../../../src/tools/table/core/table-controller';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableDomainEvent } from '../../../../src/tools/table/core/table-events';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

const make2x2 = (): TableModel =>
  new TableModel(makeData({
    content: [
      [cell('a1'), cell('a2')],
      [cell('b1'), cell('b2')],
    ],
  }));

const wire = (model: TableModel): { controller: TableController; events: TableDomainEvent[] } => {
  const events: TableDomainEvent[] = [];
  const controller = new TableController(model, (event) => events.push(event));

  return { controller, events };
};

describe('TableController characterization', () => {
  let model: TableModel;
  let controller: TableController;
  let events: TableDomainEvent[];

  beforeEach(() => {
    model = make2x2();
    ({ controller, events } = wire(model));
  });

  describe('structural symmetry', () => {
    it('insert-row then delete-row at the same index restores dimensions', () => {
      controller.execute({ type: 'insert-row', index: 1 });
      expect(model.rows).toBe(3);

      controller.execute({ type: 'delete-row', index: 1 });
      expect(model.rows).toBe(2);

      expect(events.map(e => e.type)).toEqual(['row-inserted', 'row-deleted']);
      model.validateInvariants();
    });

    it('move-row round-trip restores the original content order', () => {
      const before = JSON.stringify(model.snapshot().content);

      controller.execute({ type: 'move-row', fromIndex: 0, toIndex: 1 });
      controller.execute({ type: 'move-row', fromIndex: 1, toIndex: 0 });

      expect(JSON.stringify(model.snapshot().content)).toBe(before);
      expect(events.map(e => e.type)).toEqual(['row-moved', 'row-moved']);
    });

    it('insert-column grows cols and colWidths together and emits cellsToPopulate', () => {
      controller.execute({ type: 'insert-column', index: 1, width: 120 });

      expect(model.cols).toBe(3);

      const ev = events[0];

      expect(ev.type).toBe('column-inserted');

      if (ev.type === 'column-inserted') {
        expect(ev.index).toBe(1);
        expect(Array.isArray(ev.cellsToPopulate)).toBe(true);
      }
      model.validateInvariants();
    });
  });

  describe('merge then split', () => {
    it('merges a 2x2 region and reports the merged cell, then split reverses it', () => {
      controller.execute({ type: 'merge-cells', minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 2 });
      // isMergedCell is true only for the merge origin; absorbed cells report via isSpannedCell.
      expect(model.isMergedCell(0, 0)).toBe(true);
      expect(model.isMergedCell(1, 1)).toBe(false);

      const mergeEvent = events[0];

      expect(mergeEvent.type).toBe('cells-merged');

      if (mergeEvent.type === 'cells-merged') {
        expect(Array.isArray(mergeEvent.blocksToRelocate)).toBe(true);
      }

      controller.execute({ type: 'split-cell', row: 0, col: 0 });

      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
      expect(events.map(e => e.type)).toEqual(['cells-merged', 'cell-split']);
      model.validateInvariants();
    });
  });

  describe('metadata toggles', () => {
    it('toggle-heading flips the flag and emits the new value; toggling twice is a no-op', () => {
      expect(model.withHeadings).toBe(false);

      controller.execute({ type: 'toggle-heading' });
      expect(model.withHeadings).toBe(true);

      controller.execute({ type: 'toggle-heading' });
      expect(model.withHeadings).toBe(false);

      expect(events.map(e => e.type)).toEqual(['heading-toggled', 'heading-toggled']);
      const first = events[0];

      if (first.type === 'heading-toggled') {
        expect(first.withHeadings).toBe(true);
      }
    });

    it('set-stretched updates the model and emits the value', () => {
      controller.execute({ type: 'set-stretched', value: true });

      expect(model.stretched).toBe(true);

      const ev = events[0];

      expect(ev.type).toBe('stretched-changed');

      if (ev.type === 'stretched-changed') {
        expect(ev.stretched).toBe(true);
      }
    });

    it('set-col-widths stores the widths and echoes them in the event', () => {
      controller.execute({ type: 'set-col-widths', widths: [100, 200] });

      expect(model.colWidths).toEqual([100, 200]);

      const ev = events[0];

      expect(ev.type).toBe('col-widths-changed');

      if (ev.type === 'col-widths-changed') {
        expect(ev.widths).toEqual([100, 200]);
      }
    });
  });

  describe('cell block bookkeeping', () => {
    it('set-cell-blocks makes the block findable at that cell', () => {
      controller.execute({ type: 'set-cell-blocks', row: 0, col: 1, blockIds: ['new-block'] });

      expect(model.findCellForBlock('new-block')).toEqual({ row: 0, col: 1 });

      const ev = events[0];

      expect(ev.type).toBe('cell-blocks-set');

      if (ev.type === 'cell-blocks-set') {
        expect(ev.blockIds).toEqual(['new-block']);
      }
    });

    it('replace-all swaps the whole model and emits model-replaced', () => {
      controller.execute({
        type: 'replace-all',
        data: makeData({ withHeadings: true, content: [[cell('x')]] }),
      });

      expect(model.rows).toBe(1);
      expect(model.cols).toBe(1);
      expect(model.withHeadings).toBe(true);
      expect(model.findCellForBlock('x')).toEqual({ row: 0, col: 0 });
      expect(events[0]?.type).toBe('model-replaced');
    });
  });
});
