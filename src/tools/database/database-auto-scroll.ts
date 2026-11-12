import { AutoScroll } from '../../components/modules/drag/utils/AutoScroll';
import { findScrollableAncestor } from '../../components/modules/drag/utils/findScrollableAncestor';

/** notion-motion.md Round 14: Notion scrolls in steps about 24ms apart. */
const STEP_MS = 24;

/**
 * Table rows near the top or bottom. Notion measured 0.84 px/ms at 10px from
 * the edge and 0.38 at 20px, and nothing at 30px. This is the straight line
 * through the two speeds, so the zone ends near 28px.
 */
export const rowAutoScrollSpeed = (distance: number): number => Math.max(0, 0.84 - 0.046 * (distance - 10));

/**
 * Board cards near the board's side. Notion measured 1.5 px/ms at 10px and
 * nothing at 20px. This is the straight line between those two points.
 */
export const cardAutoScrollSpeed = (distance: number): number => Math.max(0, 0.15 * (20 - distance));

/**
 * List rows near the top or bottom. notion-motion.md Round 16: about 0.66 px/ms
 * at 10px from the window bottom, and nothing at 12px or farther. Notion also
 * did not scroll at 5px, for a reason not read; this zone runs to the edge.
 */
export const listAutoScrollSpeed = (distance: number): number => (distance < 12 ? 0.66 : 0);

/**
 * A drag's auto-scroll on one axis. The zones hug the scroller's edges, cut
 * to the window, or the window's edges when nothing inside the page scrolls.
 */
export const createDatabaseAutoScroll = (
  from: HTMLElement,
  axis: 'x' | 'y',
  speed: (distance: number) => number,
  onStep: () => void
): AutoScroll => {
  const scroller = findScrollableAncestor(from, axis);

  return new AutoScroll(scroller, {
    axis,
    speed,
    stepMs: STEP_MS,
    onStep,
    bounds: () => {
      const size = axis === 'y' ? window.innerHeight : window.innerWidth;

      if (scroller === null) {
        return { start: 0, end: size };
      }
      const rect = scroller.getBoundingClientRect();

      return axis === 'y'
        ? { start: Math.max(0, rect.top), end: Math.min(size, rect.bottom) }
        : { start: Math.max(0, rect.left), end: Math.min(size, rect.right) };
    },
  });
};
