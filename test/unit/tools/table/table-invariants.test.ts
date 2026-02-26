import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

describe('TableModel invariants', () => {
  describe('validateInvariants()', () => {
    it('passes for a valid empty model', () => {
      const model = new TableModel(makeData());

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('passes for a valid populated model', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a1'), cell('b1')],
          [cell('a2'), cell('b2')],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('passes for model with colWidths matching column count', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
        ],
        colWidths: [100, 200, 150],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('detects colWidths mismatch when set via setColWidths with wrong length', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
        ],
      }));

      // Force a colWidths mismatch via the public setter
      model.setColWidths([100, 200]);

      expect(() => model.validateInvariants()).toThrow(/colWidths has 2 entries but grid has 3 columns/);
    });

    it('detects colWidths mismatch with too many entries', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
      }));

      model.setColWidths([100, 200, 300, 400]);

      expect(() => model.validateInvariants()).toThrow(/colWidths has 4 entries but grid has 2 columns/);
    });
  });

  describe('invariants hold after individual mutations', () => {
    it('holds after addRow', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
      }));

      model.addRow();
      expect(() => model.validateInvariants()).not.toThrow();

      model.addRow(0);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after deleteRow', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
          [cell('c'), cell('d')],
          [cell('e'), cell('f')],
        ],
      }));

      model.deleteRow(1);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after moveRow', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
          [cell('c'), cell('d')],
          [cell('e'), cell('f')],
        ],
      }));

      model.moveRow(0, 2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after addColumn', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
          [cell('c'), cell('d')],
        ],
      }));

      model.addColumn();
      expect(() => model.validateInvariants()).not.toThrow();

      model.addColumn(0);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after addColumn with colWidths', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
        colWidths: [100, 200],
      }));

      model.addColumn(1, 150);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after deleteColumn', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      model.deleteColumn(1);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after deleteColumn with colWidths', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
        ],
        colWidths: [100, 200, 300],
      }));

      model.deleteColumn(1);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after moveColumn', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      model.moveColumn(0, 2);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after moveColumn with colWidths', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
        ],
        colWidths: [100, 200, 300],
      }));

      model.moveColumn(2, 0);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after addBlockToCell', () => {
      const model = new TableModel(makeData({
        content: [
          [cell(), cell()],
        ],
      }));

      model.addBlockToCell(0, 0, 'block-1');
      expect(() => model.validateInvariants()).not.toThrow();

      model.addBlockToCell(0, 1, 'block-2');
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after removeBlockFromCell', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a', 'b'), cell('c')],
        ],
      }));

      model.removeBlockFromCell(0, 0, 'a');
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after setCellBlocks', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
      }));

      model.setCellBlocks(0, 0, ['x', 'y', 'z']);
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after replaceAll', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
      }));

      model.replaceAll(makeData({
        content: [
          [cell('p'), cell('q'), cell('r')],
          [cell('s'), cell('t'), cell('u')],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('holds after replaceAll with colWidths matching new content', () => {
      const model = new TableModel(makeData());

      model.replaceAll(makeData({
        content: [
          [cell('a'), cell('b'), cell('c')],
          [cell('d'), cell('e'), cell('f')],
        ],
        colWidths: [100, 200, 300],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });
  });

  describe('cross-operation invariants (chained mutations)', () => {
    it('invariants hold after addRow → addColumn → moveRow → deleteColumn → moveColumn → addBlockToCell → removeBlockFromCell → replaceAll', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a1'), cell('b1')],
          [cell('a2'), cell('b2')],
        ],
      }));

      // addRow at end
      model.addRow();
      expect(() => model.validateInvariants()).not.toThrow();
      expect(model.rows).toBe(3);

      // addColumn at index 1
      model.addColumn(1);
      expect(() => model.validateInvariants()).not.toThrow();
      expect(model.cols).toBe(3);

      // moveRow 0 → 2
      model.moveRow(0, 2);
      expect(() => model.validateInvariants()).not.toThrow();

      // deleteColumn 0
      model.deleteColumn(0);
      expect(() => model.validateInvariants()).not.toThrow();
      expect(model.cols).toBe(2);

      // moveColumn 0 → 1
      model.moveColumn(0, 1);
      expect(() => model.validateInvariants()).not.toThrow();

      // addBlockToCell
      model.addBlockToCell(0, 0, 'new-block-1');
      expect(() => model.validateInvariants()).not.toThrow();

      // removeBlockFromCell
      model.removeBlockFromCell(0, 0, 'new-block-1');
      expect(() => model.validateInvariants()).not.toThrow();

      // replaceAll
      model.replaceAll(makeData({
        content: [
          [cell('final-a'), cell('final-b')],
        ],
      }));
      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('invariants hold after alternating row and column additions and deletions', () => {
      const model = new TableModel(makeData({
        content: [[cell('start')]],
      }));

      model.addColumn();
      expect(() => model.validateInvariants()).not.toThrow();

      model.addRow();
      expect(() => model.validateInvariants()).not.toThrow();

      model.addColumn(0);
      expect(() => model.validateInvariants()).not.toThrow();

      model.addRow(0);
      expect(() => model.validateInvariants()).not.toThrow();

      model.deleteRow(1);
      expect(() => model.validateInvariants()).not.toThrow();

      model.deleteColumn(2);
      expect(() => model.validateInvariants()).not.toThrow();

      // Should still be rectangular
      expect(model.rows).toBeGreaterThan(0);
      expect(model.cols).toBeGreaterThan(0);
    });

    it('invariants hold after moving a block between cells via addBlockToCell', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('blockX'), cell()],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();

      // addBlockToCell should remove from old cell if the block already exists somewhere
      model.addBlockToCell(0, 1, 'blockX');
      expect(() => model.validateInvariants()).not.toThrow();

      // Block should only be in cell [0,1] now
      expect(model.getCellBlocks(0, 0)).toEqual([]);
      expect(model.getCellBlocks(0, 1)).toEqual(['blockX']);
    });

    it('invariants hold with colWidths through add and delete column sequence', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
        ],
        colWidths: [100, 200],
      }));

      expect(() => model.validateInvariants()).not.toThrow();

      model.addColumn(1, 150);
      expect(() => model.validateInvariants()).not.toThrow();

      model.addColumn(undefined, 250);
      expect(() => model.validateInvariants()).not.toThrow();

      model.deleteColumn(0);
      expect(() => model.validateInvariants()).not.toThrow();

      model.moveColumn(0, 2);
      expect(() => model.validateInvariants()).not.toThrow();
    });
  });
});
