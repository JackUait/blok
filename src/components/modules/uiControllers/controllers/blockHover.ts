import type { Block } from '../../../block';
import { BlockHovered } from '../../../events/BlockHovered';
import { throttle } from '../../../utils';
import { resolveHoveredBlockWrapper } from '../hovered-block-resolution';

import { Controller } from './_base';

/**
 * Every Blok instance binds its own document-level mousemove listener, so on a
 * page hosting several editors each one would resolve hover independently and
 * leave its plus/drag controls behind while the pointer sits in another editor.
 * This page-level registry lets an instance recognise that the pointer belongs
 * to a sibling editor and stand down, so the page behaves as if it hosted a
 * single editor. With one entry, arbitration is a no-op.
 */
const enabledHoverControllers = new Set<BlockHoverController>();

/**
 * BlockHoverController detects when user hovers over blocks or finds nearest block.
 *
 * Responsibilities:
 * - Listen to mousemove events (throttled)
 * - Find block by element hit or nearest by Y distance
 * - Emit BlockHovered events
 * - Track last hovered block to avoid duplicate events
 * - Arbitrate hover ownership against other editors on the same page
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
   * This editor's wrapper element, used to tell this instance's blocks apart
   * from those of other editors sharing the page.
   */
  private wrapperElement: HTMLElement | null = null;

  /**
   * Store the editor wrapper so hover ownership can be arbitrated between
   * editors on the same page.
   * @param wrapper - the instance's `[data-blok-editor]` element
   */
  public setWrapperElement(wrapper: HTMLElement): void {
    this.wrapperElement = wrapper;
  }

  /**
   * Enable block hover detection
   */
  public override enable(): void {
    if (this.isEnabled) {
      return;
    }

    this.isEnabled = true;
    enabledHoverControllers.add(this);
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

      /**
       * Blok's promoted floating chrome (link hover card, popovers, tooltips)
       * lives in document.body, outside any block-wrapper. When the pointer
       * rests on it, the closest-block lookup below fails and nearest-block
       * detection would "leak through" the popup, moving the block toolbar onto
       * whatever block sits behind it. Bail out so hovering our own floating UI
       * never drives block hover.
       */
      if ((event.target as Element | null)?.closest('[data-blok-top-layer]')) {
        return;
      }

      const closestBlockWrapper = (event.target as Element | null)?.closest('[data-blok-testid="block-wrapper"]');

      /**
       * The pointer is over a block of a different editor on this page. That
       * editor answers the hover; this one stands down so the page never shows
       * two sets of block controls at once.
       */
      if (closestBlockWrapper && this.belongsToAnotherEditor(closestBlockWrapper)) {
        this.yieldHoverToOtherEditor();

        return;
      }

      /**
       * The toolbar is what the pointer is traveling toward. Re-resolving from
       * under its icons is how the menu escapes the cursor, so hover detection
       * stands down entirely while the pointer is over it.
       */
      if ((event.target as Element | null)?.closest('[data-blok-testid="toolbar"]')) {
        return;
      }

      const resolution = resolveHoveredBlockWrapper(event.target as Element | null, {
        x: event.clientX,
        y: event.clientY,
      });

      /**
       * Pointer is in a container's own chrome with no block on that line —
       * the toolbar stays where it is.
       */
      if (resolution.kind === 'keep') {
        return;
      }

      const hoveredBlockElement = resolution.kind === 'block' ? resolution.wrapper : null;

      /**
       * If no block element found directly, find the nearest block by Y distance
       * but only if the cursor is within the extended hover zone (100px from content edges).
       */
      if (!hoveredBlockElement) {
        /**
         * Outside every block, the gutter/gap hover belongs to whichever editor
         * the pointer is closest to — only that one runs nearest-block detection.
         */
        if (!this.isNearestEditorToPointer(event.clientX, event.clientY)) {
          this.yieldHoverToOtherEditor();

          return;
        }

        this.emitNearestBlockHoveredInZone(event.clientX, event.clientY);

        return;
      }

      const block = this.Blok.BlockManager.getBlockByChildNode(hoveredBlockElement);

      if (!block) {
        return;
      }

      /**
       * Columns are structural containers, not selectable blocks. Skip the
       * event so neither the column nor its column_list ever gets a toolbar —
       * only the blocks inside a column are selectable (Notion-style).
       */
      if (BlockHoverController.isColumnContainer(block)) {
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
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private emitNearestBlockHovered(clientX: number, clientY: number): void {
    const nearestBlock = this.findNearestBlock(clientX, clientY);

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
   * Columns are structural containers, not independent blocks: neither a
   * `column` nor its `column_list` may own a drag handle, settings menu, or
   * "convert to" option. Only the blocks inside a column are selectable.
   * @param block - a hovered or candidate block
   * @returns true when the block is a column layout container
   */
  private static isColumnContainer(block: Block): boolean {
    return block.name === 'column' || block.name === 'column_list';
  }

  /**
   * Emits a BlockHovered event for the nearest block, but only if the cursor
   * is within the extended hover zone (HOVER_ZONE_SIZE px from content edges).
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private emitNearestBlockHoveredInZone(clientX: number, clientY: number): void {
    const blocks = this.Blok.BlockManager.blocks;
    /**
     * Only the ZONE ANCHOR must be a top-level block — its content element
     * spans the full editor column, while a nested child's is indented and
     * would shrink the zone. findNearestBlock itself considers nested blocks.
     */
    const topLevelBlocks = blocks.filter(block =>
      !BlockHoverController.isColumnContainer(block)
      && block.holder.closest('[data-blok-table-cell-blocks], [data-blok-toggle-children]') === null
    );

    if (topLevelBlocks.length === 0) {
      return;
    }

    const contentEl = topLevelBlocks[0].holder.querySelector<HTMLElement>('[data-blok-element-content]');

    if (!contentEl) {
      this.emitNearestBlockHovered(clientX, clientY);

      return;
    }

    const contentRect = contentEl.getBoundingClientRect();

    /**
     * The zone spans the whole content column plus HOVER_ZONE_SIZE on each
     * side. Comparing absolute distance to each edge instead would exclude
     * cursors inside a column wider than 2×HOVER_ZONE_SIZE (e.g. hovering
     * below all blocks at the column's horizontal center).
     */
    const withinZone = clientX >= contentRect.left - BlockHoverController.HOVER_ZONE_SIZE
      && clientX <= contentRect.right + BlockHoverController.HOVER_ZONE_SIZE;

    if (withinZone) {
      this.emitNearestBlockHovered(clientX, clientY);
    }
  }

  /**
   * Finds the block whose line the cursor is on, resolved to the deepest
   * candidate — a container's holder spans all of its children, so depth is
   * what tells the specific line apart from the whole section. When no block's
   * band contains the cursor, falls back to the vertically nearest edge.
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Nearest block, or null if no blocks exist
   */
  private findNearestBlock(clientX: number, clientY: number): Block | null {
    const blocks = this.Blok.BlockManager.blocks;

    /**
     * Column wrappers are structural, cell blocks anchor their table (which is
     * itself a candidate), and hidden blocks (collapsed toggle children) have
     * zero-size rects that would otherwise win near the viewport origin.
     */
    const candidates = blocks
      .map(block => ({ block, rect: block.holder.getBoundingClientRect() }))
      .filter(({ block, rect }) =>
        !BlockHoverController.isColumnContainer(block)
        && block.holder.closest('[data-blok-table-cell-blocks]') === null
        && rect.width > 0
        && rect.height > 0
      );

    if (candidates.length === 0) {
      return null;
    }

    const containing = candidates.filter(({ rect }) => rect.top <= clientY && clientY <= rect.bottom);

    if (containing.length > 0) {
      const best = containing.reduce((nearest, candidate) => {
        const depthDelta = BlockHoverController.wrapperDepth(candidate.block.holder)
          - BlockHoverController.wrapperDepth(nearest.block.holder);

        if (depthDelta !== 0) {
          return depthDelta > 0 ? candidate : nearest;
        }

        /**
         * Equally deep blocks on the same line sit in side-by-side columns —
         * the horizontally nearest one owns the margin hover.
         */
        const horizontalDistance = (rect: DOMRect): number =>
          Math.max(rect.left - clientX, 0, clientX - rect.right);

        return horizontalDistance(candidate.rect) < horizontalDistance(nearest.rect) ? candidate : nearest;
      });

      return best.block;
    }

    const result = candidates.reduce((nearest, candidate) => {
      const edgeDistance = (rect: DOMRect): number => Math.max(rect.top - clientY, 0, clientY - rect.bottom);

      return edgeDistance(candidate.rect) < edgeDistance(nearest.rect) ? candidate : nearest;
    });

    return result.block;
  }

  /**
   * How many block wrappers sit above this holder — 0 for a top-level block.
   * @param holder - the block's holder element
   */
  private static wrapperDepth(holder: Element): number {
    const ancestor = holder.parentElement?.closest('[data-blok-testid="block-wrapper"]') ?? null;

    return ancestor === null ? 0 : 1 + BlockHoverController.wrapperDepth(ancestor);
  }

  /**
   * Whether the given element lives inside a different editor that is also
   * listening for hover on this page.
   * @param element - element under the pointer
   */
  private belongsToAnotherEditor(element: Element): boolean {
    if (this.wrapperElement?.contains(element) === true) {
      return false;
    }

    for (const controller of enabledHoverControllers) {
      if (controller !== this && controller.wrapperElement?.contains(element) === true) {
        return true;
      }
    }

    return false;
  }

  /**
   * Whether this editor is the closest one to the pointer among the editors
   * listening on this page. A lone editor always wins, so single-editor pages
   * keep their existing nearest-block behaviour.
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private isNearestEditorToPointer(clientX: number, clientY: number): boolean {
    if (this.wrapperElement === null || enabledHoverControllers.size < 2) {
      return true;
    }

    const ownDistance = BlockHoverController.distanceToElement(this.wrapperElement, clientX, clientY);

    /**
     * Side-by-side editors can sit exactly the same distance from the pointer.
     * The registry preserves registration order, so ties go to the editor
     * registered first — otherwise both would claim the pointer and the page
     * would again show two sets of controls.
     */
    const controllers = [...enabledHoverControllers];
    const ownIndex = controllers.indexOf(this);

    return controllers.every((controller, index) => {
      if (index === ownIndex || controller.wrapperElement === null) {
        return true;
      }

      const distance = BlockHoverController.distanceToElement(controller.wrapperElement, clientX, clientY);

      return distance > ownDistance || (distance === ownDistance && index > ownIndex);
    });
  }

  /**
   * Distance from the pointer to an element's box, zero when the pointer is
   * inside it.
   * @param element - element to measure against
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   */
  private static distanceToElement(element: HTMLElement, clientX: number, clientY: number): number {
    const rect = element.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);

    return Math.hypot(dx, dy);
  }

  /**
   * Hand the pointer over to another editor: drop this editor's block controls
   * so only one set is visible on the page. Menus the user opened here stay put
   * — moving the pointer away must not dismiss them.
   */
  private yieldHoverToOtherEditor(): void {
    this.blockHoveredState.lastHoveredBlockId = null;

    const { Toolbar, BlockSettings, InlineToolbar, DragManager } = this.Blok;

    if (!Toolbar.opened) {
      return;
    }

    /**
     * A menu the user opened here, or a drag in flight, outranks the pointer:
     * walking over a sibling editor must not dismiss them.
     */
    const isBusy = BlockSettings.opened
      || BlockSettings.isOpening
      || InlineToolbar.opened
      || Toolbar.toolbox.opened === true
      || DragManager.isDragging;

    if (isBusy) {
      return;
    }

    Toolbar.close();
  }

  /**
   * Disable the controller and clear its listeners.
   */
  public override disable(): void {
    super.disable();
    this.isEnabled = false;
    enabledHoverControllers.delete(this);
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
