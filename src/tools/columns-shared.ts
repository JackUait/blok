import type { API } from '../../types';

export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';
export const COLUMN_ATTR = 'data-blok-column';
export const COLUMN_RESIZER_ATTR = 'data-blok-column-resizer';
/** Trigger attribute the CSS keyframes hook onto to play the new-column entry. */
export const COLUMN_ENTER_ATTR = 'data-blok-column-enter';

/**
 * Play the one-shot "new column" entry animation on a freshly added column
 * holder, à la Notion: the bar expands its flex-grow from 0 to its natural
 * share while fading in, so neighbours reflow smoothly to make room. The
 * trigger attribute is stripped once the animation ends, returning the column
 * to its static state so the effect never replays on a later re-render.
 */
export const playColumnEnterAnimation = (holder: HTMLElement): void => {
  holder.setAttribute(COLUMN_ENTER_ATTR, '');
  holder.addEventListener(
    'animationend',
    () => holder.removeAttribute(COLUMN_ENTER_ATTR),
    { once: true }
  );
};

/**
 * Smallest width (px) a column may be squeezed to while dragging a resizer.
 * Zero means no min-width restriction — a column can be dragged all the way
 * to collapse. The resize math still clamps to [0, pairWidth] so widths never
 * go negative or overflow the pair.
 */
export const COLUMN_MIN_WIDTH = 0;

/**
 * Redistribute the flex-grow of two adjacent columns as their shared separator
 * is dragged by `delta` px. The pair's total grow is preserved so columns
 * outside the pair keep their width; widths are clamped to `minWidth` so
 * neither column collapses.
 *
 * Width-driven because the columns use `flex-basis: 0` — width is proportional
 * to flex-grow, so the new grows are the pair's grow sum split by the new
 * width fractions.
 */
export const resizeColumnGrow = (params: {
  leftWidth: number;
  rightWidth: number;
  leftGrow: number;
  rightGrow: number;
  delta: number;
  minWidth: number;
}): { leftGrow: number; rightGrow: number } => {
  const pairWidth = params.leftWidth + params.rightWidth;
  const growSum = params.leftGrow + params.rightGrow;

  if (pairWidth <= 0 || growSum <= 0) {
    return { leftGrow: params.leftGrow, rightGrow: params.rightGrow };
  }

  const leftWidth = Math.max(
    params.minWidth,
    Math.min(pairWidth - params.minWidth, params.leftWidth + params.delta)
  );
  const rightWidth = pairWidth - leftWidth;

  return {
    leftGrow: (growSum * leftWidth) / pairWidth,
    rightGrow: (growSum * rightWidth) / pairWidth,
  };
};

/** Update the separator's slider value to the left column's width percentage. */
const updateResizerAria = (
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement
): void => {
  const leftGrow = Number(leftHolder.style.flexGrow) || 1;
  const rightGrow = Number(rightHolder.style.flexGrow) || 1;
  const growSum = leftGrow + rightGrow;
  const percent = growSum > 0 ? Math.round((leftGrow / growSum) * 100) : 50;

  resizer.setAttribute('aria-valuenow', String(percent));
};

/** Apply a px `delta` to the column pair and sync the separator's aria value. */
const applyResizeDelta = (
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  delta: number
): void => {
  // Alias to locals so we set flex-grow without tripping no-param-reassign.
  const leftEl = leftHolder;
  const rightEl = rightHolder;
  const next = resizeColumnGrow({
    leftWidth: leftEl.getBoundingClientRect().width,
    rightWidth: rightEl.getBoundingClientRect().width,
    leftGrow: Number(leftEl.style.flexGrow) || 1,
    rightGrow: Number(rightEl.style.flexGrow) || 1,
    delta,
    minWidth: COLUMN_MIN_WIDTH,
  });

  leftEl.style.flexGrow = String(next.leftGrow);
  rightEl.style.flexGrow = String(next.rightGrow);
  updateResizerAria(resizer, leftEl, rightEl);
};

/** Per-press keyboard resize step in px. */
const KEYBOARD_RESIZE_STEP = 16;

const onResizerKeydown = (
  event: KeyboardEvent,
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement
): void => {
  const pairWidth =
    leftHolder.getBoundingClientRect().width + rightHolder.getBoundingClientRect().width;

  const deltaByKey: Record<string, number> = {
    ArrowLeft: -KEYBOARD_RESIZE_STEP,
    ArrowRight: KEYBOARD_RESIZE_STEP,
    Home: -pairWidth,
    End: pairWidth,
  };

  const delta = deltaByKey[event.key];

  if (delta === undefined) {
    return;
  }

  event.preventDefault();
  applyResizeDelta(resizer, leftHolder, rightHolder, delta);
};

/**
 * Drag handler for a single separator: redistribute flex-grow between the two
 * neighbouring column holders as the separator moves. Pointer capture keeps the
 * move/up events flowing even when the cursor leaves the thin handle. The
 * holder's flex-grow is the persisted source of truth (Column.save reads it
 * back), so no api.blocks.update is needed.
 */
