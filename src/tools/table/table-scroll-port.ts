/**
 * Where a table grows into when it outgrows the screen: the box that scrolls
 * it vertically, and the auto-scroll feel shared by every add gesture.
 */

/**
 * Auto-scroll speed, as table growth per second per pixel the pointer is held
 * past the edge: 10px out grows 80px/s, 100px out grows 800px/s. Speed follows
 * the pointer rather than a fixed cadence, so how fast the table expands stays
 * under the reader's thumb — the same proportional rule drag-autoscroll uses
 * everywhere else.
 *
 * The budget accrues in pixels but is only ever spent in WHOLE rows/columns:
 * asking the geometry walk to grow by a fraction of one still appends a whole
 * one, which is how a px/ms budget once appended one per frame (~3600px/s).
 */
export const AUTO_SCROLL_GAIN_PER_SECOND = 8;

/**
 * How close to the scroller's lower edge counts as having run out of screen.
 * Rows are never clipped the way columns are, so the vertical trigger is the
 * pointer running out of room to drag with rather than the edge being hidden.
 */
export const AUTO_SCROLL_VIEWPORT_BAND = 24;

export interface VerticalPort {
  /** The visible box, in viewport coordinates. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  scrollBy: (dy: number) => void;
}

/**
 * A box that scrolls on the y axis: overflowing now, or a fixed box like the
 * full-screen modal, which scrolls the moment the table outgrows it. The
 * table's own scroll container hides overflow-y, so it is never picked.
 */
const isVerticalScroller = (el: HTMLElement): boolean => {
  const style = getComputedStyle(el);

  return (style.overflowY === 'auto' || style.overflowY === 'scroll')
    && (el.scrollHeight > el.clientHeight || style.position === 'fixed');
};

const findVerticalScroller = (el: HTMLElement | null): HTMLElement | null => {
  if (el === null || el === document.body || el === document.documentElement) {
    return null;
  }

  return isVerticalScroller(el) ? el : findVerticalScroller(el.parentElement);
};

/** The box that scrolls `from` vertically: the nearest scrolling ancestor, else the window. */
export const verticalPort = (from: HTMLElement): VerticalPort => {
  const scroller = findVerticalScroller(from.parentElement);

  if (scroller === null) {
    return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth, scrollBy: (dy) => window.scrollBy(0, dy) };
  }

  const rect = scroller.getBoundingClientRect();

  return {
    top: Math.max(rect.top, 0),
    bottom: Math.min(rect.bottom, window.innerHeight),
    left: Math.max(rect.left, 0),
    right: Math.min(rect.right, window.innerWidth),
    scrollBy: (dy) => scroller.scrollBy(0, dy),
  };
};

/** Scrolls just enough that `bottom` (viewport coordinates) sits inside the port's lower band. */
export const revealBottom = (from: HTMLElement, bottom: number): void => {
  const port = verticalPort(from);
  const overshoot = bottom - (port.bottom - AUTO_SCROLL_VIEWPORT_BAND);

  if (overshoot > 0) {
    port.scrollBy(overshoot);
  }
};
