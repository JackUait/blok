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
       * When the clicked node is inside a table cell or toggle-children container,
       * resolve to the parent block so moveAndOpen receives the correct parent block.
       * Without this, moveAndOpen falls back to currentBlock (the nested child),
       * and the parent's block tune settings become inaccessible.
       *
       * For child-toolbar containers (e.g. callout), the first child still resolves
       * to the parent so the container's own controls (settings, drag) are accessible.
       * Non-first children keep their own toolbar via the block argument being undefined.
       */
      const alwaysResolve = clickedNode.closest?.('[data-blok-table-cell-blocks], [data-blok-toggle-children]:not([data-blok-child-toolbar])');
      const childToolbar = !alwaysResolve
        ? clickedNode.closest?.('[data-blok-child-toolbar]') ?? null
        : null;
      const closestBlockWrapper = clickedNode.closest?.('[data-blok-testid="block-wrapper"]') ?? null;
      const isFirstChild = childToolbar !== null
        && closestBlockWrapper !== null
        && childToolbar.querySelector(':scope > [data-blok-testid="block-wrapper"]') === closestBlockWrapper;
      const nestedContainer = alwaysResolve ?? (isFirstChild ? childToolbar : null);
      const parentBlockWrapper = nestedContainer?.closest('[data-blok-testid="block-wrapper"]');
      const resolvedBlock = parentBlockWrapper
        ? deps.Blok.BlockManager.getBlockByChildNode(parentBlockWrapper)
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

    return resolveGutterHitToRow(nodeFromPoint ?? initialTarget, event.clientY, redactorElement);
  }

  if (event instanceof TouchEvent && event.touches.length > 0) {
    const { clientX, clientY } = event.touches[0];
    const nodeFromPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

    return resolveGutterHitToRow(nodeFromPoint ?? initialTarget, clientY, redactorElement);
  }

  return initialTarget;
}

/**
 * Resolves a hit on the redactor itself to the block row at that Y position.
 *
 * The redactor reserves an inline gutter (--blok-editor-gutter-start/-end
 * padding housing the floating +/⠿ controls), so a pointer-down in the gutter
 * lands on the redactor element even though it sits directly beside a block
 * row. That gutter belongs to the row: before the gutter moved into redactor
 * padding, block holders reached the editor edge and the same pointer-down hit
 * the block itself. Re-probe at the redactor's horizontal center at the same Y
 * (mirroring RectangleSelection.genInfoForMouseSelection) so gutter clicks
 * resolve to their row instead of being treated as "outside all blocks" (which
 * would move the caret to the last block and clear any block selection).
 *
 * @param node - the node the pointer probe resolved to
 * @param clientY - viewport Y coordinate of the pointer
 * @param redactorElement - the redactor DOM element
 * @returns the block-row element at the same Y, or the original node
 */
const resolveGutterHitToRow = (
  node: HTMLElement,
  clientY: number,
  redactorElement: HTMLElement
): HTMLElement => {
  if (node !== redactorElement) {
    return node;
  }

  const redactorRect = redactorElement.getBoundingClientRect();
  const centerProbe = document.elementFromPoint(
    redactorRect.left + redactorRect.width / 2,
    clientY
  ) as HTMLElement | null;

  if (centerProbe !== null && centerProbe !== redactorElement && redactorElement.contains(centerProbe)) {
    return centerProbe;
  }

  return node;
};

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
