import type { Block } from '../../../block';
import { BlockHovered } from '../../../events/BlockHovered';
import { throttle } from '../../../utils';

import { Controller } from './_base';

/**
 * BlockHoverController detects when user hovers over blocks or finds nearest block.
 *
 * Responsibilities:
 * - Listen to mousemove events (throttled)
 * - Find block by element hit or nearest by Y distance
 * - Emit BlockHovered events
 * - Track last hovered block to avoid duplicate events
 */
export class BlockHoverController extends Controller {
  /**
   * Used to not emit the same block multiple times to the 'block-hovered' event on every mousemove.
   * Stores block ID to ensure consistent comparison regardless of how the block was detected.
   */
  private blockHoveredState: { lastHoveredBlockId: string | null } = {
    lastHoveredBlockId: null,
  };

  /**
   * Timestamp when hover detection was temporarily disabled.
   * Used to prevent spurious hover events after operations like cross-block selection.
   */
  private hoverDisabledUntil: number = 0;

  /**
   * Duration in milliseconds to suppress hover events after being disabled.
   * This accounts for throttled mousemove events that may still be in the queue.
   */
  private static readonly HOVER_COOLDOWN_MS = 50;

  /**
   * Maximum horizontal distance from content edges for extended hover zone.
   * When cursor is within this distance of the content area, nearest-block
   * detection activates. Beyond this distance, no hover event is emitted.
   */
  private static readonly HOVER_ZONE_SIZE = 100;

  constructor(options: {
    config: Controller['config'];
    eventsDispatcher: Controller['eventsDispatcher'];
  }) {
    super(options);
  }

  /**
   * Whether the controller's listeners are currently bound. Used to make
   * enable() idempotent so repeated calls (e.g. during read-only toggling)
   * do not register the mousemove handler multiple times.
   */
  private isEnabled: boolean = false;

