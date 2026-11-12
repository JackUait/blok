import { AutoScroll } from '../../components/modules/drag/utils/AutoScroll';
import type { AutoScrollOptions } from '../../components/modules/drag/utils/AutoScroll';
import { findScrollableAncestor } from '../../components/modules/drag/utils/findScrollableAncestor';

/** notion-motion.md Round 14: Notion scrolls in steps about 24ms apart. */
const STEP_MS = 24;

/** Straight lines between measured [distance, px/ms] points, nearest edge first; 0 past the last one. */
const ramp = (points: ReadonlyArray<readonly [number, number]>) => (distance: number): number => {
  const [first] = points;
  const last = points[points.length - 1];

  if (distance <= first[0]) return first[1];
  if (distance > last[0]) return 0;
  const upper = points.findIndex(([at]) => at >= distance);
  const [d0, v0] = points[upper - 1];
  const [d1, v1] = points[upper];

  return v0 + (v1 - v0) * (distance - d0) / (d1 - d0);
};

/**
 * Rows near the top or bottom. notion-motion.md Round 17 §1: List rows at the
 * bottom edge, nothing at 36px. The Table row's own curve is unread; at 10px it
 * ran about 0.8 px/ms, so it takes the List row's curve.
 */
const VERTICAL = ramp([[1, 1.39], [5, 1.11], [10, 0.74], [20, 0.33], [32, 0.081], [34, 0.033], [35, 0.034]]);

export const listAutoScrollSpeed = VERTICAL;
export const rowAutoScrollSpeed = VERTICAL;

/**
 * Board cards near the board's side. notion-motion.md Round 17 §1: about
 * 1.2 px/ms at 10px, still scrolling at 49px, nothing at 53px. Read at the
 * left edge only; the right edge takes the same rule. Nearer than 10px is unread.
 */
export const cardAutoScrollSpeed = ramp([[10, 1.2], [50, 0]]);

/**
 * notion-motion.md Round 17 §1: the move that enters the zone does not start
 * the scroll; the next move inside it does. Once started it runs with the
 * pointer held still. Leaving the zone resets it.
 */
class SecondMoveAutoScroll extends AutoScroll {
  private readonly zone: (coord: number) => boolean;
  private armed = false;

  constructor(scroller: HTMLElement | null, options: AutoScrollOptions, zone: (coord: number) => boolean) {
    super(scroller, options);
    this.zone = zone;
  }

  start(coord: number): void {
    if (!this.zone(coord)) {
      this.stop();

      return;
    }
    if (!this.armed) {
      this.armed = true;

      return;
    }
    super.start(coord);
  }

  stop(): void {
    this.armed = false;
    super.stop();
  }
}

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
  const bounds = (): { start: number; end: number } => {
    const size = axis === 'y' ? window.innerHeight : window.innerWidth;

    if (scroller === null) {
      return { start: 0, end: size };
    }
    const rect = scroller.getBoundingClientRect();

    return axis === 'y'
      ? { start: Math.max(0, rect.top), end: Math.min(size, rect.bottom) }
      : { start: Math.max(0, rect.left), end: Math.min(size, rect.right) };
  };
  // Round 17 §1: a pointer outside the scroller (over the top bar) does not scroll.
  const inZone = (coord: number): boolean => {
    const { start, end } = bounds();

    return coord >= start && coord <= end && speed(Math.min(end - coord, coord - start)) > 0;
  };

  return new SecondMoveAutoScroll(scroller, { axis, speed, stepMs: STEP_MS, onStep, bounds }, inZone);
};
