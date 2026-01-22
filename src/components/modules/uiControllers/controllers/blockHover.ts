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
   */
  private blockHoveredState: { lastHoveredBlockId: string | null } = {
    lastHoveredBlockId: null,
  };

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
        this.blockHoveredState.lastHoveredBlockId = zoneBlock.id;

        this.eventsDispatcher.emit(BlockHovered, {
          block: zoneBlock,
          target: zoneBlock.holder,
        });
      }

      if (zoneBlock !== null) {
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
   * Finds a block by vertical position when cursor is in the extended hover zone.
   * The zone extends HOVER_ZONE_SIZE pixels from the content edge (left for LTR, right for RTL).
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in hover zone or no block found
   */
  private findBlockInHoverZone(clientX: number, clientY: number): Block | null {
    const contentRect = this.contentRectGetter();

    /**
     * For LTR: check if cursor is within hover zone to the left of content
     * For RTL: check if cursor is within hover zone to the right of content
     */
    const isInHoverZone = this.isRtl
      ? clientX > contentRect.right && clientX <= contentRect.right + HOVER_ZONE_SIZE
      : clientX < contentRect.left && clientX >= contentRect.left - HOVER_ZONE_SIZE;

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
