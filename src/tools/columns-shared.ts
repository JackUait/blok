import type { API } from '../../types';

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
  const walk = (parentId: string | null, visited: Set<string>): boolean => {
    if (parentId === null || visited.has(parentId)) {
      return false;
    }

    const node = lookup(parentId);

    if (node === undefined) {
      return false;
    }

    if (node.name === COLUMN_TOOL) {
      return true;
    }

    visited.add(parentId);

    return walk(node.parentId, visited);
  };

  return walk(lookup(blockId)?.parentId ?? null, new Set<string>());
};

/**
 * If a column_list has collapsed to a single column, dissolve it:
 * promote the surviving column's child blocks to root level and delete
 * both the column and the column_list.
 *
 * `api.blocks.delete` is index-based and async, so ids are resolved to
 * indices on demand; the column is deleted before the list, and the list's
 * index is re-read afterwards because the earlier delete shifts positions.
 *
 * Returns true when an unwrap occurred.
 */
export const unwrapColumnListIfCollapsed = async (
  api: API,
  columnListId: string,
  excludeId?: string
): Promise<boolean> => {
  const allColumns = api.blocks.getChildren(columnListId);
  const columns = excludeId !== undefined
    ? allColumns.filter(c => c.id !== excludeId)
    : allColumns;

  if (columns.length !== 1) {
    return false;
  }

  const [survivingColumn] = columns;
  const survivingBlocks = api.blocks.getChildren(survivingColumn.id);

  for (const child of survivingBlocks) {
    api.blocks.setBlockParent(child.id, null);
  }

  // Detach the surviving column from cl before deleting it so that its
  // removed() hook does not trigger a recursive unwrap call.
  api.blocks.setBlockParent(survivingColumn.id, null);

  const columnIndex = api.blocks.getBlockIndex(survivingColumn.id);

  if (columnIndex !== undefined) {
    await api.blocks.delete(columnIndex);
  }

  const listIndex = api.blocks.getBlockIndex(columnListId);

  if (listIndex !== undefined) {
    await api.blocks.delete(listIndex);
  }

  return true;
};
