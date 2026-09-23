import * as Y from 'yjs';

import { GRID_ORDER_KEY, GRID_ROWS_KEY } from './serializer';

type DeleteSet = Y.UndoManager['undoStack'][number]['insertions'];

/**
 * Grid padding: the empty cells an editor adds to keep a keyed grid
 * rectangular (a peer's add-column pads every row, a peer's add-row gives
 * every column a cell). They carry no content, so they must not stop an undo
 * of the row or column they sit in.
 */

const isEmptyList = (value: unknown): boolean =>
  (Array.isArray(value) && value.length === 0) || (value instanceof Y.Array && value.length === 0);

/**
 * A cell with only identity fields and no blocks.
 * @param value - a value stored in a row's cell map
 */
export const isPaddingCell = (value: unknown): boolean =>
  value instanceof Y.Map
  && value.has('blocks')
  && Array.from(value.entries()).every(([key, field]) =>
    key === 'id' || key === 'rowId' || (key === 'blocks' && isEmptyList(field)));

/**
 * The keyed wrapper (grid or row) a `__rows` / `__rowKeys` type belongs to.
 */
const wrapperOf = (type: Y.AbstractType<unknown>, key: string): Y.Map<unknown> | null => {
  const item = type._item;

  return item !== null && item.parentSub === key && item.parent instanceof Y.Map ? item.parent : null;
};

/**
 * Whether this order-array item only names padding cells of its row.
 * @param item - an item of a `__rowKeys` array
 */
export const namesOnlyPaddingCells = (item: Y.Item): boolean => {
  if (!(item.parent instanceof Y.Array)) {
    return false;
  }

  const wrapper = wrapperOf(item.parent, GRID_ORDER_KEY);
  const cells = wrapper?.get(GRID_ROWS_KEY);

  return cells instanceof Y.Map && item.content.getContent()
    .every((key) => typeof key === 'string' && isPaddingCell(cells.get(key)));
};

/**
 * When an undo deletes this editor's cell from a row that stays, the column
 * it belonged to is going away: delete the padding cells a peer added under
 * the same column key in the other rows. Runs inside the undo's transaction,
 * so the redo brings them back with the column.
 * @param item - the item the undo is about to delete
 */
export const dropPeerPaddingOfRemovedColumn = (item: Y.Item, poppedInsertions: DeleteSet | null): void => {
  const key = item.parentSub;
  const cells = item.parent;

  if (key === null || !(cells instanceof Y.Map) || cells._map.get(key) !== item) {
    return;
  }

  const row = wrapperOf(cells, GRID_ROWS_KEY);
  const rowItem = row?._item ?? null;
  const rows = rowItem?.parent;

  // The whole row goes with this undo: that is a row removal, not a column's.
  if (rowItem === null || !(rows instanceof Y.Map) || wrapperOf(rows, GRID_ROWS_KEY) === null
    || (poppedInsertions !== null && Y.isDeleted(poppedInsertions, rowItem.id))) {
    return;
  }

  const local = cells.doc?.clientID;

  rows.forEach((other: unknown) => {
    if (other === row || !(other instanceof Y.Map)) {
      return;
    }

    const otherRow = other as Y.Map<unknown>;
    const otherCells = otherRow.get(GRID_ROWS_KEY);
    const otherOrder = otherRow.get(GRID_ORDER_KEY);
    const padding = otherCells instanceof Y.Map ? otherCells._map.get(key) : undefined;

    if (!(otherCells instanceof Y.Map) || padding === undefined || padding.deleted
      || padding.id.client === local || !isPaddingCell(otherCells.get(key))) {
      return;
    }

    otherCells.delete(key);

    if (otherOrder instanceof Y.Array) {
      const index = otherOrder.toArray().indexOf(key);

      if (index !== -1) {
        otherOrder.delete(index, 1);
      }
    }
  });
};
