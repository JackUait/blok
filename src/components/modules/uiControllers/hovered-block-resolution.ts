/**
 * Shared pointer→block resolution for the block toolbar, used by both the
 * mousemove hover path (blockHover controller) and the touch/click path
 * (redactor touch handler) so the two can never disagree on which block owns
 * the toolbar.
 */

const BLOCK_WRAPPER_SELECTOR = '[data-blok-testid="block-wrapper"]';

/**
 * Every child-hosting container: toggle list / toggle heading / callout
 * ([data-blok-toggle-children]), columns and generic nesting
 * ([data-blok-nested-blocks]). Table cell containers carry
 * [data-blok-nested-blocks] too and are told apart via CELL_BLOCKS_SELECTOR.
 */
const NESTED_CONTAINER_SELECTOR = '[data-blok-nested-blocks], [data-blok-toggle-children]';
const CELL_BLOCKS_SELECTOR = '[data-blok-table-cell-blocks]';
const CHILD_TOOLBAR_SELECTOR = '[data-blok-child-toolbar]';

/**
 * Depth cap for descending through nested containers. Nesting deeper than
 * this is not a realistic document; the cap only guards against cyclic DOM.
 */
const MAX_DESCENT_DEPTH = 12;

export type HoveredBlockResolution =
  /** The toolbar belongs to this block wrapper */
  | { kind: 'block'; wrapper: Element }
  /** Pointer is in container chrome with no block on that line — keep the current anchor */
  | { kind: 'keep' }
  /** No block under the pointer — caller may fall back to nearest-block detection */
  | { kind: 'none' };

/**
 * Resolves the block wrapper that should own the block toolbar for a pointer
 * position.
 *
 * Rules (Notion parity):
 * - The deepest block wrapper under the pointer owns the toolbar. Children of
 *   toggles/callouts/columns are first-class targets — resolving them UP to
 *   the container makes their menus uncatchable (the toolbar jumps to the
 *   parent exactly while the pointer travels toward the child's own icons).
 * - Blocks living inside a table cell resolve to the table: cells are not
 *   draggable blocks.
 * - A [data-blok-child-toolbar] container's FIRST child is the container's
 *   own visual line (callout text), so it resolves to the container block.
 * - Pointer over a container's own chrome (gutter strip, gaps between
 *   children) descends by line: the child whose vertical band contains the
 *   pointer wins; with side-by-side children (columns) the horizontal band
 *   disambiguates; no band match keeps the current anchor.
 * @param target - element under the pointer
 * @param point - pointer client coordinates, used for band descent in container chrome
 */
export function resolveHoveredBlockWrapper(
  target: Element | null,
  point?: { x: number; y: number }
): HoveredBlockResolution {
  if (target === null || typeof target.closest !== 'function') {
    return { kind: 'none' };
  }

  const directWrapper = target.closest(BLOCK_WRAPPER_SELECTOR);
  const container = target.closest(NESTED_CONTAINER_SELECTOR);

  /**
   * Cell containers are skipped here: pointer over cell chrome falls through
   * to the wrapper lookup, which lands on the table wrapper below.
   */
  const isInContainerChrome = container !== null
    && !container.matches(CELL_BLOCKS_SELECTOR)
    && (directWrapper === null || !container.contains(directWrapper));

  if (isInContainerChrome) {
    const descended = point !== undefined ? descendToLineChild(container, point, 0) : null;

    return descended === null ? { kind: 'keep' } : resolveWrapper(descended);
  }

  return directWrapper === null ? { kind: 'none' } : resolveWrapper(directWrapper);
}

/**
 * Extracts client coordinates from a mouse or touch event for band descent.
 * @param event - the pointer event driving the resolution
 */
export function getPointFromPointerEvent(event: Event): { x: number; y: number } | undefined {
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }

  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];

    return touch !== undefined ? { x: touch.clientX, y: touch.clientY } : undefined;
  }

  return undefined;
}

/**
 * Maps a hit block wrapper to the wrapper that owns the toolbar: cell blocks
 * anchor their table, a child-toolbar container's first child anchors the
 * container block, everything else anchors itself.
 * @param wrapper - the block wrapper the pointer resolved to
 */
function resolveWrapper(wrapper: Element): HoveredBlockResolution {
  const cellContainer = wrapper.closest(CELL_BLOCKS_SELECTOR);

  if (cellContainer !== null) {
    const tableWrapper = cellContainer.closest(BLOCK_WRAPPER_SELECTOR);

    return tableWrapper !== null ? { kind: 'block', wrapper: tableWrapper } : { kind: 'none' };
  }

  const childToolbarContainer = wrapper.closest(CHILD_TOOLBAR_SELECTOR);
  const isFirstChildOfContainer = childToolbarContainer !== null
    && childToolbarContainer.querySelector(`:scope > ${BLOCK_WRAPPER_SELECTOR}`) === wrapper;
  const parentWrapper = isFirstChildOfContainer
    ? childToolbarContainer.closest(BLOCK_WRAPPER_SELECTOR)
    : null;

  return { kind: 'block', wrapper: parentWrapper ?? wrapper };
}

/**
 * Walks down from a container to the deepest direct-child block wrapper whose
 * vertical band contains the pointer, recursing through the picked child's
 * own container (nested toggles, columns).
 * @param container - the child-hosting container whose chrome the pointer is in
 * @param point - pointer client coordinates
 * @param depth - current recursion depth
 */
function descendToLineChild(container: Element, point: { x: number; y: number }, depth: number): Element | null {
  if (depth >= MAX_DESCENT_DEPTH) {
    return null;
  }

  const candidates = Array.from(container.querySelectorAll(`:scope > ${BLOCK_WRAPPER_SELECTOR}`))
    .filter((el) => {
      const rect = el.getBoundingClientRect();

      return rect.height > 0 && rect.top <= point.y && point.y <= rect.bottom;
    });

  const pick = pickByHorizontalBand(candidates, point.x);

  if (pick === null) {
    return null;
  }

  /**
   * The first matching container inside a wrapper is the wrapper's OWN child
   * container (a grandchild's container always sits deeper in document order —
   * same invariant hierarchy.setBlockParent relies on). Stop at table
   * wrappers: their first container is a cell, and cells resolve to the table.
   */
  const ownContainer = pick.querySelector(NESTED_CONTAINER_SELECTOR);
  const isOwnContainer = ownContainer !== null
    && !ownContainer.matches(CELL_BLOCKS_SELECTOR)
    && ownContainer.closest(BLOCK_WRAPPER_SELECTOR) === pick;
  const deeper = isOwnContainer ? descendToLineChild(ownContainer, point, depth + 1) : null;

  return deeper ?? pick;
}

/**
 * Disambiguates same-line candidates: side-by-side children (columns) all
 * contain the pointer's line, so the horizontal band tells them apart. The
 * gap between columns matches none — that is the resize affordance, and the
 * caller keeps the current anchor there.
 * @param candidates - direct-child wrappers whose vertical band contains the pointer
 * @param x - pointer client X
 */
function pickByHorizontalBand(candidates: Element[], x: number): Element | null {
  if (candidates.length <= 1) {
    return candidates[0] ?? null;
  }

  const byX = candidates.filter((el) => {
    const rect = el.getBoundingClientRect();

    return rect.left <= x && x <= rect.right;
  });

  return byX.length === 1 ? byX[0] : null;
}
