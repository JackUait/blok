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

    // Handle hover zone case
    if (zoneBlock !== undefined) {
      this.handleHoverZoneBlockHovered(zoneBlock, event.clientY);

      return;
    }

    // Handle direct hover case
    if (!hoveredBlockElement) {
      return;
    }

    const block = this.Blok.BlockManager.getBlockByChildNode(hoveredBlockElement);

    if (!block) {
      return;
    }

    /**
     * For multi-block selection, still emit 'block-hovered' event so toolbar can follow the hovered block.
     * The toolbar module will handle the logic of whether to move or not.
     */
    if (this.blockHoveredState.lastHoveredBlockId === block.id) {
      return;
    }

    this.blockHoveredState.lastHoveredBlockId = block.id;

    this.eventsDispatcher.emit(BlockHovered, {
      block,
      target: event.target as Element,
    });
  }

  /**
   * Handles block hover when cursor is in the extended hover zone.
   * Finds the specific list item at the cursor's Y position for accurate toolbar positioning.
   * @param zoneBlock - The block found in the hover zone
   * @param clientY - The cursor Y position
   */
  private handleHoverZoneBlockHovered(zoneBlock: Block, clientY: number): void {
    // When in hover zone, find the specific list item at the cursor's Y position
    // This allows the toolbar to correctly calculate content offset based on the actual hovered item
    const listItemTarget = this.findListItemAtPosition(zoneBlock.holder, clientY);
    const target = listItemTarget || zoneBlock.holder;

    // Skip if neither block nor target changed
    const blockChanged = this.blockHoveredState.lastHoveredBlockId !== zoneBlock.id;
    const targetChanged = this.blockHoveredState.lastHoveredTarget !== target;

    if (!blockChanged && !targetChanged) {
      return;
    }

    this.blockHoveredState.lastHoveredBlockId = zoneBlock.id;
    this.blockHoveredState.lastHoveredTarget = target;

    this.eventsDispatcher.emit(BlockHovered, {
      block: zoneBlock,
      target,
    });
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
   * Finds the list item element at the given Y position within a block holder.
   * Used when hovering in the extended hover zone to determine which list item
   * the cursor is aligned with, so the toolbar can correctly calculate content offset.
   * @param blockHolder - The block holder element to search within
   * @param clientY - The cursor Y position
   * @returns The list item element at the Y position, or null if not found
   */
  private findListItemAtPosition(blockHolder: HTMLElement, clientY: number): Element | null {
    const listItems = Array.from(blockHolder.querySelectorAll('[role="listitem"]'));

    if (listItems.length === 0) {
      return null;
    }

    // Find the list item whose vertical range contains the cursor Y position
    for (const item of listItems) {
      const rect = item.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return item;
      }
    }

    // Fallback: return the first list item
    return listItems[0];
  }

  /**
   * Reset the last hovered block (useful for testing or state reset)
   */
  public resetHoverState(): void {
    this.blockHoveredState.lastHoveredBlockId = null;
    this.blockHoveredState.lastHoveredTarget = null;
  }
}
