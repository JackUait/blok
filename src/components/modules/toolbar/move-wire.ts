import { DATA_ATTR } from '../../constants/data-attributes';
import { createSpring, prefersReducedMotion, type Spring, type SpringClock } from '../../utils/spring';

export interface WirePoint {
  x: number;
  y: number;
}

export type WireCurve = readonly [WirePoint, WirePoint, WirePoint, WirePoint];

type Box = Pick<DOMRect, 'bottom' | 'right'>;

const SVG_NS = 'http://www.w3.org/2000/svg';

const START_PAST_PICKER = 44;
const VIEWPORT_GAP = 16;
const PEG_INSET = 14;
const PEG_RADIUS = 3;
const BEAD_RADIUS = 5;

/** How far under the row the two handles hang, and how far right the second one reaches. */
const SAG_START = 58;
const SAG_END = 46;
const REACH = 78;

/** The peg lands fast; the slack follows loosely, so the wire swings past and back. */
const PEG_SPRING = { stiffness: 420, damping: 30 };
const SLACK_SPRING = { stiffness: 70, damping: 6.5 };

const FLIGHT_MS = 520;
const FADE_MS = 200;
const BUMP_MS = 340;

/** Straight pieces the curve is cut into to measure distance along it. */
const PIECES = 48;

const frameClock: SpringClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Where the wire leaves the block and where it plugs into the picker.
 * @param block - the block being moved
 * @param picker - the picker's panel
 * @param rowY - the aimed row's vertical centre
 * @param viewportWidth - the window's width
 */
export const wireEnds = (block: Box, picker: Box, rowY: number, viewportWidth: number): { start: WirePoint; end: WirePoint } => ({
  start: { x: Math.min(picker.right + START_PAST_PICKER, viewportWidth - VIEWPORT_GAP), y: block.bottom + 1 },
  end: { x: picker.right - PEG_INSET, y: rowY },
});

/**
 * The hanging curve between the two ends.
 * @param start - the block end
 * @param end - the row end
 * @param swingY - where the slack is: the row's centre at rest, behind it while swinging
 */
export const wireCurve = (start: WirePoint, end: WirePoint, swingY: number): WireCurve => [
  start,
  { x: start.x, y: swingY + SAG_START },
  { x: end.x + REACH, y: swingY + SAG_END },
  end,
];

export const wirePath = ([start, first, second, end]: WireCurve): string =>
  `M${start.x} ${start.y}C${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`;

const pointAt = ([start, first, second, end]: WireCurve, t: number): WirePoint => {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  const sum = (pick: (point: WirePoint) => number): number =>
    weights[0] * pick(start) + weights[1] * pick(first) + weights[2] * pick(second) + weights[3] * pick(end);

  return { x: sum((point) => point.x), y: sum((point) => point.y) };
};

/**
 * The point a `fraction` of the curve's length from its start, so the bead moves at an even speed.
 * @param curve - the wire
 * @param fraction - 0 at the block, 1 at the row
 */
export const pointAlong = (curve: WireCurve, fraction: number): WirePoint => {
  const points = Array.from({ length: PIECES + 1 }, (_, index) => pointAt(curve, index / PIECES));
  const lengths = points.reduce<number[]>((sums, point, index) => {
    const before = points[index - 1];

    return [...sums, before === undefined ? 0 : sums[index - 1] + Math.hypot(point.x - before.x, point.y - before.y)];
  }, []);
  const total = lengths[PIECES];
  const wanted = Math.min(1, Math.max(0, fraction)) * total;
  const next = lengths.findIndex((length) => length >= wanted);

  if (total === 0 || next <= 0) {
    return points[0];
  }

  const span = lengths[next] - lengths[next - 1];
  const part = span === 0 ? 0 : (wanted - lengths[next - 1]) / span;

  return {
    x: points[next - 1].x + (points[next].x - points[next - 1].x) * part,
    y: points[next - 1].y + (points[next].y - points[next - 1].y) * part,
  };
};

export interface MoveWireOptions {
  /** The picker's popover root. The wire is drawn inside it, so it sits above the picker. */
  picker: HTMLElement;
  /** The block being moved. */
  block: HTMLElement;
  clock?: SpringClock;
  reducedMotion?: () => boolean;
}

/**
 * The slack wire of "Move to": it runs from the block to the row the picker
 * is on, swings when the row changes, and carries the block to the picked row
 * as a bead.
 */
export class MoveWire {
  private readonly picker: HTMLElement;
  private readonly block: HTMLElement;
  private readonly clock: SpringClock;
  private readonly reduced: () => boolean;
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly path = document.createElementNS(SVG_NS, 'path');
  private readonly startPeg = document.createElementNS(SVG_NS, 'circle');
  private readonly endPeg = document.createElementNS(SVG_NS, 'circle');
  private readonly peg: Spring<'y'>;
  private readonly slack: Spring<'y'>;
  private curve: WireCurve | null = null;
  private aimed = false;
  private frozen = false;
  private destroyed = false;
  private frame = 0;
  private settle: ((arrived: boolean) => void) | null = null;

