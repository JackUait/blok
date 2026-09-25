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
import { isInsideTableCell, isRestrictedInTableCell } from './table/table-restrictions';

export type ColumnDropSide = 'left' | 'right';

/**
 * Whether a new column_list may sit under `parentId`, beside `anchorId`.
 * A column_list may only hold columns, and table cells restrict column_list.
 * Inserting by placement is not demoted like an index insert, so the wrap
 * helpers must refuse here or they build a row where none may exist.
 */
const canHostColumnList = (api: API, parentId: string | null, anchorId: string): boolean => {
  if (parentId !== null && api.blocks.getById(parentId)?.name === COLUMN_LIST_TOOL) {
    return false;
  }

  const anchorHolder = api.blocks.getById(anchorId)?.holder;

  return !(isRestrictedInTableCell(COLUMN_LIST_TOOL) && isInsideTableCell(anchorHolder));
};

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
 * Wrap a `targetId` block and the dragged `sourceIds` into a brand new
 * `column_list` with two columns: one holds the target, the other holds the
 * sources stacked in document order. The list takes the target's place under
 * the target's own parent, so a drop inside a toggle or callout stays there.
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
 * - the target's parent cannot hold a column_list (see canHostColumnList).
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

  if (api.blocks.getBlockIndex(targetId) === undefined) {
    return null;
  }

  for (const sourceId of sourceIds) {
    if (api.blocks.getBlockIndex(sourceId) === undefined) {
      return null;
    }
  }

  // FLIP capture: the target's pre-drop width seeds the new row's start state,
  // and the tops of the blocks below it drive their glide to the new layout.
  const target = api.blocks.getById(targetId);

  if (!canHostColumnList(api, target?.parentId ?? null, targetId)) {
    return null;
  }

  const targetHolder = target?.holder;
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
    // explicit columns below.
    const list = api.blocks.insertAt(COLUMN_LIST_TOOL, { noSeed: true }, { parentId: target?.parentId ?? null, position: { before: targetId } });

    created.listId = list.id;

    const firstColumn = api.blocks.insertAt(COLUMN_TOOL, { noSeed: true }, { parentId: list.id, position: 'end' });
    const secondColumn = api.blocks.insertAt(COLUMN_TOOL, { noSeed: true }, { parentId: list.id, position: 'end' });

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
 * The blocks a "turn into columns" over `blockIds` would wrap, one per column,
 * or null when it cannot run.
 *
 * Only selection roots count: a selected block whose ancestor is also selected
 * rides along inside it (a cross-block selection over a container also marks
 * its descendants selected). The roots must share one parent, because the new
 * row takes their place under that parent. Stale ids are skipped.
 *
 * Returns null when fewer than 2 roots remain, they sit in different
 * containers (wrapping only some would silently drop the rest of the user's
 * selection), or their parent cannot hold a column_list.
 */
export const resolveColumnWrapRoots = (
  api: API,
  blockIds: string[]
): { parentId: string | null; rootIds: string[] } | null => {
  const liveIds = blockIds.filter(blockId => api.blocks.getBlockIndex(blockId) !== undefined);
  const selected = new Set(liveIds);

  const hasSelectedAncestor = (blockId: string): boolean => {
    const seen = new Set<string>();
    const cursor: { id: string | null } = { id: api.blocks.getById(blockId)?.parentId ?? null };

    while (cursor.id !== null && !seen.has(cursor.id)) {
      if (selected.has(cursor.id)) {
        return true;
      }

      seen.add(cursor.id);
      cursor.id = api.blocks.getById(cursor.id)?.parentId ?? null;
    }

    return false;
  };

  const rootIds = liveIds.filter(blockId => !hasSelectedAncestor(blockId));

  if (rootIds.length < 2) {
    return null;
  }

  const parentId = api.blocks.getById(rootIds[0])?.parentId ?? null;
  const shareParent = rootIds.every(blockId => (api.blocks.getById(blockId)?.parentId ?? null) === parentId);

  return shareParent && canHostColumnList(api, parentId, rootIds[0]) ? { parentId, rootIds } : null;
};

/**
 * Wrap the selection roots of `blockIds` (see resolveColumnWrapRoots) into a
 * brand new `column_list`, one block per column, preserving selection order.
 * Each block keeps its subtree (children track their parent), so a selected
 * `column_list` rides into a single column as a nested list. The row takes the
 * roots' place under their shared parent. All work runs in a single undo entry
 * via `transact`.
 *
 * Aborts (returns null, no mutation) when resolveColumnWrapRoots does.
 */
export const wrapBlocksInColumns = (
  api: API,
  blockIds: string[]
): string | null => {
  const resolved = resolveColumnWrapRoots(api, blockIds);

  if (resolved === null) {
    return null;
  }

  const { parentId, rootIds } = resolved;
  const created: { listId: string | null } = { listId: null };

  runTransacted(api, () => {
    const list = api.blocks.insertAt(COLUMN_LIST_TOOL, { noSeed: true }, { parentId, position: { before: rootIds[0] } });

    created.listId = list.id;

    const columns = rootIds.map(() =>
      api.blocks.insertAt(COLUMN_TOOL, { noSeed: true }, { parentId: list.id, position: 'end' })
    );

    rootIds.forEach((blockId, i) => {
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

  if (api.blocks.getBlockIndex(neighborColumnId) === undefined) {
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
    const column = api.blocks.insertAt(COLUMN_TOOL, { noSeed: true }, {
      parentId: columnListId,
      position: side === 'left' ? { before: neighborColumnId } : { after: neighborColumnId },
    });

    created.columnId = column.id;

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
