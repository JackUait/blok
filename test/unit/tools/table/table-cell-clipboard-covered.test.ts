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
