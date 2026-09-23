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
