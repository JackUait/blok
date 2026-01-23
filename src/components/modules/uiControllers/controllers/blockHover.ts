import type { Block } from '../../../block';
import { BlockHovered } from '../../../events/BlockHovered';
import { throttle } from '../../../utils';

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
   * Used to not emit the same block multiple times to the 'block-hovered' event on every mousemove.
   * Stores block ID to ensure consistent comparison regardless of how the block was detected.
   */
  private blockHoveredState: { lastHoveredBlockId: string | null } = {
    lastHoveredBlockId: null,
  };

  constructor(options: {
    config: Controller['config'];
    eventsDispatcher: Controller['eventsDispatcher'];
    contentRectGetter: () => DOMRect;
  }) {
    super(options);
    this.contentRectGetter = options.contentRectGetter;
  }

  /**
   * Enable block hover detection
   */
  public override enable(): void {
    /**
     * Local function that handles block hover detection
     * Bound to 'this' to preserve context when passed to throttle
     */
    const handleBlockHovered = (event: Event): void => {
      if (typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent)) {
        return;
      }

      const hoveredBlockElement = (event.target as Element | null)?.closest('[data-blok-testid="block-wrapper"]');

      /**
       * If no block element found directly, try the extended hover zone
       */
      const zoneBlock = !hoveredBlockElement
        ? this.findBlockInHoverZone(event.clientX, event.clientY)
        : null;

      if (zoneBlock !== null && this.blockHoveredState.lastHoveredBlockId !== zoneBlock.id) {
        /**
         * Emit the event but DON'T set lastHoveredBlockId for hover zone events.
         * This allows the event to be emitted again when the mouse enters the actual block element,
         * which is important for proper toolbar positioning after cross-block selection.
         */
        this.eventsDispatcher.emit(BlockHovered, {
          block: zoneBlock,
          target: zoneBlock.holder,
        });
      }

      if (zoneBlock !== null) {
        return;
      }

      if (!hoveredBlockElement) {
        /**
         * When no block is found (mouse left the editor area), reset the hover state.
         * This allows hover events to be emitted again when re-entering a block,
         * which is important after cross-block selection completes.
         */
        this.blockHoveredState.lastHoveredBlockId = null;
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
    };

    const throttledHandleBlockHovered = throttle(
      handleBlockHovered as (...args: unknown[]) => unknown,
      20
    );

    /**
     * Listen on document to detect hover in the extended zone
     * which is outside the wrapper's bounds.
     * We filter events to only process those over the editor or in the hover zone.
     */
    this.readOnlyMutableListeners.on(document, 'mousemove', (event: Event) => {
      throttledHandleBlockHovered(event);
    }, {
      passive: true,
    });
  }

  /**
   * Finds a block by vertical position when cursor is in the hover zone.
   * The hover zone extends indefinitely on both sides of the content (left and right),
   * allowing the toolbar to follow hover anywhere outside the content area horizontally.
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in hover zone or no block found
   */
  private findBlockInHoverZone(clientX: number, clientY: number): Block | null {
    const contentRect = this.contentRectGetter();

    /**
     * Check if cursor is outside the content area horizontally (either left OR right side).
     * The zone extends indefinitely on both sides, not limited to HOVER_ZONE_SIZE.
     */
    const isInHoverZone = clientX < contentRect.left || clientX > contentRect.right;

    if (!isInHoverZone) {
      return null;
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

    return null;
  }

  /**
   * Reset the last hovered block (useful for testing or state reset)
   */
  public resetHoverState(): void {
    this.blockHoveredState.lastHoveredBlockId = null;
  }
}
