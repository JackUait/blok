/**
 * The merge fields of one table cell. Both the editor model and the view
 * renderers repair through {@link repairMergeGrid}, so a malformed saved
 * table looks the same in the editor, in read-only and in rendered HTML/text.
 */
export interface MergeRepairCell {
  blocks: string[];
  colspan?: number;
  rowspan?: number;
  mergedInto?: [number, number];
}

type Slot = readonly [number, number];

/**
 * The widest, then tallest, rectangle from [r, c] within the requested span
 * whose slots all exist and no earlier origin claims.
 */
const fitSpan = (
  grid: MergeRepairCell[][],
  claims: Array<Array<Slot | undefined>>,
  r: number,
  c: number
): { colspan: number; rowspan: number } => {
  const origin = grid[r][c];
  // Saved data is untrusted: a NaN or huge span must not size an array.
  const clamp = (span: number | undefined, room: number): number =>
    Number.isInteger(span) && span !== undefined && span > 1 ? Math.min(span, room) : 1;
  const wanted = { colspan: clamp(origin.colspan, grid[r].length - c), rowspan: clamp(origin.rowspan, grid.length - r) };
  const isFree = (row: number, col: number): boolean =>
    grid[row]?.[col] !== undefined && claims[row][col] === undefined;

  const colspan = Array.from({ length: wanted.colspan - 1 }, (_, i) => c + 1 + i)
    .findIndex(col => !isFree(r, col));
  const width = colspan === -1 ? wanted.colspan : colspan + 1;
  const rowspan = Array.from({ length: wanted.rowspan - 1 }, (_, i) => r + 1 + i)
    .findIndex(row => !Array.from({ length: width }, (__, i) => c + i).every(col => isFree(row, col)));
  const height = rowspan === -1 ? wanted.rowspan : rowspan + 1;

  return { colspan: width, rowspan: height };
};

/**
 * Repair merge bookkeeping a concurrent edit or a foreign paste can leave
 * inconsistent. Returns a new grid; the input is not changed.
 *
 * The result is a pure function of the input in row-major order, so every
 * peer computes the same table without exchanging anything:
 * - a cell carrying `mergedInto` is never also an origin (the cover wins);
 * - an origin's span is clamped to the grid and to slots no earlier origin
 *   claims — two merges never share a slot;
 * - every other slot inside a live span is covered by it, and any blocks it
 *   held move to that origin (a covered cell has no <td> to mount them in);
 * - a `mergedInto` no live span backs is dropped, and the cell keeps its blocks.
 * @param grid - rows of cells; rows may be ragged
 */
export const repairMergeGrid = <T extends MergeRepairCell>(grid: T[][]): T[][] => {
  const out: T[][] = grid.map(row => row.map(cell => ({ ...cell, blocks: [...cell.blocks] })));
  const claims: Array<Array<Slot | undefined>> = out.map(row => row.map(() => undefined));

  // Spans first, all of them, so a later cell sees every earlier claim.
  out.forEach((row, r) => row.forEach((_cell, c) => {
    const cell = out[r][c];
    const isOrigin = cell.mergedInto === undefined && claims[r][c] === undefined;
    const { colspan, rowspan } = isOrigin ? fitSpan(out, claims, r, c) : { colspan: 1, rowspan: 1 };

    delete cell.colspan;
    delete cell.rowspan;

    if (colspan > 1) {
      cell.colspan = colspan;
    }

    if (rowspan > 1) {
      cell.rowspan = rowspan;
    }

    Array.from({ length: rowspan * colspan }, (__, i) => [r + Math.floor(i / colspan), c + (i % colspan)])
      .slice(1)
      .forEach(([dr, dc]) => {
        claims[dr][dc] = [r, c];
      });
  }));

  out.forEach((row, r) => row.forEach((_cell, c) => {
    const cell = out[r][c];
    const claim = claims[r][c];

    if (claim === undefined) {
      delete cell.mergedInto;

      return;
    }

    cell.mergedInto = [claim[0], claim[1]];
    out[claim[0]][claim[1]].blocks.push(...cell.blocks);
    cell.blocks = [];
  }));

  return out;
};
