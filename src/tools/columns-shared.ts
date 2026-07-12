import type { API } from '../../types';

export const COLUMN_LIST_TOOL = 'column_list';
export const COLUMN_TOOL = 'column';
export const COLUMNS_ATTR = 'data-blok-columns';
export const COLUMN_ATTR = 'data-blok-column';
export const COLUMN_RESIZER_ATTR = 'data-blok-column-resizer';
/**
 * Marks a column_list whose gutter must come from the container's own
 * horizontal gap rather than from resizer elements. Set only in read-only
 * mode, where resizers are not built — without it, columns would render flush
 * with no gutter (the resizers ARE the gutter in editing mode).
 */
export const COLUMNS_STATIC_GUTTER_ATTR = 'data-blok-columns-static-gutter';

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

/**
 * Flush the live flex-grow of the just-resized column holders into Yjs.
 *
 * The resizer writes flex-grow directly on each column's `block.holder`, which
 * sits OUTSIDE the column tool's observed subtree — so the per-block
 * MutationObserver never fires and `Column.save()` is never run. Dispatch a
 * change on each affected column block so its `save()` runs, reads the new
 * flex-grow back as `widthRatio`, and writes it to Yjs. Without this the resize
 * is invisible to undo/redo and to remote collaborators (a full
 * `editor.save()` still captures the live width, which is why reload is
 * unaffected).
 */
const persistColumnWidths = (
  api: API,
  columnListId: string,
  holders: HTMLElement[]
): void => {
  const columns = api.blocks.getChildren(columnListId) ?? [];

  for (const holder of holders) {
    columns.find(column => column.holder === holder)?.dispatchChange();
  }
};

const onResizerKeydown = (
  event: KeyboardEvent,
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  api: API,
  columnListId: string
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
  persistColumnWidths(api, columnListId, [leftHolder, rightHolder]);
};

/**
 * Drag handler for a single separator: redistribute flex-grow between the two
 * neighbouring column holders as the separator moves. Pointer capture keeps the
 * move/up events flowing even when the cursor leaves the thin handle. The
 * holder's flex-grow is the live source of truth (Column.save reads it back),
 * but it lives outside the column's observed subtree — so on pointer-up the new
 * widths are flushed to Yjs via `persistColumnWidths` for undo/redo and collab.
 */
const startColumnResize = (
  event: PointerEvent,
  resizer: HTMLElement,
  leftHolder: HTMLElement,
  rightHolder: HTMLElement,
  api: API,
  columnListId: string
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

  // pointerup AND pointercancel: with pointer capture the browser fires
  // pointercancel INSTEAD of pointerup when it takes the gesture over, and the
  // widths are already live in the DOM by then — so the end handler must run on
  // both, or the drag leaks its listeners and the flex-grow values are never
  // persisted (the DOM would silently revert on the next render).
  const onEnd = (endEvent: PointerEvent): void => {
    resizer.releasePointerCapture(endEvent.pointerId);
    resizer.removeAttribute('data-dragging');
    resizer.removeEventListener('pointermove', onMove);
    resizer.removeEventListener('pointerup', onEnd);
    resizer.removeEventListener('pointercancel', onEnd);
    persistColumnWidths(api, columnListId, [leftEl, rightEl]);
  };

  resizer.addEventListener('pointermove', onMove);
  resizer.addEventListener('pointerup', onEnd);
  resizer.addEventListener('pointercancel', onEnd);
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
    startColumnResize(event, resizer, leftHolder, rightHolder, api, columnListId);
  });

  // Double-click equalizes every column in the list, à la Notion.
  resizer.addEventListener('dblclick', () => {
    resetColumnsToEvenWidth(api, columnListId);
  });

  resizer.addEventListener('keydown', event => {
    onResizerKeydown(event, resizer, leftHolder, rightHolder, api, columnListId);
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
 * the only OTHER place widths change. The holder's flex-grow is the live source
 * of truth (Column.save reads it back), so setting it to 1 resizes live and a
 * full editor.save() correctly omits the now-default widthRatio.
 *
 * NOTE: this does not actively clear a widthRatio already written to the live
 * Yjs doc by a prior resize — Column.save() returns {} for the even-split
 * default, and the per-key data sync never deletes keys absent from save()
 * output. So a reset that follows a persisted resize leaves the old ratio in
 * the live doc (visible only to undo/redo and remote peers, never to
 * save()/reload). Fully clearing it requires the per-key sync to delete omitted
 * keys; tracked as a known limitation rather than recreating blocks mid-drop.
 */
export const resetColumnsToEvenWidth = (api: API, columnListId: string): void => {
  for (const column of api.blocks.getChildren(columnListId)) {
    column.holder.style.flexGrow = '1';
  }
};

/**
 * Rebuild the resize separators of a live column_list after its column set
 * changed OUTSIDE a fresh render (a column added or removed mid-life). The
 * list's rendered() hook fires only once, so such a mutation never rebuilds the
 * separators on its own — without this, a removed column leaves its separator
 * behind as a stray LEADING bar (a full-height gutter at the row's left edge
 * that reads as a phantom extra column), and an added column lands with no
 * handle. Reach the row element (COLUMNS_ATTR) from any surviving column holder;
 * a no-op when the list has no live holder (fully removed) or in read-only mode.
 */
export const rebuildColumnListResizers = (api: API, columnListId: string): void => {
  const holders = api.blocks.getChildren(columnListId).map(column => column.holder);
  const container = holders[0]?.closest(`[${COLUMNS_ATTR}]`);

  if (container instanceof HTMLElement) {
    buildColumnResizers(container, holders, api.readOnly.isEnabled, api, columnListId);
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
