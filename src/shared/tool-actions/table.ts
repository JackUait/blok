import { mintId } from '../mint-id';
import { alignRowsToColumns, ensureTableIdsWith } from '../table/table-ids';
import { isCellWithBlocks } from '../table/types';

import type { CellContent } from '../table/types';

const isObjectRow = (row: unknown): row is CellContent[] =>
  Array.isArray(row) && row.every(isCellWithBlocks);

export const normalizeTable = (
  data: Record<string, unknown>,
  mint: () => string = () => mintId(10),
): Record<string, unknown> => {
  if (!Array.isArray(data.content)) {
    return data;
  }

  const rows: unknown[] = data.content;
  const objectRows = rows.filter(isObjectRow);
  const aligned = alignRowsToColumns(objectRows).map((row, index) => {
    const originals = new Set(objectRows[index]);
    // Only leading and interior gaps may be filled.
    const end = row.reduce((last, cell, column) => originals.has(cell) ? column + 1 : last, 0);

    return row.slice(0, end);
  });
  const fixed = ensureTableIdsWith(aligned, mint).values();

  return { ...data, content: rows.map(row => (isObjectRow(row) ? fixed.next().value ?? row : row)) };
};
