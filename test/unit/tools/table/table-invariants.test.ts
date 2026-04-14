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

// ─── Merge helpers ──────────────────────────────────────────────────
const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
  blocks,
  ...(colspan > 1 ? { colspan } : {}),
  ...(rowspan > 1 ? { rowspan } : {}),
});

const coveredCell = (originRow: number, originCol: number): CellContent => ({
  blocks: [],
  mergedInto: [originRow, originCol],
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

  describe('merge invariants', () => {
    it('passes for a valid 2x2 merge', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b', 'c', 'd'], 2, 2), coveredCell(0, 0), cell('e')],
          [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
          [cell('g'), cell('h'), cell('i')],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('passes for a valid horizontal merge', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b', 'c'], 3, 1), coveredCell(0, 0), coveredCell(0, 0)],
          [cell('d'), cell('e'), cell('f')],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();
    });

    it('detects mergedInto pointing to cell without matching span', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), cell('b')],
          [coveredCell(0, 0), cell('d')],
        ],
      }));

      expect(() => model.validateInvariants()).toThrow(/mergedInto.*\[1,0\].*\[0,0\].*not a merge origin/);
    });

    it('detects mergedInto pointing out of bounds', () => {
      const model = new TableModel(makeData({
        content: [
          [cell('a'), { blocks: [], mergedInto: [5, 5] as [number, number] }],
        ],
      }));

      expect(() => model.validateInvariants()).toThrow(/mergedInto.*out.of.bounds/i);
    });

    it('detects mergedInto outside the span of its claimed origin', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a', 'b'], 2, 1), coveredCell(0, 0)],
          [coveredCell(0, 0), cell('d')],
        ],
      }));

      expect(() => model.validateInvariants()).toThrow(/mergedInto.*\[1,0\].*outside the span/);
    });

    it('detects missing mergedInto on cell within an origin span', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 2, 2), coveredCell(0, 0)],
          [coveredCell(0, 0), cell('d')], // [1,1] should have mergedInto but doesn't
        ],
      }));

      expect(() => model.validateInvariants()).toThrow(/\[1,1\].*within span.*\[0,0\].*no mergedInto/);
    });

    it('detects origin cell whose span extends beyond grid bounds', () => {
      const model = new TableModel(makeData({
        content: [
          [originCell(['a'], 3, 1), coveredCell(0, 0)], // colspan=3 but only 2 cols
        ],
      }));

      expect(() => model.validateInvariants()).toThrow(/span.*extends beyond grid bounds/);
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

    it('invariants hold across a randomized fuzz sequence over every mutator', () => {
      // Property: every public TableModel mutator must preserve the invariant
      // "no block ID appears in more than one cell". This test runs a seeded
      // pseudo-random sequence of operations and asserts validateInvariants()
      // never throws. The seed makes failures reproducible.
      let seed = 0x12345678;
      const next = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;

        return seed;
      };
      const pick = <T>(arr: T[]): T => arr[next() % arr.length];

      const model = new TableModel(makeData({
        content: [
          [cell('seed-0'), cell('seed-1'), cell('seed-2')],
          [cell('seed-3'), cell('seed-4'), cell('seed-5')],
          [cell('seed-6'), cell('seed-7'), cell('seed-8')],
        ],
      }));

      expect(() => model.validateInvariants()).not.toThrow();

      const runOne = (i: number): void => {
        const op = next() % 10;
        const rows = model.rows;
        const cols = model.cols;

        if (rows === 0 || cols === 0) {
          model.addRow();

          return;
        }

        const r = next() % rows;
        const c = next() % cols;

        switch (op) {
          case 0:
            model.addBlockToCell(r, c, `fuzz-${i}`);
            break;
          case 1: {
            const existing = model.getCellBlocks(r, c);

            if (existing.length > 0) {
              model.removeBlockFromCell(r, c, pick(existing));
            }
            break;
          }
          case 2:
            // Cross-cell reassign using an ID that already lives elsewhere.
            // Uses an id drawn from a neighbouring cell when available.
            {
              const donorRow = (r + 1) % rows;
              const donorCol = (c + 1) % cols;
              const donor = model.getCellBlocks(donorRow, donorCol);
              const ids = donor.length > 0 ? [donor[0]] : [`fuzz-${i}`];

              model.setCellBlocks(r, c, ids);
            }
            break;
          case 3:
            model.addRow(r);
            break;
          case 4:
            if (rows > 1) {
              model.deleteRow(r);
            }
            break;
          case 5:
            model.addColumn(c);
            break;
          case 6:
            if (cols > 1) {
              model.deleteColumn(c);
            }
            break;
          case 7:
            if (rows > 1) {
              model.moveRow(r, (r + 1) % rows);
            }
            break;
          case 8:
            if (cols > 1) {
              model.moveColumn(c, (c + 1) % cols);
            }
            break;
          case 9:
            // Fresh setCellBlocks with a brand-new id; must not corrupt map.
            model.setCellBlocks(r, c, [`fresh-${i}`]);
            break;
          default:
            break;
        }
      };

      for (let i = 0; i < 500; i++) {
        runOne(i);

        try {
          model.validateInvariants();
        } catch (err) {
          throw new Error(`Invariant broke after iteration ${i}: ${(err as Error).message}`);
        }
      }
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
