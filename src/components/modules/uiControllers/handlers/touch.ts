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
    const block = deps.Blok.BlockManager.setCurrentBlockByChildNode(clickedNode);

    /**
     * If clicked outside first-level Blocks and it is not RectSelection, set Caret to the last empty Block
     */
    if (!block && !deps.Blok.RectangleSelection.isRectActivated()) {
      deps.Blok.Caret.setToTheLastBlock();
    }

    /**
     * If the click landed below the last block's content area (in the holder padding zone),
     * create/focus a new paragraph instead of keeping the block selected.
     */
    const isBelowLastBlock = block !== undefined
      && block === deps.Blok.BlockManager.lastBlock
      && isClickBelowLastBlockContent(block.holder, event);

    if (isBelowLastBlock && !deps.Blok.ReadOnly.isEnabled) {
      deps.Blok.Caret.setToTheLastBlock();
      deps.Blok.Toolbar.moveAndOpen(deps.Blok.BlockManager.lastBlock);

      return;
    }

    if (isBelowLastBlock) {
      deps.Blok.Caret.setToTheLastBlock();

      return;
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

/**
 * Extracts the clientY coordinate from a mouse or touch event
 *
 * @param event - The event to extract clientY from
 * @returns The clientY value, or null if not available
 */
const getClientY = (event: Event): number | null => {
  if (event instanceof MouseEvent) {
    return event.clientY;
  }

  if (event instanceof TouchEvent && event.touches.length > 0) {
    return event.touches[0].clientY;
  }

  return null;
}

/**
 * Checks whether a click event landed below a block's content area.
 * Used to detect clicks in the holder padding zone below the last block.
 *
 * @param blockHolder - The block's holder element
 * @param event - The mouse or touch event
 * @returns True if the click was below the block content's bottom edge
 */
const isClickBelowLastBlockContent = (
  blockHolder: HTMLElement,
  event: Event
): boolean => {
  const clientY = getClientY(event);

  if (clientY === null) {
    return false;
  }

  const contentEl = blockHolder.querySelector('[data-blok-element-content]');
  const contentRect = contentEl?.getBoundingClientRect();

  return contentRect !== undefined && clientY > contentRect.bottom;
};
