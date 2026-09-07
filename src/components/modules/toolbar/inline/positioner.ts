import { INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP, INLINE_TOOLBAR_VERTICAL_MARGIN_MOBILE } from './constants';
import type { InlinePositioningOptions } from './types';

/**
 * InlinePositioner handles positioning of the inline toolbar.
 *
 * Responsibilities:
 * - Calculate toolbar position based on selection
 * - Apply position to wrapper element
 * - Prevent overflow on right side
 */
export class InlinePositioner {
  /**
   * Margin above/below the Toolbar
   */
  private readonly toolbarVerticalMargin: number;

  constructor(isMobile: boolean) {
    this.toolbarVerticalMargin = isMobile ? INLINE_TOOLBAR_VERTICAL_MARGIN_MOBILE : INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP;
  }

  /**
   * Calculate and apply position to wrapper element
   */
  public apply(options: InlinePositioningOptions): void {
    const { wrapper, selectionRect, wrapperOffset, contentRect, popoverWidth, popoverHeight = 0 } = options;

    const newCoords = {
      x: selectionRect.x - wrapperOffset.x,
      y: selectionRect.y +
        selectionRect.height -
        wrapperOffset.top +
        this.toolbarVerticalMargin,
    };

    const realRightCoord = newCoords.x + popoverWidth + wrapperOffset.x;

    // Prevent overflow on right side
    if (realRightCoord > contentRect.right) {
      newCoords.x = contentRect.right - popoverWidth - wrapperOffset.x;
    }

    // A narrow editor must not push the wider toolbar outside the viewport.
    newCoords.x = Math.max(8, Math.min(newCoords.x + wrapperOffset.x, window.innerWidth - popoverWidth - 8)) - wrapperOffset.x;

    if (popoverHeight > 0) {
      const bottomTop = newCoords.y + wrapperOffset.top;
      const top = bottomTop + popoverHeight > window.innerHeight - 8
        ? selectionRect.top - popoverHeight - this.toolbarVerticalMargin
        : bottomTop;

      newCoords.y = Math.max(8, Math.min(top, window.innerHeight - popoverHeight - 8)) - wrapperOffset.top;
    }

    wrapper.style.left = Math.floor(newCoords.x) + 'px';
    wrapper.style.top = Math.floor(newCoords.y) + 'px';
  }
}
