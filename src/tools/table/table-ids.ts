import { nanoid } from 'nanoid';
import { alignRowsToColumns, ensureTableIdsWith } from '../../shared/table/table-ids';
import type { CellContent, LegacyCellContent } from './types';
import { isCellWithBlocks } from './types';

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

export { alignRowsToColumns };

export const ensureTableIds = (grid: CellContent[][]): CellContent[][] => ensureTableIdsWith(grid, generateTableId);

/** Key of a cell by its row and column ids, as `mergePaddedCells` returns them. */
export const cellKey = (rowId: string, columnId: string): string => `${rowId}:${columnId}`;

/**
 * `rowId:columnId` of the empty cells `grid` has that the stored rows lack: a
 * concurrent add-row and add-column leave the corner in no peer's write, so no
 * author will fill it. A row whose stored cells do not all carry ids is skipped,
 * since its ids were just minted and nothing can be told apart.
 */
export const mergePaddedCells = (stored: unknown, grid: LegacyCellContent[][]): Set<string> => {
  const storedRows = new Map<string, Set<string>>();

  (Array.isArray(stored) ? stored : []).forEach((row: unknown) => {
    const cells: unknown[] = Array.isArray(row) ? row : [];
    const ids = cells.map(cell => (typeof cell === 'object' && cell !== null ? cell as CellContent : null));
    const rowId = ids[0]?.rowId;

    if (isId(rowId) && ids.every(cell => isId(cell?.id) && cell?.rowId === rowId)) {
      storedRows.set(rowId, new Set(ids.map(cell => String(cell?.id))));
    }
  });

  return new Set(grid.flat().filter(isCellWithBlocks).flatMap(cell => {
    const known = isId(cell.rowId) ? storedRows.get(cell.rowId) : undefined;

    return known !== undefined && isId(cell.id) && !known.has(cell.id) && cell.mergedInto === undefined && cell.blocks.length === 0
      ? [cellKey(cell.rowId ?? '', cell.id)]
      : [];
  }));
};