  /**
   * Enable block hover detection
   */
  public override enable(): void {
    if (this.isEnabled) {
      return;
    }

    this.isEnabled = true;
    /**
     * Local function that handles block hover detection
     * Bound to 'this' to preserve context when passed to throttle
     */
    const handleBlockHovered = (event: Event): void => {
      if (typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent)) {
        return;
      }

      /**
       * Skip hover detection during cooldown period.
       * This prevents spurious hover events from being emitted after operations
       * like cross-block selection, where throttled mousemove events may still
       * be in the event queue.
       */
      if (Date.now() < this.hoverDisabledUntil) {
        return;
      }

      const closestBlockWrapper = (event.target as Element | null)?.closest('[data-blok-testid="block-wrapper"]');

      /**
       * When the cursor is in the gap between children inside a [data-blok-child-toolbar]
       * container, the closest block-wrapper is the parent — not a child.
       * Skip the event so the toolbar stays on the previous child block.
       */
      const targetChildToolbar = (event.target as Element | null)?.closest('[data-blok-child-toolbar]');

      if (targetChildToolbar && closestBlockWrapper && !targetChildToolbar.contains(closestBlockWrapper)) {
        return;
      }

      /**
       * If the hovered block is inside a table cell or toggle-children container,
       * resolve to the parent block instead.
       * Without this, the toolbar targets nested child blocks and the parent's
       * block tune settings become inaccessible.
       *
       * Containers with [data-blok-child-toolbar] opt out of parent resolution,
       * allowing non-first children to have independent toolbars (e.g. callout blocks).
       * The first child still resolves to parent so the container's own controls display.
       */
      const alwaysResolveContainer = closestBlockWrapper?.closest(
        '[data-blok-table-cell-blocks], [data-blok-toggle-children]:not([data-blok-child-toolbar])'
      );
      const childToolbarContainer = !alwaysResolveContainer
        ? closestBlockWrapper?.closest('[data-blok-child-toolbar]') ?? null
        : null;
      const isFirstChildOfContainer = childToolbarContainer !== null
        && childToolbarContainer.querySelector(':scope > [data-blok-testid="block-wrapper"]') === closestBlockWrapper;

      const nestedContainer = alwaysResolveContainer
        ?? (isFirstChildOfContainer ? childToolbarContainer : null);
      const hoveredBlockElement = nestedContainer
        ? nestedContainer.closest('[data-blok-testid="block-wrapper"]') ?? null
        : closestBlockWrapper;

      /**
       * If no block element found directly, find the nearest block by Y distance
       * but only if the cursor is within the extended hover zone (100px from content edges).
       */
      if (!hoveredBlockElement) {
        this.emitNearestBlockHoveredInZone(event.clientX, event.clientY);

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
     * Listen on document to detect hover anywhere on the page.
     * When cursor is not directly on a block, finds the nearest block by Y distance.
     */
    this.readOnlyMutableListeners.on(document, 'mousemove', (event: Event) => {
      throttledHandleBlockHovered(event);
    }, {
      passive: true,
    });
  }

  /**
   * Finds and emits a BlockHovered event for the nearest block by Y distance.
   * Deduplicates by lastHoveredBlockId to avoid redundant events.
   * @param clientY - Cursor Y position
   */
  private emitNearestBlockHovered(clientY: number): void {
    const nearestBlock = this.findNearestBlock(clientY);

    if (nearestBlock === null || this.blockHoveredState.lastHoveredBlockId === nearestBlock.id) {
      return;
    }

    this.blockHoveredState.lastHoveredBlockId = nearestBlock.id;

    this.eventsDispatcher.emit(BlockHovered, {
      block: nearestBlock,
      target: nearestBlock.holder,
    });
  }

  /**
   * Emits a BlockHovered event for the nearest block, but only if the cursor
   * is within the extended hover zone (HOVER_ZONE_SIZE px from content edges).
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private emitNearestBlockHoveredInZone(clientX: number, clientY: number): void {
    const blocks = this.Blok.BlockManager.blocks;
    const topLevelBlocks = blocks.filter(block =>
      block.holder.closest('[data-blok-table-cell-blocks], [data-blok-toggle-children]') === null
    );

    if (topLevelBlocks.length === 0) {
      return;
    }

    const contentEl = topLevelBlocks[0].holder.querySelector<HTMLElement>('[data-blok-element-content]');

    if (!contentEl) {
      this.emitNearestBlockHovered(clientY);

      return;
    }

    const contentRect = contentEl.getBoundingClientRect();
    const distLeft = Math.abs(clientX - contentRect.left);
    const distRight = Math.abs(clientX - contentRect.right);
    const withinZone = distLeft <= BlockHoverController.HOVER_ZONE_SIZE
      || distRight <= BlockHoverController.HOVER_ZONE_SIZE;

    if (withinZone) {
      this.emitNearestBlockHovered(clientY);
    }
  }

  /**
   * Finds the nearest block by vertical distance to cursor position.
   * Returns the block whose vertical center is closest to the cursor Y position.
   * If cursor is above all blocks, returns the first block.
   * If cursor is below all blocks, returns the last block.
   * @param clientY - Cursor Y position
   * @returns Nearest block, or null if no blocks exist
   */
  private findNearestBlock(clientY: number): Block | null {
    const blocks = this.Blok.BlockManager.blocks;

    if (blocks.length === 0) {
      return null;
    }

    /**
     * Filter out blocks whose holders are inside a table cell or toggle-children container.
     * Nested child blocks should not participate in nearest-block detection —
     * the parent block should be found instead.
     * This matches the direct-hit path which also resolves nested blocks to their parent.
     */
    const topLevelBlocks = blocks.filter(block =>
      block.holder.closest('[data-blok-table-cell-blocks], [data-blok-toggle-children]') === null
    );

    if (topLevelBlocks.length === 0) {
      return null;
    }

    const result = topLevelBlocks.reduce<{ block: Block; distance: number }>((nearest, block) => {
      const rect = block.holder.getBoundingClientRect();
      const centerY = (rect.top + rect.bottom) / 2;
      const distance = Math.abs(clientY - centerY);

      return distance < nearest.distance ? { block, distance } : nearest;
    }, { block: topLevelBlocks[0], distance: Infinity });

    return result.block;
  }

  /**
   * Disable the controller and clear its listeners.
   */
  public override disable(): void {
    super.disable();
    this.isEnabled = false;
  }

  /**
   * Reset the last hovered block (useful for testing or state reset)
   */
  public resetHoverState(): void {
    this.blockHoveredState.lastHoveredBlockId = null;
  }

  /**
   * Temporarily disable hover detection for a short cooldown period.
   * This should be called after operations like cross-block selection to prevent
   * spurious hover events from throttled mousemove events that may still be in the queue.
   */
  public disableHoverForCooldown(): void {
    this.hoverDisabledUntil = Date.now() + BlockHoverController.HOVER_COOLDOWN_MS;
  }
}
