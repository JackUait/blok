import type { API } from '../../types';
import {
  COLUMNS_ATTR,
  COLUMN_LIST_TOOL,
  COLUMN_TOOL,
  buildColumnResizers,
  playColumnEnterAnimation,
  resetColumnsToEvenWidth,
} from './columns-shared';

/**
 * Rebuild the resize separators of an already-rendered column_list. The list's
 * rendered() hook fires only once, so adding a column to a live list never
 * re-triggers it — the separators must be rebuilt here or the new column lands
 * without a handle. The columns row is the element carrying COLUMNS_ATTR; reach
 * it from any child column holder.
 */
const rebuildColumnResizers = (api: API, columnListId: string): void => {
  const holders = api.blocks.getChildren(columnListId).map(column => column.holder);
  const container = holders[0]?.closest(`[${COLUMNS_ATTR}]`);

  if (container instanceof HTMLElement) {
    buildColumnResizers(container, holders, api.readOnly.isEnabled);
  }
};

export type ColumnDropSide = 'left' | 'right';

/**
 * Run `fn` as a single undo entry when the host supports transactions, else
 * run it directly. `transact` is optional on the public API, so guard it.
 */
const runTransacted = (api: API, fn: () => void): void => {
  if (api.blocks.transact !== undefined) {
    api.blocks.transact(fn);

    return;
  }

  fn();
};

/**
 * Wrap a top-level `targetId` block and the dragged `sourceIds` into a brand
 * new `column_list` with two columns: one holds the target, the other holds
 * the sources stacked in document order.
 *
 * - side 'left'  -> column order = [sources column, target column]
 * - side 'right' -> column order = [target column, sources column]
 *
 * The target's subtree follows automatically because children track their
 * parent. All work runs in a single undo entry via `transact`.
 *
 * Aborts (returns null, no mutation) when:
 * - sources is empty, or includes the target (self-drop),
 * - the target or any source is stale (no flat index),
 * - the target is already inside a container (use addColumnToList instead).
 */
export const wrapInNewColumnList = (
  api: API,
  targetId: string,
  sourceIds: string[],
  side: ColumnDropSide
): string | null => {
  if (sourceIds.length === 0 || sourceIds.includes(targetId)) {
    return null;
  }

  const targetIndex = api.blocks.getBlockIndex(targetId);

  if (targetIndex === undefined) {
    return null;
  }

  for (const sourceId of sourceIds) {
    if (api.blocks.getBlockIndex(sourceId) === undefined) {
      return null;
    }
  }

  // Wrapping is only for top-level targets; a target with a parent should be
  // dropped beside an existing column via addColumnToList.
  if (api.blocks.getById(targetId)?.parentId !== null) {
    return null;
  }

  const created: { listId: string | null; sourcesColumnId: string | null } = {
    listId: null,
    sourcesColumnId: null,
  };

  runTransacted(api, () => {
    // The column_list opts out of its default auto-seed; we fill it with
    // explicit columns below. Columns are typed blocks, so they are created
    // with `insert(COLUMN_TOOL, ...)` + setBlockParent (insertInsideParent only
    // ever creates the default paragraph block).
    const list = api.blocks.insert(COLUMN_LIST_TOOL, { noSeed: true }, {}, targetIndex, false, false);

    created.listId = list.id;

    const firstColumn = api.blocks.insert(COLUMN_TOOL, { noSeed: true }, {}, targetIndex + 1, false, false);
    const secondColumn = api.blocks.insert(COLUMN_TOOL, { noSeed: true }, {}, targetIndex + 2, false, false);

    api.blocks.setBlockParent(firstColumn.id, list.id);
    api.blocks.setBlockParent(secondColumn.id, list.id);

    const targetColumn = side === 'left' ? secondColumn : firstColumn;
    const sourcesColumn = side === 'left' ? firstColumn : secondColumn;

    created.sourcesColumnId = sourcesColumn.id;

    api.blocks.setBlockParent(targetId, targetColumn.id);

    for (const sourceId of sourceIds) {
      api.blocks.setBlockParent(sourceId, sourcesColumn.id);
    }
  });

  // Slide the new column in once the tree has settled; the target column reflows
  // from full width to its share for free as the new column's grow animates up.
  if (created.sourcesColumnId !== null) {
    const holder = api.blocks.getById(created.sourcesColumnId)?.holder;

    if (holder !== undefined) {
      playColumnEnterAnimation(holder);
    }
  }

  return created.listId;
};

/**
 * Add ONE new `column` beside an existing `neighborColumnId` inside its
 * `column_list`, then move the dragged `sourceIds` into it (in order).
 *
 * - side 'left'  -> new column inserted before the neighbor
 * - side 'right' -> new column inserted after the neighbor
 *
 * All work runs in a single undo entry via `transact`. Aborts (returns null,
 * no mutation) when sources is empty or the neighbor is stale.
 */
export const addColumnToList = (
  api: API,
  neighborColumnId: string,
  sourceIds: string[],
  side: ColumnDropSide
): string | null => {
  if (sourceIds.length === 0) {
    return null;
  }

  const neighborIndex = api.blocks.getBlockIndex(neighborColumnId);

  if (neighborIndex === undefined) {
    return null;
  }

  for (const sourceId of sourceIds) {
    if (api.blocks.getBlockIndex(sourceId) === undefined) {
      return null;
    }
  }

  const neighbor = api.blocks.getById(neighborColumnId);
  const columnListId = neighbor?.parentId;

  if (columnListId === undefined || columnListId === null) {
    return null;
  }

  const insertIndex = side === 'left' ? neighborIndex : neighborIndex + 1;

  const created: { columnId: string | null } = { columnId: null };

  runTransacted(api, () => {
    // A column is a typed block, so it is created with insert(COLUMN_TOOL) +
    // setBlockParent. Columns are ordered among the list's children by relative
    // flat index, so neighborIndex (left) / neighborIndex+1 (right) places the
    // new column on the correct side after the nested re-sort.
    const column = api.blocks.insert(COLUMN_TOOL, { noSeed: true }, {}, insertIndex, false, false);

    created.columnId = column.id;

    api.blocks.setBlockParent(column.id, columnListId);

    for (const sourceId of sourceIds) {
      api.blocks.setBlockParent(sourceId, column.id);
    }

    // A column was added, so the row re-splits evenly — the only non-resize
    // case where widths recalculate.
    resetColumnsToEvenWidth(api, columnListId);

    // The list was already rendered, so its rendered() hook won't fire again to
    // build a separator for the new column — rebuild the full N-1 set here.
    rebuildColumnResizers(api, columnListId);
  });

  // Slide the new column in; siblings reflow to make room as its grow animates.
  if (created.columnId !== null) {
    const holder = api.blocks.getById(created.columnId)?.holder;

    if (holder !== undefined) {
      playColumnEnterAnimation(holder);
    }
  }

  return created.columnId;
};
