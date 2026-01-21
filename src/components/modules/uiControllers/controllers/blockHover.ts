import type { Block } from '../../../block';
import { BlockHovered } from '../../../events/BlockHovered';
import { throttle } from '../../../utils';
import { HOVER_ZONE_SIZE } from '../constants';

import { Controller } from './_base';

/**
 * BlockHoverController detects when user hovers over blocks, including extended hover zone.
 *
 * Responsibilities:
 * - Listen to mousemove events (throttled)
 * - Find block by element hit or extended zone
 * - Emit BlockHovered events
 * - Track last hovered block to avoid duplicate events
 */
export class BlockHoverController extends Controller {
  /**
   * Getter function for content rect
   */
  private contentRectGetter: () => DOMRect;

  /**
   * Whether the editor is in RTL mode
   */
  private isRtl: boolean;

  /**
   * Used to not emit the same block multiple times to the 'block-hovered' event on every mousemove.
   * Stores block ID to ensure consistent comparison regardless of how the block was detected.
   * Also stores the last hovered target element to support repositioning within the same block
   * (e.g., when hovering over different nested list items).
   */
  private blockHoveredState: { lastHoveredBlockId: string | null; lastHoveredTarget: Element | null } = {
    lastHoveredBlockId: null,
    lastHoveredTarget: null,
  };

  /**
   * Throttled block hover handler
   */
  private throttledHandleBlockHovered: ((...args: unknown[]) => unknown) | null = null;

  constructor(options: {
    config: Controller['config'];
    eventsDispatcher: Controller['eventsDispatcher'];
    contentRectGetter: () => DOMRect;
    isRtl: boolean;
  }) {
    super(options);
    this.contentRectGetter = options.contentRectGetter;
    this.isRtl = options.isRtl;
  }

  /**
   * Enable block hover detection
   */
  public override enable(): void {
    const handleBlockHoveredWrapper = (...args: unknown[]): unknown => {
      return this.handleBlockHovered(args[0] as Event);
    };

    this.throttledHandleBlockHovered = throttle(handleBlockHoveredWrapper, 20);

    /**
     * Listen on document to detect hover in the extended zone
     * which is outside the wrapper's bounds.
     * We filter events to only process those over the editor or in the hover zone.
     */
    this.readOnlyMutableListeners.on(document, 'mousemove', (event: Event) => {
      if (this.throttledHandleBlockHovered) {
        this.throttledHandleBlockHovered(event);
      }
    }, {
      passive: true,
    });

    /**
     * Also listen to mouseover events to catch programmatic hovers (e.g., from Playwright tests).
     * This is especially important for Firefox where programmatic hovers may not trigger mousemove.
     */
    this.readOnlyMutableListeners.on(document, 'mouseover', (event: Event) => {
      if (this.throttledHandleBlockHovered) {
        this.throttledHandleBlockHovered(event);
      }
    }, {
      passive: true,
    });
  }

  /**
   * Main handler for block hover detection
   */
  private handleBlockHovered(event: Event): void {
    if (typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent)) {
      return;
    }

    const hoveredBlockElement = (event.target as Element | null)?.closest('[data-blok-testid="block-wrapper"]');

    /**
     * If no block element found directly, try the extended hover zone
     */
    const zoneBlock = !hoveredBlockElement
      ? this.findBlockInHoverZone(event.clientX, event.clientY)
      : undefined;

    if (zoneBlock !== undefined && this.blockHoveredState.lastHoveredBlockId !== zoneBlock.id) {
      this.blockHoveredState.lastHoveredBlockId = zoneBlock.id;
      this.blockHoveredState.lastHoveredTarget = zoneBlock.holder;

      this.eventsDispatcher.emit(BlockHovered, {
        block: zoneBlock,
        target: zoneBlock.holder,
      });
    }

    if (zoneBlock !== undefined) {
      return;
    }

    if (!hoveredBlockElement) {
      return;
    }

    const block = this.Blok.BlockManager.getBlockByChildNode(hoveredBlockElement);

    if (!block) {
      return;
    }

    /**
     * Normalize the target to a meaningful element for comparison.
     * For nested elements like list items, we use the closest listitem or contenteditable element.
     * This ensures that hovering over different parts of the same list item (text, marker, etc.)
     * doesn't trigger unnecessary events, while hovering over different list items does.
     */
    const rawTarget = event.target as Element;
    const normalizedTarget = this.normalizeHoverTarget(rawTarget);

    /**
     * For multi-block selection, still emit 'block-hovered' event so toolbar can follow the hovered block.
     * The toolbar module will handle the logic of whether to move or not.
     *
     * Also emit if the normalized target element changes within the same block (e.g., nested list items).
     */
    const targetChanged = this.blockHoveredState.lastHoveredTarget !== normalizedTarget;

    if (this.blockHoveredState.lastHoveredBlockId === block.id && !targetChanged) {
      return;
    }

    this.blockHoveredState.lastHoveredBlockId = block.id;
    this.blockHoveredState.lastHoveredTarget = normalizedTarget;

    this.eventsDispatcher.emit(BlockHovered, {
      block,
      target: rawTarget,
    });
  }

  /**
   * Normalizes the hover target to a meaningful element for comparison.
   * This helps detect when the user moves to a different nested element (like a list item)
   * while avoiding false positives when moving between child elements.
   *
   * @param element - The raw target element from the event
   * @returns The normalized element for comparison
   */
  private normalizeHoverTarget(element: Element | null): Element | null {
    if (!element) {
      return null;
    }

    // For list items, use the closest listitem element as the normalized target
    const listItem = element.closest('[role="listitem"]');
    if (listItem) {
      return listItem;
    }

    // For contenteditable elements, use the contenteditable itself
    const contentEditable = element.closest('[contenteditable="true"]');
    if (contentEditable) {
      return contentEditable;
    }

    // For other elements, use the element itself
    return element;
  }

  /**
   * Finds a block by vertical position when cursor is in the extended hover zone.
   * The zone extends HOVER_ZONE_SIZE pixels from the content edge (left for LTR, right for RTL).
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in hover zone or no block found
   */
  private findBlockInHoverZone(clientX: number, clientY: number): Block | undefined {
    const contentRect = this.contentRectGetter();

    /**
     * For LTR: check if cursor is within hover zone to the left of content
     * For RTL: check if cursor is within hover zone to the right of content
     */
    const isInHoverZone = this.isRtl
      ? clientX > contentRect.right && clientX <= contentRect.right + HOVER_ZONE_SIZE
      : clientX < contentRect.left && clientX >= contentRect.left - HOVER_ZONE_SIZE;

    if (!isInHoverZone) {
      return undefined;
    }

    /**
     * Find block by Y position
     */
    for (const block of this.Blok.BlockManager.blocks) {
      const rect = block.holder.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return block;
      }
    }

    return undefined;
  }

  /**
   * Reset the last hovered block (useful for testing or state reset)
   */
  public resetHoverState(): void {
    this.blockHoveredState.lastHoveredBlockId = null;
    this.blockHoveredState.lastHoveredTarget = null;
  }
}
