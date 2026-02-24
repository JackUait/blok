import type { BlokModules } from '../../../../types-internal/blok-modules';

/**
 * Dependencies for the redactor touch handler
 */
export interface RedactorTouchHandlerDependencies {
  Blok: BlokModules;
  redactorElement: HTMLElement;
}

/**
 * Creates a redactor touch handler (also handles mousedown as "touch")
 *
 * Event listener for 'mousedown' and 'touchstart' events
 *
 * Responsibilities:
 * - Change current block on touch
 * - Move and open toolbar
 * - Handle clicks on wrapper using elementFromPoint
 *
 * @param deps - Dependencies including Blok modules and DOM elements
 * @returns Event handler function for redactor touch events
 */
export const createRedactorTouchHandler = (
  deps: RedactorTouchHandlerDependencies
): ((event: Event) => void) => {
  return (event: Event): void => {
    const initialTarget = event.target as HTMLElement;

    /**
     * If click was fired on Blok`s wrapper, try to get clicked node by elementFromPoint method
     */
    const clickedNode = getClickedNode(initialTarget, event, deps.redactorElement);

    /**
     * Select clicked Block as Current
     */
    try {
      deps.Blok.BlockManager.setCurrentBlockByChildNode(clickedNode);
    } catch (_e) {
      /**
       * If clicked outside first-level Blocks and it is not RectSelection, set Caret to the last empty Block
       */
      if (!deps.Blok.RectangleSelection.isRectActivated()) {
        deps.Blok.Caret.setToTheLastBlock();
      }
    }

    /**
     * Move and open toolbar
     * (used for showing Block Settings toggler after opening and closing Inline Toolbar)
     */
    if (!deps.Blok.ReadOnly.isEnabled && !deps.Blok.Toolbar.contains(initialTarget)) {
      /**
       * When the clicked node is inside a table cell, resolve to the parent table block
       * so moveAndOpen receives the table block (not undefined / the inner cell paragraph).
       * Without this, moveAndOpen falls back to currentBlock (the cell paragraph), detects
       * it's inside a table cell, and hides the plus button and settings toggler.
       */
      const tableCellContainer = clickedNode.closest?.('[data-blok-table-cell-blocks]');
      const tableBlockWrapper = tableCellContainer?.closest('[data-blok-testid="block-wrapper"]');
      const resolvedBlock = tableBlockWrapper
        ? deps.Blok.BlockManager.getBlockByChildNode(tableBlockWrapper)
        : undefined;

      deps.Blok.Toolbar.moveAndOpen(resolvedBlock, clickedNode);
    }
  };
}

/**
 * Gets the actual clicked node, handling the case where the target is the redactor itself
 *
 * If the click was fired on Blok's wrapper, we try to get the clicked node by elementFromPoint method
 *
 * @param initialTarget - The initial event target
 * @param event - The touch or mouse event
 * @param redactorElement - The redactor DOM element
 * @returns The actual clicked node
 */
export const getClickedNode = (
  initialTarget: HTMLElement,
  event: Event,
  redactorElement: HTMLElement
): HTMLElement => {
  /**
   * If click was fired on Blok`s wrapper, try to get clicked node by elementFromPoint method
   */
  if (initialTarget !== redactorElement) {
    return initialTarget;
  }

  if (event instanceof MouseEvent) {
    const nodeFromPoint = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

    return nodeFromPoint ?? initialTarget;
  }

  if (event instanceof TouchEvent && event.touches.length > 0) {
    const { clientX, clientY } = event.touches[0];
    const nodeFromPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

    return nodeFromPoint ?? initialTarget;
  }

  return initialTarget;
}
