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

/** The board's side zone: notion-motion.md Round 54 §2, 8 % of the board's width. */
const CARD_ZONE_SHARE = 0.08;

/** notion-motion.md Round 55 §1: [board width, distance px, px/ms]. */
const CARD_MEASURED: ReadonlyArray<readonly [number, number, number]> = [
  [337, 5, 0.81], [337, 10, 0.52], [337, 15, 0.30], [337, 20, 0.12], [337, 25, 0.04],
  [1242, 30, 2.31], [1242, 45, 1.42], [1242, 60, 0.82], [1242, 75, 0.40], [1242, 90, 0.19],
];

/**
 * Speed ÷ zone width by share of the zone. Both boards fall on one curve: the
 * 1242 points predict the 337 ones within about 9 %. The first knot is
 * Round 55's floor (≥ 3.47 px/ms at d 10 on 1242, the scroll hit the end).
 * Nearer the edge is unmeasured, so it holds flat. Share 1 is the zone's end.
 */
const CARD_CURVE = ramp([
  [10 / (1242 * CARD_ZONE_SHARE), 3.47 / (1242 * CARD_ZONE_SHARE)],
  ...CARD_MEASURED
    .map(([width, distance, speed]) => [distance / (width * CARD_ZONE_SHARE), speed / (width * CARD_ZONE_SHARE)] as const)
    .sort((a, b) => a[0] - b[0]),
  [1, 0],
]);

/**
 * Board cards near the board's side. Speed = zone width × CARD_CURVE(share of
 * the zone), so a wider board scrolls faster. Values between the knots, and at
 * widths other than 337 and 1242, are fitted, not measured.
 */
export const cardAutoScrollSpeed = (distance: number, width = 630): number => {
  const zone = width * CARD_ZONE_SHARE;

  return distance > zone ? 0 : zone * CARD_CURVE(distance / zone);
};

/**
 * Board cards near the page's top or bottom. notion-motion.md Round 30 §5: about
 * 1.46 px/ms at 17px and 1.5 px/ms at 16px. Notion's zone width is unread, so
 * it takes the rows' 35px zone (Round 17 §1).
 */
export const cardVerticalAutoScrollSpeed = (distance: number): number => (distance <= 35 ? 1.5 : 0);

type Where = 'zone' | 'out' | 'past';

/**
 * notion-motion.md Round 17 §1: the move that enters the zone does not start
 * the scroll; the next move inside it does. Once started it runs with the
 * pointer held still. Leaving the zone resets it. Round 18 §1: past the
 * window edge a running scroll keeps going, but none starts there.
 */
class SecondMoveAutoScroll extends AutoScroll {
  private readonly where: (coord: number) => Where;
  private armed = false;
  private running = false;

  constructor(scroller: HTMLElement | null, options: AutoScrollOptions, where: (coord: number) => Where) {
    super(scroller, options);
    this.where = where;
  }

  start(coord: number): void {
    const where = this.where(coord);

    if (where === 'past' && this.running) {
      super.start(coord);

      return;
    }
    if (where !== 'zone') {
      this.stop();

      return;
    }
    if (!this.armed) {
      this.armed = true;

      return;
    }
    this.running = true;
    super.start(coord);
  }

  stop(): void {
    this.armed = false;
    this.running = false;
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
  speedAt: (distance: number, size: number) => number,
  onStep: () => void
): AutoScroll => {
  const scroller = findScrollableAncestor(from, axis);
  const speed = (distance: number): number => {
    const rect = scroller?.getBoundingClientRect() ?? { width: window.innerWidth, height: window.innerHeight };

    return speedAt(distance, axis === 'y' ? rect.height : rect.width);
  };
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
  // Round 17 §1: a pointer outside the scroller but in the window (over the top bar) does not scroll.
  // Round 18 §1: past the window edge Notion keeps its 1px speed; AutoScroll clamps the distance to 0.
  const where = (coord: number): Where => {
    const { start, end } = bounds();
    const size = axis === 'y' ? window.innerHeight : window.innerWidth;

    if (coord < 0 || coord > size) return 'past';

    return coord >= start && coord <= end && speed(Math.min(end - coord, coord - start)) > 0 ? 'zone' : 'out';
  };

  return new SecondMoveAutoScroll(scroller, { axis, speed, stepMs: STEP_MS, onStep, bounds }, where);
};
