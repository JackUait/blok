import type { API } from '../../types';
import {
  animateColumnWidths,
  captureSiblingTops,
  playSiblingShift,
} from '../components/modules/drag/utils/ColumnDropAnimation';
import {
  COLUMN_LIST_TOOL,
  COLUMN_TOOL,
  rebuildColumnListResizers,
  resetColumnsToEvenWidth,
} from './columns-shared';

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

  // FLIP capture: the target's pre-drop width seeds the new row's start state,
  // and the tops of the blocks below it drive their glide to the new layout.
  const targetHolder = api.blocks.getById(targetId)?.holder;
  const targetStartWidth = targetHolder?.getBoundingClientRect().width ?? 0;
  const siblingTops = targetHolder !== undefined ? captureSiblingTops(targetHolder) : null;

  const created: {
    listId: string | null;
    columnHolders: HTMLElement[];
    sourcesColumnHolder: HTMLElement | null;
  } = {
    listId: null,
    columnHolders: [],
    sourcesColumnHolder: null,
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

    created.columnHolders = [firstColumn.holder, secondColumn.holder];
    created.sourcesColumnHolder = sourcesColumn.holder;

    api.blocks.setBlockParent(targetId, targetColumn.id);

    for (const sourceId of sourceIds) {
      api.blocks.setBlockParent(sourceId, sourcesColumn.id);
    }
  });

  // Play the drop motion: the target column starts at the target's old full
  // width, the sources column grows in from zero, and the blocks below glide
  // to their shifted slots — all on one clock.
  if (targetHolder !== undefined && created.columnHolders.length === 2) {
    animateColumnWidths({
      holders: created.columnHolders,
      startWidths: side === 'left' ? [0, targetStartWidth] : [targetStartWidth, 0],
      newColumnHolder: created.sourcesColumnHolder,
    });

    if (siblingTops !== null) {
      playSiblingShift(siblingTops);
    }
  }

  return created.listId;
};

/**
 * Wrap the top-level `blockIds` into a brand new `column_list`, one block per
 * column, preserving selection order. Each block keeps its subtree (children
 * track their parent), so a selected `column_list` rides into a single column
 * as a nested list. All work runs in a single undo entry via `transact`.
 *
 * Non-top-level ids are IGNORED, not rejected: a cross-block selection that
 * spans a container also marks the container's descendants selected (the
 * selection walks the flat block array), and those descendants ride along
 * inside their container — wrapping them again would tear the subtree apart.
 *
 * Aborts (returns null, no mutation) when fewer than 2 top-level, non-stale
 * blocks remain after filtering.
 */
export const wrapBlocksInColumns = (
  api: API,
  blockIds: string[]
): string | null => {
  const topLevelIds = blockIds.filter((blockId) => {
    if (api.blocks.getBlockIndex(blockId) === undefined) {
      return false;
    }

    return api.blocks.getById(blockId)?.parentId === null;
  });

  if (topLevelIds.length < 2) {
    return null;
  }

  const baseIndex = api.blocks.getBlockIndex(topLevelIds[0]);

  if (baseIndex === undefined) {
    return null;
  }

  const created: { listId: string | null } = { listId: null };

  runTransacted(api, () => {
    const list = api.blocks.insert(COLUMN_LIST_TOOL, { noSeed: true }, {}, baseIndex, false, false);

    created.listId = list.id;

    const columns = topLevelIds.map((_, i) =>
      api.blocks.insert(COLUMN_TOOL, { noSeed: true }, {}, baseIndex + 1 + i, false, false)
    );

    for (const column of columns) {
      api.blocks.setBlockParent(column.id, list.id);
    }

    topLevelIds.forEach((blockId, i) => {
      api.blocks.setBlockParent(blockId, columns[i].id);
    });

    // New list: rendered() already fired with zero children, so it never built
    // separators — rebuild the N-1 set and even the widths.
    resetColumnsToEvenWidth(api, list.id);
    rebuildColumnListResizers(api, list.id);
  });

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

  // FLIP capture: the columns' pre-drop widths seed the row's start state, and
  // the tops of the blocks below the list drive their glide after the mutation.
  const listHolder = api.blocks.getById(columnListId)?.holder;
  const startWidthByHolder = new Map(
    api.blocks.getChildren(columnListId).map(column => [
      column.holder,
      column.holder.getBoundingClientRect().width,
    ])
  );
  const siblingTops = listHolder !== undefined ? captureSiblingTops(listHolder) : null;

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
    rebuildColumnListResizers(api, columnListId);
  });

  // Play the drop motion: existing columns glide from their pre-drop widths to
  // the even re-split, the new column grows in from zero, and the blocks below
  // the list glide to their shifted slots — all on one clock.
  if (created.columnId !== null) {
    const finalChildren = api.blocks.getChildren(columnListId);

    animateColumnWidths({
      holders: finalChildren.map(column => column.holder),
      startWidths: finalChildren.map(column => startWidthByHolder.get(column.holder) ?? 0),
      newColumnHolder: finalChildren.find(column => column.id === created.columnId)?.holder ?? null,
    });

    if (siblingTops !== null) {
      playSiblingShift(siblingTops);
    }
  }

  return created.columnId;
};
