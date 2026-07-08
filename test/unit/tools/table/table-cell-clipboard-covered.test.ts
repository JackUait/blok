import { describe, it, expect } from 'vitest';
import { serializeCellsToClipboard } from '../../../../src/tools/table/table-cell-clipboard';

/**
 * Regression for M6: a merge-covered position inside a copied range has no
 * physical cell entry, so it was serialized as an indistinguishable empty cell
 * ({blocks:[]}). On paste that wiped the destination cell. Covered positions
 * must be flagged so paste can skip them instead of clearing content.
 */
describe('serializeCellsToClipboard marks merge-covered positions', () => {
  it('flags positions with no entry as covered', () => {
    // 2x2 range where (0,1) is covered by a merge originating at (0,0):
    // collectCellsInRange yields only the 3 physical cells.
    const payload = serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [] },
      { row: 1, col: 0, blocks: [] },
      { row: 1, col: 1, blocks: [] },
    ]);

    expect(payload.rows).toBe(2);
    expect(payload.cols).toBe(2);
    expect(payload.cells[0][1].covered).toBe(true);
    // Real cells must NOT be flagged covered.
    expect(payload.cells[0][0].covered).toBeUndefined();
    expect(payload.cells[1][1].covered).toBeUndefined();
  });

  it('does not flag any cell covered for a full rectangular selection', () => {
    const payload = serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [] },
      { row: 0, col: 1, blocks: [] },
      { row: 1, col: 0, blocks: [] },
      { row: 1, col: 1, blocks: [] },
    ]);

    payload.cells.flat().forEach(cell => {
      expect(cell.covered).toBeUndefined();
    });
  });
});

/**
 * Regression: copying a merged region carried `covered` flags but dropped the
 * origin's colspan/rowspan, so paste flattened the merge into a plain grid.
 * The clipboard payload must record spans on origin cells so paste can
 * reconstruct the merge.
 */
describe('serializeCellsToClipboard records merge spans', () => {
  it('stamps colspan/rowspan on origin cells and flags their footprint covered', () => {
    // 2x3 range: origin at (0,0) spans 2x2, plus a normal third column.
    const payload = serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [], colspan: 2, rowspan: 2 },
      { row: 0, col: 2, blocks: [] },
      { row: 1, col: 2, blocks: [] },
    ]);

    expect(payload.rows).toBe(2);
    expect(payload.cols).toBe(3);
    expect(payload.cells[0][0].colspan).toBe(2);
    expect(payload.cells[0][0].rowspan).toBe(2);
    expect(payload.cells[0][1].covered).toBe(true);
    expect(payload.cells[1][0].covered).toBe(true);
    expect(payload.cells[1][1].covered).toBe(true);
    expect(payload.cells[0][2].covered).toBeUndefined();
  });

  it('expands payload extents when a span reaches past the last physical entry', () => {
    // A fully merged 2x2 selection yields a single physical cell entry.
    const payload = serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [], colspan: 2, rowspan: 2 },
    ]);

    expect(payload.rows).toBe(2);
    expect(payload.cols).toBe(2);
    expect(payload.cells[0][0].colspan).toBe(2);
    expect(payload.cells[0][0].rowspan).toBe(2);
    expect(payload.cells[1][1].covered).toBe(true);
  });

  it('does not stamp spans on unmerged cells', () => {
    const payload = serializeCellsToClipboard([
      { row: 0, col: 0, blocks: [] },
      { row: 0, col: 1, blocks: [], colspan: 1, rowspan: 1 },
    ]);

    expect(payload.cells[0][0].colspan).toBeUndefined();
    expect(payload.cells[0][0].rowspan).toBeUndefined();
    expect(payload.cells[0][1].colspan).toBeUndefined();
    expect(payload.cells[0][1].rowspan).toBeUndefined();
  });
});
