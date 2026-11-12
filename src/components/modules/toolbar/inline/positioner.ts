import { INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP, INLINE_TOOLBAR_VERTICAL_MARGIN_MOBILE } from './constants';
import type { InlinePositioningOptions } from './types';

/** Gap between the selected text and a tethered menu. MUST match the stem height in popover-animation.css. */
const TETHER_GAP = 11;

/** MUST match the 8px in the clamp in popover-animation.css. */
const TETHER_VIEWPORT_MARGIN = 8;

interface TetherOptions {
  /** The toolbar wrapper; already placed by `apply`. */
  wrapper: HTMLElement;
  /** The popover root, which draws the stem. */
  root: HTMLElement;
  selectionRect: DOMRect;
  wrapperRect: DOMRect;
  /** Layout height of the menu box; a rect would be scaled by its entrance animation. */
  menuHeight: number;
}

/**
 * InlinePositioner handles positioning of the inline toolbar.
 *
 * Responsibilities:
 * - Calculate toolbar position based on selection
 * - Apply position to wrapper element
 * - Keep it inside the viewport horizontally
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
   * @returns which side of the selection the toolbar landed on
   */
  public apply(options: InlinePositioningOptions): 'below' | 'above' {
    const { wrapper, selectionRect, wrapperOffset, popoverWidth, popoverHeight = 0, direction = 'ltr' } = options;
    const startX = direction === 'rtl' ? selectionRect.right - popoverWidth : selectionRect.x;

    const newCoords = {
      x: startX - wrapperOffset.x,
      y: selectionRect.y +
        selectionRect.height -
        wrapperOffset.top +
        this.toolbarVerticalMargin,
    };

    // Constrain to the viewport, not the editor column, to preserve selection alignment.
    newCoords.x = Math.max(8, Math.min(newCoords.x + wrapperOffset.x, window.innerWidth - popoverWidth - 8)) - wrapperOffset.x;

    const bottomTop = newCoords.y + wrapperOffset.top;
    const side = popoverHeight > 0 && bottomTop + popoverHeight > window.innerHeight - 8 ? 'above' : 'below';

    if (popoverHeight > 0) {
      const top = side === 'above'
        ? selectionRect.top - popoverHeight - this.toolbarVerticalMargin
        : bottomTop;

      newCoords.y = Math.max(8, Math.min(top, window.innerHeight - popoverHeight - 8)) - wrapperOffset.top;
    }

    wrapper.style.left = Math.floor(newCoords.x) + 'px';
    wrapper.style.top = Math.floor(newCoords.y) + 'px';

    return side;
  }

  /**
   * Moves an already positioned menu's origin onto the selected text: its
   * horizontal centre, a fixed gap below it, or above when there is no room.
   * popover-animation.css centres the menu on that origin and draws the stem.
   */
  public tether(options: TetherOptions): void {
    const { wrapper, root, selectionRect, wrapperRect, menuHeight } = options;
    const centre = selectionRect.left + selectionRect.width / 2;
    const fitsBelow = selectionRect.bottom + TETHER_GAP + menuHeight <= window.innerHeight - TETHER_VIEWPORT_MARGIN;
    const fitsAbove = selectionRect.top - TETHER_GAP - menuHeight >= TETHER_VIEWPORT_MARGIN;
    const isBelow = fitsBelow || !fitsAbove;
    const top = isBelow ? selectionRect.bottom + TETHER_GAP : selectionRect.top - TETHER_GAP;

    wrapper.style.left = `${parseFloat(wrapper.style.left) + centre - wrapperRect.left}px`;
    wrapper.style.top = `${parseFloat(wrapper.style.top) + top - wrapperRect.top}px`;

    // Viewport x of the origin: the stylesheet clamps the centred menu to the viewport with it.
    root.style.setProperty('--_blok-tether-centre-x', `${centre}px`);
    root.setAttribute('data-blok-inline-tether', isBelow ? 'below' : 'above');
  }
}
