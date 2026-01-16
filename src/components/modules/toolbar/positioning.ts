import type { Block } from '../../block';
import type { PositioningOptions, ToolbarNodes } from './types';
import { POSITION_TOLERANCE } from './constants';

/**
 * ToolbarPositioner handles toolbar positioning calculations and movements.
 * Calculates Y position, moves toolbar, applies content offset, and repositions on block changes.
 */
export class ToolbarPositioner {
  /**
   * Last calculated toolbar Y position
   * Used to avoid unnecessary repositioning when the position hasn't changed
   */
  private lastToolbarY: number | null = null;

  /**
   * The actual element being hovered (could be a nested element like a list item)
   */
  private hoveredTarget: Element | null = null;

  /**
   * Gets the current last toolbar Y position
   */
  public get lastY(): number | null {
    return this.lastToolbarY;
  }

  /**
   * Gets the current hovered target element
   */
  public get target(): Element | null {
    return this.hoveredTarget;
  }

  /**
   * Sets the hovered target element
   */
  public setHoveredTarget(target: Element | null): void {
    this.hoveredTarget = target;
  }

  /**
   * Resets the cached toolbar Y position
   */
  public resetCachedPosition(): void {
    this.lastToolbarY = null;
  }

  /**
   * Calculates the Y position for the toolbar, centered on the first line of the block
   * @param options - Positioning options containing target block, hovered target, and mobile state
   * @param plusButton - The plus button element (used to get toolbar height)
   * @returns the Y position in pixels, or null if calculation is not possible
   */
  public calculateToolbarY(
    options: PositioningOptions,
    plusButton: HTMLElement
  ): number | null {
    const { targetBlock, hoveredTarget, isMobile } = options;

    if (!targetBlock || !plusButton) {
      return null;
    }

    const targetBlockHolder = targetBlock.holder;
    const holderRect = targetBlockHolder.getBoundingClientRect();

    /**
     * Use the hovered target element (e.g., a nested list item) if available,
     * otherwise fall back to the block's pluginsContent
     */
    const listItemElement = hoveredTarget?.closest('[role="listitem"]');
    /**
     * For list items, find the actual text content element ([contenteditable]) and use its position
     * to properly center the toolbar on the text, not on the marker which may have different font-size
     */
    const textElement = listItemElement?.querySelector('[contenteditable]');
    const contentElement = textElement ?? listItemElement ?? targetBlock.pluginsContent;
    const contentRect = contentElement.getBoundingClientRect();
    const contentOffset = contentRect.top - holderRect.top;

    const contentStyle = window.getComputedStyle(contentElement);
    const contentPaddingTop = parseInt(contentStyle.paddingTop, 10) || 0;
    const lineHeight = parseFloat(contentStyle.lineHeight) || 24;
    const toolbarHeight = parseInt(window.getComputedStyle(plusButton).height, 10);

    if (isMobile) {
      return contentOffset - toolbarHeight;
    }

    const firstLineTop = contentOffset + contentPaddingTop;
    const firstLineCenterY = firstLineTop + (lineHeight / 2);

    return firstLineCenterY - (toolbarHeight / 2);
  }

  /**
   * Moves the toolbar to the specified Y position
   * @param nodes - Toolbar nodes containing wrapper element
   * @param toolbarY - The Y position to move to
   * @returns the new Y position, or null if movement failed
   */
  public moveToY(nodes: ToolbarNodes, toolbarY: number): number | null {
    const { wrapper } = nodes;

    if (!wrapper) {
      return null;
    }

    const newToolbarY = Math.floor(toolbarY);
    this.lastToolbarY = newToolbarY;
    wrapper.style.top = `${newToolbarY}px`;

    return newToolbarY;
  }

  /**
   * Repositions the toolbar to stay centered on the first line of the current block
   * without closing/opening toolbox or block settings
   * @param nodes - Toolbar nodes
   * @param options - Positioning options
   * @param plusButton - The plus button element
   * @returns true if position changed, false otherwise
   */
  public repositionToolbar(
    nodes: ToolbarNodes,
    options: PositioningOptions,
    plusButton: HTMLElement
  ): boolean {
    const { wrapper } = nodes;

    if (!wrapper || !plusButton) {
      return false;
    }

    const newToolbarY = this.calculateToolbarY(options, plusButton);

    if (newToolbarY === null) {
      return false;
    }

    /**
     * Only update the toolbar position if it has actually changed significantly.
     * This prevents unnecessary repositioning when block changes don't affect
     * the toolbar's position (e.g., toggling checkbox styles in a checklist).
     *
     * We use a tolerance to account for:
     * - Floating-point precision issues in getBoundingClientRect()
     * - Minor layout changes that don't warrant toolbar repositioning
     * - Browser rendering differences during DOM mutations
     */
    const positionChanged = this.lastToolbarY === null ||
      Math.abs(newToolbarY - this.lastToolbarY) > POSITION_TOLERANCE;

    if (positionChanged) {
      this.lastToolbarY = newToolbarY;
      wrapper.style.top = `${newToolbarY}px`;
    }

    return positionChanged;
  }

  /**
   * Applies the content offset transform to the actions element based on the hovered target.
   * This positions the toolbar closer to nested content like list items.
   * @param nodes - Toolbar nodes
   * @param targetBlock - The block to get the content offset from
   */
  public applyContentOffset(nodes: ToolbarNodes, targetBlock: Block): void {
    const { actions } = nodes;

    if (!actions) {
      return;
    }

    if (!this.hoveredTarget) {
      actions.style.transform = '';
      return;
    }

    const contentOffset = targetBlock.getContentOffset(this.hoveredTarget);
    const hasValidOffset = contentOffset && contentOffset.left > 0;

    actions.style.transform = hasValidOffset ? `translateX(${contentOffset.left}px)` : '';
  }
}
