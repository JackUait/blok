import { nanoid } from 'nanoid';
import type { CellContent } from './types';

const TABLE_ID_LENGTH = 10;

/**
 * Mint a row or column id. Random, never positional: peers mint without
 * coordinating.
 */
export const generateTableId = (): string => nanoid(TABLE_ID_LENGTH);

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * The row and column ids a cell carries, for code that rebuilds cells field by
 * field and would otherwise drop them.
 */
export const pickTableIds = (cell: CellContent): Pick<CellContent, 'id' | 'rowId'> => ({
  ...(isId(cell.id) ? { id: cell.id } : {}),
  ...(isId(cell.rowId) ? { rowId: cell.rowId } : {}),
});

/**
 * Pick one id per slot: the first valid id a slot already carries that no
 * earlier slot took, else a fresh one. First occurrence wins, so every peer
 * repairs a duplicated row or column the same way.
 */
const resolveIds = (candidates: (string | undefined)[][]): string[] => {
  const used = new Set<string>();

  return candidates.map(slot => {
    const id = slot.find(candidate => isId(candidate) && !used.has(candidate)) ?? generateTableId();

    used.add(id);

    return id;
  });
};

const columnIdsOf = (row: CellContent[]): string[] | null => {
  const ids = row.map(cell => cell.id);

  return ids.every(isId) && new Set(ids).size === ids.length ? ids : null;
};

/**
 * The grid with every row laid out in the column order of its widest row.
 * A row that missed a concurrent column insert arrives one cell short; padding
 * it at the end would slide its cells one column to the right. Only rows whose
 * column ids are all known to the widest row are touched; the rest stay
 * positional.
 */
export const alignRowsToColumns = (grid: CellContent[][]): CellContent[][] => {
  const canonical = grid
    .map(columnIdsOf)
    .reduce<string[] | null>((widest, ids) => (ids !== null && ids.length > (widest?.length ?? 0) ? ids : widest), null);

  if (canonical === null) {
    return grid;
  }

  const known = new Set(canonical);

  return grid.map(row => {
    const ids = columnIdsOf(row);

    const aligned = ids !== null && ids.length === canonical.length && ids.every((id, index) => id === canonical[index]);

    if (ids === null || aligned || !ids.every(id => known.has(id))) {
      return row;
    }

    const byId = new Map(row.map(cell => [cell.id, cell]));
    const rowId = row[0]?.rowId;

    return canonical.map(id => byId.get(id) ?? { blocks: [], id, ...(rowId === undefined ? {} : { rowId }) });
  });
};

/**
 * The grid with a stable id on every row and column: each cell carries its
 * column's id as `id` and its row's id as `rowId`. Missing ids are minted; an
 * id an earlier row or column already uses is replaced.
 */
export const ensureTableIds = (grid: CellContent[][]): CellContent[][] => {
  const cols = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const columnIds = resolveIds(
    Array.from({ length: cols }, (_, col) => grid.map(row => row[col]?.id))
  );
  const rowIds = resolveIds(grid.map(row => row.map(cell => cell.rowId)));

  return grid.map((row, rowIndex) =>
    row.map((cell, col) => ({ ...cell, id: columnIds[col], rowId: rowIds[rowIndex] }))
  );
};