  constructor(options: MoveWireOptions) {
    this.picker = options.picker;
    this.block = options.block;
    this.clock = options.clock ?? frameClock;
    this.reduced = options.reducedMotion ?? prefersReducedMotion;

    const spring = (config: typeof PEG_SPRING): Spring<'y'> => createSpring({
      from: { y: 0 },
      config,
      clock: this.clock,
      reducedMotion: this.reduced,
      onUpdate: () => this.draw(),
    });

    this.peg = spring(PEG_SPRING);
    this.slack = spring(SLACK_SPRING);

    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute(DATA_ATTR.testid, 'move-wire');
    // 1px, not 0: a browser does not paint a zero-sized svg, even an unclipped one.
    // One above the panel's --blok-z-popover, or the peg in the row is hidden behind the panel.
    this.svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:calc(var(--blok-z-popover) + 1)');
    this.path.setAttribute('fill', 'none');
    this.path.setAttribute('stroke', 'var(--blok-text-primary)');
    this.path.setAttribute('stroke-width', '1.25');
    this.path.setAttribute('stroke-linecap', 'round');
    [this.startPeg, this.endPeg].forEach((peg) => {
      peg.setAttribute('r', String(PEG_RADIUS));
      peg.setAttribute('fill', 'var(--blok-text-primary)');
    });
    this.svg.append(this.path, this.startPeg, this.endPeg);
    this.svg.style.display = 'none';
    this.picker.append(this.svg);
    window.addEventListener('resize', this.draw);
  }

  /**
   * Points the wire at a row. Null keeps the last row.
   * @param row - the picker's active row
   */
  public aim(row: HTMLElement | null): void {
    if (row === null || this.frozen || this.destroyed) {
      return;
    }

    const rect = row.getBoundingClientRect();
    // Kept relative to the panel, so a page scroll does not move the target.
    const y = rect.top + rect.height / 2 - this.panel().top;

    if (this.aimed) {
      this.peg.to({ y });
      this.slack.to({ y });
    } else {
      this.aimed = true;
      this.svg.style.display = '';
      this.peg.jump({ y });
      this.slack.jump({ y });
    }
    this.draw();
  }

  /**
   * Sends the block down the wire as a bead.
   * @param mark - the row's icon, which takes the bead with a small bump
   * @returns false when the wire went away before the bead arrived
   */
  public send(mark?: Element | null): Promise<boolean> {
    const curve = this.curve;

    if (this.destroyed || this.settle !== null) {
      return Promise.resolve(false);
    }
    this.frozen = true;
    this.peg.stop();
    this.slack.stop();
    if (curve === null || this.reduced()) {
      return Promise.resolve(true);
    }

    const bead = document.createElementNS(SVG_NS, 'circle');
    const started = this.clock.now();

    bead.setAttribute('r', String(BEAD_RADIUS));
    bead.setAttribute('fill', 'var(--blok-text-primary)');
    bead.setAttribute('cx', String(curve[0].x));
    bead.setAttribute('cy', String(curve[0].y));
    this.svg.append(bead);

    return new Promise((resolve) => {
      const step = (): void => {
        const t = Math.min(1, (this.clock.now() - started) / FLIGHT_MS);
        const point = pointAlong(curve, t * t * (3 - 2 * t));

        bead.setAttribute('cx', String(point.x));
        bead.setAttribute('cy', String(point.y));
        if (t < 1) {
          this.frame = this.clock.request(step);

          return;
        }
        this.settle = null;
        mark?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], {
          duration: BUMP_MS,
          easing: 'cubic-bezier(.3,1.6,.5,1)',
        });
        this.svg.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' });
        resolve(true);
      };

      this.settle = resolve;
      this.frame = this.clock.request(step);
    });
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clock.cancel(this.frame);
    this.peg.stop();
    this.slack.stop();
    window.removeEventListener('resize', this.draw);
    this.svg.remove();
    this.settle?.(false);
    this.settle = null;
  }

  private panel(): DOMRect {
    return (this.picker.querySelector(`[${DATA_ATTR.popoverContainer}]`) ?? this.picker).getBoundingClientRect();
  }

  private readonly draw = (): void => {
    if (!this.aimed || this.frozen || this.destroyed) {
      return;
    }

    const panel = this.panel();
    const origin = this.svg.getBoundingClientRect();
    const ends = wireEnds(this.block.getBoundingClientRect(), panel, panel.top + this.peg.values().y, window.innerWidth);
    const local = (point: WirePoint): WirePoint => ({ x: point.x - origin.left, y: point.y - origin.top });
    const curve = wireCurve(local(ends.start), local(ends.end), panel.top + this.slack.values().y - origin.top);

    this.curve = curve;
    this.path.setAttribute('d', wirePath(curve));
    this.startPeg.setAttribute('cx', String(curve[0].x));
    this.startPeg.setAttribute('cy', String(curve[0].y));
    this.endPeg.setAttribute('cx', String(curve[3].x));
    this.endPeg.setAttribute('cy', String(curve[3].y));
  };
}
