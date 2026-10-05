/**
 * Turns one embed window scene into the next: every part of the new drawing
 * starts on top of a part of the old one and springs to its own place.
 */

export interface PartBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The scene's outline (`id="…-s"`); bodies only pair with bodies. */
  body: boolean;
}

export interface PartPair {
  from: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

// Past these a part turns into a sliver or a smear on its first frame.
const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
// Distance penalty for reusing an old part, so new parts fan out from many.
const REUSE_PENALTY = 60;

const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** For each new part: the old part it flies from and the offset/scale that puts it there. */
export function pairParts(olds: readonly PartBox[], news: readonly PartBox[]): Array<PartPair | null> {
  const used = new Set<number>();

  return news.map((part) => {
    const cx = part.x + part.width / 2;
    const cy = part.y + part.height / 2;
    const best = { index: -1, distance: Infinity };

    olds.forEach((old, index) => {
      if (old.body !== part.body) {
        return;
      }

      const distance = Math.hypot(old.x + old.width / 2 - cx, old.y + old.height / 2 - cy)
        + (used.has(index) ? REUSE_PENALTY : 0);

      if (distance < best.distance) {
        best.index = index;
        best.distance = distance;
      }
    });

    const old = olds[best.index];

    if (old === undefined) {
      return null;
    }

    used.add(best.index);

    return {
      from: best.index,
      dx: old.x + old.width / 2 - cx,
      dy: old.y + old.height / 2 - cy,
      sx: clampScale(old.width / Math.max(1, part.width)),
      sy: clampScale(old.height / Math.max(1, part.height)),
    };
  });
}

const MORPH_MS = 900;
const STAGGER_MS = 14;
const DEPTH_DELAY_MS = 22;

const spring = { easing: '' };

// A damped spring sampled into a CSS linear() easing; it overshoots, then settles inside MORPH_MS.
function springEasing(): string {
  if (spring.easing) {
    return spring.easing;
  }

  const zeta = 0.5;
  const omega = 13;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const steps = 40;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    if (i === steps) {
      return '1';
    }

    const t = (i / steps) * (MORPH_MS / 1000);
    const v = 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));

    return String(Math.round(v * 1000) / 1000);
  });
  const supported = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');

  spring.easing = supported ? `linear(${points.join(', ')})` : 'cubic-bezier(0.34, 1.56, 0.64, 1)';

  return spring.easing;
}

const partsOf = (svg: SVGSVGElement): SVGGraphicsElement[] =>
  Array.from(svg.querySelectorAll<SVGGraphicsElement>('.blok-media-preview__layer :is(rect, circle, ellipse, path)'));

const depthOf = (el: Element): number =>
  parseFloat(el.closest<SVGGElement>('.blok-media-preview__layer')?.style.getPropertyValue('--d') ?? '') || 0;

const boxOf = (el: SVGGraphicsElement): PartBox => {
  const { x, y, width, height } = el.getBBox();

  return { x, y, width, height, body: el.id.endsWith('-s') };
};

/** True where the morph can measure parts and animate them. */
export const canMorph = (svg: SVGSVGElement): boolean =>
  typeof svg.getBBox === 'function' && typeof svg.animate === 'function';

/**
 * Flies the parts of `next` in from the parts of `prev`. Both scenes must be
 * laid out. Returns the started animations, so a newer morph can cancel them.
 */
export function morphScene(prev: SVGSVGElement, next: SVGSVGElement): Animation[] {
  const olds = partsOf(prev).map(boxOf);
  const parts = partsOf(next);
  const pairs = pairParts(olds, parts.map(boxOf));
  const easing = springEasing();
  const played: Animation[] = [];

  next.classList.add('blok-media-preview--morphing');

  parts.forEach((part, i) => {
    const pair = pairs[i];
    // The part's own resting transform (e.g. the progress bar's scaleX) is the target.
    const rest = getComputedStyle(part).transform;
    const restTail = rest === 'none' || rest === '' ? '' : ` ${rest}`;
    const start = pair === null
      ? `scale(${MIN_SCALE})${restTail}`
      : `translate(${pair.dx}px, ${pair.dy}px) scale(${pair.sx}, ${pair.sy})${restTail}`;

    played.push(part.animate(
      [{ transform: start, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: rest === '' ? 'none' : rest, opacity: 1 }],
      { duration: MORPH_MS, easing, delay: depthOf(part) * DEPTH_DELAY_MS + (i % 6) * STAGGER_MS, fill: 'backwards' }
    ));
  });

  // A <use> copy does not follow its source's animation, so drop shadows wait until the parts land.
  next.querySelectorAll('.blok-media-preview__drop').forEach((drop) => played.push(drop.animate(
    [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: getComputedStyle(drop).opacity }],
    { duration: MORPH_MS + 100, fill: 'backwards' }
  )));
  next.querySelectorAll('.blok-media-preview__ground').forEach((ground) => played.push(ground.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 500, delay: 250, fill: 'backwards' }
  )));

  void Promise.all(played.map((animation) => animation.finished))
    .catch(() => undefined)
    .then(() => next.classList.remove('blok-media-preview--morphing'));

  return played;
}