const startColumnResize = (
  event: PointerEvent,
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement
): void => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();

  // Alias to locals so the move handler mutates flex-grow without tripping
  // no-param-reassign on the parameters.
  const leftEl = leftHolder;
  const rightEl = rightHolder;
  const startX = event.clientX;
  const leftWidth = leftEl.getBoundingClientRect().width;
  const rightWidth = rightEl.getBoundingClientRect().width;
  const leftGrow = Number(leftEl.style.flexGrow) || 1;
  const rightGrow = Number(rightEl.style.flexGrow) || 1;

  resizer.setPointerCapture(event.pointerId);
  resizer.setAttribute('data-dragging', '');

  const onMove = (moveEvent: PointerEvent): void => {
    const next = resizeColumnGrow({
      leftWidth,
      rightWidth,
      leftGrow,
      rightGrow,
      delta: moveEvent.clientX - startX,
      minWidth: COLUMN_MIN_WIDTH,
    });

    leftEl.style.flexGrow = String(next.leftGrow);
    rightEl.style.flexGrow = String(next.rightGrow);
    updateResizerAria(resizer, leftEl, rightEl);
  };

  const onUp = (upEvent: PointerEvent): void => {
    resizer.releasePointerCapture(upEvent.pointerId);
    resizer.removeAttribute('data-dragging');
    resizer.removeEventListener('pointermove', onMove);
    resizer.removeEventListener('pointerup', onUp);
  };

  resizer.addEventListener('pointermove', onMove);
  resizer.addEventListener('pointerup', onUp);
};

const createColumnResizer = (
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  api: API,
  columnListId: string
): HTMLElement => {
  const resizer = document.createElement('div');

  resizer.setAttribute(COLUMN_RESIZER_ATTR, '');
  resizer.setAttribute('data-blok-testid', 'column-resizer');
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('tabindex', '0');
  resizer.setAttribute('aria-label', api.i18n.t('tools.columns.resizeAriaLabel'));
  resizer.setAttribute('aria-valuemin', '0');
  resizer.setAttribute('aria-valuemax', '100');
  updateResizerAria(resizer, leftHolder, rightHolder);

  resizer.addEventListener('pointerdown', event => {
    startColumnResize(event, resizer, leftHolder, rightHolder);
  });

  // Double-click equalizes every column in the list, à la Notion.
  resizer.addEventListener('dblclick', () => {
    resetColumnsToEvenWidth(api, columnListId);
  });

  resizer.addEventListener('keydown', event => {
    onResizerKeydown(event, resizer, leftHolder, rightHolder);
  });

  return resizer;
};

/**
 * (Re)build the drag-to-resize separators inside a column_list `container`:
 * one between each adjacent pair of column `holders`. Existing separators are
 * cleared first so repeated calls never stack duplicates. No-op in read-only
 * mode — columns are not resizable there.
 *
 * Shared so BOTH the ColumnList tool (on render/seed) and the drag-beside
 * "add a column" path can rebuild handles. The latter mutates an
 * already-rendered list whose rendered() hook never fires again, so it must
 * rebuild the separators itself rather than rely on a re-render.
 */
export const buildColumnResizers = (
  container: HTMLElement,
  holders: HTMLElement[],
  readOnly: boolean,
  api: API,
  columnListId: string
): void => {
  if (readOnly) {
    return;
  }

  container
    .querySelectorAll(`[${COLUMN_RESIZER_ATTR}]`)
    .forEach(resizer => resizer.remove());

  holders.slice(1).forEach((rightHolder, index) => {
    const leftHolder = holders[index];
    const resizer = createColumnResizer(leftHolder, rightHolder, api, columnListId);

    container.insertBefore(resizer, rightHolder);
  });
};

/**
 * Re-split a column_list evenly: reset every child column's holder flex-grow
 * to 1. Called only when a column is added, so the row re-balances; resize is
 * the only OTHER place widths change. The holder's flex-grow is the persisted
 * source of truth (Column.save reads it back), so setting it to 1 both resizes
 * live and drops any stored widthRatio on the next save.
 */
export const resetColumnsToEvenWidth = (api: API, columnListId: string): void => {
  for (const column of api.blocks.getChildren(columnListId)) {
    column.holder.style.flexGrow = '1';
  }
};

/**
 * Delete a block by id. `api.blocks.delete` is index-based and async, and any
 * preceding delete shifts the flat array, so the id is re-resolved to its
 * CURRENT index immediately before the call. Resolving by id (never a stale
 * captured index) is what prevents the unwrap from deleting an innocent
 * sibling that has slid into the doomed block's old slot.
 */
const deleteById = async (api: API, blockId: string): Promise<void> => {
  const index = api.blocks.getBlockIndex(blockId);

  if (index !== undefined) {
    await api.blocks.delete(index);
  }
};

/**
 * If a column_list has collapsed to a single column, dissolve it: promote the
 * surviving column's child blocks into the column_list's OWN parent, then
 * delete both the surviving column and the column_list.
 *
 * The promotion target is the column_list's enclosing parent, NOT a hardcoded
 * root: a top-level list promotes its survivors to root (null), but a NESTED
 * list (one living inside an outer column) promotes them into that enclosing
 * column so they stay visually inside the outer layout instead of escaping to
 * the document root.
 *
 * Deletes are resolved by id (see {@link deleteById}) so a shifted flat array
 * never targets the wrong block.
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

  // The column_list's own parent is where survivors belong: root (null) for a
  // top-level list, or the enclosing column for a nested one.
  const enclosingParentId = api.blocks.getById(columnListId)?.parentId ?? null;

  const [survivingColumn] = columns;
  const survivingBlocks = api.blocks.getChildren(survivingColumn.id);

  for (const child of survivingBlocks) {
    api.blocks.setBlockParent(child.id, enclosingParentId);
  }

  // Detach the surviving column to root before deleting it: its children are
  // already promoted, so deleting it drops nothing, and a null parentId means
  // its removed() hook skips the recursive unwrap call.
  api.blocks.setBlockParent(survivingColumn.id, null);

  await deleteById(api, survivingColumn.id);
  await deleteById(api, columnListId);

  return true;
};
