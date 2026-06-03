export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';
export const COLUMN_ATTR = 'data-blok-column';

/**
 * Minimal block view the helpers need — kept structural so callers can pass
 * either real Blocks or test fakes.
 */
export interface BlockNode {
  name: string;
  parentId: string | null;
}

/**
 * Walk the parentId chain from `blockId` upward; return true if any ancestor
 * is a `column` block. Cycle-safe via a visited set.
 *
 * Used to reject placing a column_list inside a column (no nested columns).
 */
export const isInsideColumn = (
  blockId: string,
  lookup: (id: string) => BlockNode | undefined
): boolean => {
  const visited = new Set<string>();
  let current = lookup(blockId)?.parentId ?? null;

  while (current !== null && !visited.has(current)) {
    visited.add(current);

    const node = lookup(current);

    if (node === undefined) {
      return false;
    }

    if (node.name === COLUMN_TOOL) {
      return true;
    }

    current = node.parentId;
  }

  return false;
};
